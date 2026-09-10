import { createOperationJournal } from "./operation-journal.js";
import {
  conflictError,
  createOperationDataAdapter,
  normalizeOperationItem,
  normalizeOperationTarget,
  sameOperationValue,
  validateUndoTarget
} from "./operation-data.js";
import { getSiteDataItemId } from "./item-identity.js";

const APPLY_ACTIVE = new Set(["pending", "running"]);
const UNDO_ELIGIBLE = new Set(["applied", "undo-failed", "undo-conflict"]);
const RETRY_ELIGIBLE = new Set(["failed", "conflict"]);

export function createOperationEngine({
  journal = createOperationJournal(),
  adapter = createOperationDataAdapter(),
  persistHistory = async () => {}
} = {}) {
  let serial = Promise.resolve();
  let pumping = null;
  let pausedError = null;

  function exclusive(task) {
    const result = serial.catch(() => {}).then(task);
    serial = result.catch(() => {});
    return result;
  }

  async function submitOperation(spec) {
    const submitted = await exclusive(async () => {
      const jobs = await journal.read();
      const job = normalizeSpec(spec);
      const previous = jobs.find((item) => item.id === job.id);
      if (previous) {
        if (!sameSpec(previous, job)) throw new Error("This operation ID already belongs to another request.");
        return structuredClone(previous);
      }
      await adapter.verifyTarget(job.target);
      jobs.push(job);
      await journal.write(jobs);
      return structuredClone(job);
    });
    resumeOperations();
    return submitted;
  }

  async function listOperations() {
    const jobs = await journal.read();
    const result = jobs.map(withPausedError).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    resumeOperations();
    return result;
  }

  async function getOperation(id) {
    const jobs = await journal.read();
    const job = jobs.find((item) => item.id === id);
    const result = job ? withPausedError(job) : null;
    resumeOperations();
    return result;
  }

  async function retryOperation(id) {
    const updated = await exclusive(async () => {
      const jobs = await journal.read();
      const job = findJob(jobs, id);
      requireCompleted(job);
      const items = job.items.filter((item) => RETRY_ELIGIBLE.has(item.state));
      if (items.length === 0) return structuredClone(job);
      await adapter.verifyTarget(job.target);
      for (const item of items) {
        item.state = "pending";
        delete item.error;
      }
      job.status = "queued";
      job.action = "apply";
      job.executionTarget = job.target;
      touch(job);
      await journal.write(jobs);
      return structuredClone(job);
    });
    resumeOperations();
    return updated;
  }

  async function undoOperation(id, { itemIds, target } = {}) {
    const updated = await exclusive(async () => {
      const jobs = await journal.read();
      const job = findJob(jobs, id);
      requireCompleted(job);
      const selected = itemIds === undefined ? null : new Set(itemIds);
      if (selected && [...selected].some((itemId) => !job.items.some((item) => item.id === itemId))) {
        throw new Error("The undo selection contains an unknown operation item.");
      }
      const items = job.items.filter((item) => UNDO_ELIGIBLE.has(item.state) && (!selected || selected.has(item.id)));
      if (items.length === 0) return structuredClone(job);
      const executionTarget = validateUndoTarget(job.target, target, items);
      await adapter.verifyTarget(executionTarget);
      for (const item of items) {
        item.state = "undoing";
        item.undoRecovered = false;
        delete item.error;
      }
      job.status = "queued";
      job.action = "undo";
      job.executionTarget = executionTarget;
      touch(job);
      await journal.write(jobs);
      return structuredClone(job);
    });
    resumeOperations();
    return updated;
  }

  async function forgetOperation(id) {
    return exclusive(async () => {
      const jobs = await journal.read();
      const job = findJob(jobs, id);
      requireCompleted(job);
      await journal.write(jobs.filter((item) => item.id !== id));
      return true;
    });
  }

  function resumeOperations() {
    if (pumping) return pumping;
    pausedError = null;
    pumping = (async () => {
      while (await exclusive(runNextStep)) {
        // Each item releases the mutation queue so new requests can be acknowledged.
      }
    })().catch((error) => {
      pausedError = { message: boundedError(error), code: error?.code || "OPERATION_PAUSED" };
    }).finally(() => {
      pumping = null;
    });
    return pumping;
  }

  async function runNextStep() {
    const jobs = await journal.read();
    const job = jobs.find((item) => item.status === "queued" || item.status === "running");
    if (!job) return false;
    const undo = job.action === "undo";
    const candidates = undo ? [...job.items].reverse() : job.items;
    const item = candidates.find((entry) => undo ? entry.state === "undoing" : APPLY_ACTIVE.has(entry.state));
    if (!item) {
      job.status = "completed";
      touch(job);
      await checkpoint(jobs, job, true);
      return true;
    }
    const target = normalizeOperationTarget(job.executionTarget || job.target);
    const recovering = item.state === "running" || (undo && item.undoRecovered);
    job.status = "running";
    if (undo) {
      item.undoRecovered = true;
    } else {
      item.state = "running";
    }
    touch(job);
    await checkpoint(jobs, job);

    try {
      await adapter.verifyTarget(target);
      const expected = undo ? item.after : item.before;
      const desired = undo ? item.before : item.after;
      const current = await adapter.read(item, target);
      if ((recovering || item.writeUncertain) && sameOperationValue(item.kind, current, desired)) {
        item.recovered = true;
      } else {
        if (!sameOperationValue(item.kind, current, expected)) throw conflictError();
        // Persist ambiguity before calling an API: a closed worker may never receive its reply.
        item.writeUncertain = true;
        touch(job);
        await checkpoint(jobs, job);
        const actual = await adapter.compareAndWrite(item, target, expected, desired);
        if (!undo && item.kind === "cookies" && !sameOperationValue(item.kind, actual, desired)) {
          item.requestedAfter = item.requestedAfter || item.after;
          item.after = normalizeOperationItem({ ...item, after: actual }, job.target).after;
          item.normalized = true;
        }
      }
      item.state = undo ? "undone" : "applied";
      delete item.error;
      delete item.writeUncertain;
      delete item.undoRecovered;
    } catch (error) {
      if (error?.journalFailure) throw error;
      item.state = error?.code === "OPERATION_CONFLICT"
        ? undo ? "undo-conflict" : "conflict"
        : undo ? "undo-failed" : "failed";
      item.error = boundedError(error);
    }
    touch(job);
    await checkpoint(jobs, job, true);
    return true;
  }

  async function checkpoint(jobs, job, summary = false) {
    try {
      await journal.write(jobs);
    } catch (error) {
      error.journalFailure = true;
      throw error;
    }
    if (summary) {
      try {
        await persistHistory(structuredClone(job));
      } catch {
        // Session history is authoritative; optional local summaries cannot fail a mutation.
      }
    }
  }

  function withPausedError(job) {
    return pausedError && job.status !== "completed"
      ? { ...job, executionError: pausedError }
      : job;
  }

  return {
    submitOperation,
    listOperations,
    getOperation,
    retryOperation,
    undoOperation,
    forgetOperation,
    resumeOperations
  };
}

function normalizeSpec(spec) {
  if (!spec || !Array.isArray(spec.items) || (spec.items.length === 0 && !spec.skipped?.length)) {
    throw new Error("Select at least one site data item before starting an operation.");
  }
  const target = normalizeOperationTarget(spec.target);
  const items = spec.items.map((item, index) => normalizeOperationItem(item, target, index));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Operation item IDs must be unique within the batch.");
  }
  const identities = items.map((item) => `${item.kind}:${getSiteDataItemId(item.kind, item.after || item.before)}`);
  if (new Set(identities).size !== items.length) {
    throw new Error("A batch cannot contain the same site data item more than once.");
  }
  const createdAt = new Date().toISOString();
  return {
    id: String(spec.id || crypto.randomUUID()),
    target,
    executionTarget: target,
    label: String(spec.label || "Site data change"),
    source: String(spec.source || "site-data"),
    createdAt,
    updatedAt: createdAt,
    revision: 0,
    action: "apply",
    status: "queued",
    items,
    skipped: Array.isArray(spec.skipped) ? structuredClone(spec.skipped) : []
  };
}

function sameSpec(left, right) {
  const comparable = (job) => ({
    target: job.target,
    source: job.source,
    label: job.label,
    items: job.items.map(({ id, kind, name, before, after, requestedAfter }) => ({
      id, kind, name, before, after: requestedAfter || after
    })),
    skipped: job.skipped
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
  job.revision = (job.revision || 0) + 1;
}

function findJob(jobs, id) {
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error("This operation is no longer available in the current browser session.");
  return job;
}

function requireCompleted(job) {
  if (job.status !== "completed") {
    throw new Error("Wait for the operation to finish before retrying, undoing, or clearing it.");
  }
}

function boundedError(error) {
  return String(error?.message || error || "The operation failed.").slice(0, 240);
}
