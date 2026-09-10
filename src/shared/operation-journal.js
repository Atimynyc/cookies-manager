import { callChrome } from "./chrome-call.js";

export const OPERATION_JOURNAL_KEY = "siteDataOperationJournal";
export const MAX_OPERATION_JOBS = 100;
const DEFAULT_SESSION_QUOTA = 10 * 1024 * 1024;

export function createOperationJournal() {
  async function read() {
    requireSessionStorage();
    const stored = await callChrome("storage.session.get", { [OPERATION_JOURNAL_KEY]: null });
    const journal = stored[OPERATION_JOURNAL_KEY];
    if (journal === null) return [];
    if (journal?.schemaVersion !== 1 || !Array.isArray(journal.jobs)) {
      throw new Error("The operation journal cannot be read. Existing history has been preserved.");
    }
    return structuredClone(journal.jobs);
  }

  async function write(jobs) {
    requireSessionStorage();
    if (!Array.isArray(jobs) || jobs.length > MAX_OPERATION_JOBS) {
      throw capacityError(`Operation history is limited to ${MAX_OPERATION_JOBS} batches.`);
    }
    const value = { schemaVersion: 1, jobs };
    const capacityBytes = estimateJournalCapacity(jobs);
    let otherBytes = 0;
    if (chrome.storage.session.getBytesInUse) {
      const [total, existing] = await Promise.all([
        callChrome("storage.session.getBytesInUse", null),
        callChrome("storage.session.getBytesInUse", OPERATION_JOURNAL_KEY)
      ]);
      otherBytes = Math.max(0, total - existing);
    }
    const quota = chrome.storage.session.QUOTA_BYTES || DEFAULT_SESSION_QUOTA;
    if (capacityBytes + otherBytes > quota) {
      throw capacityError("Session storage does not have enough room to record this operation safely.");
    }
    try {
      await callChrome("storage.session.set", { [OPERATION_JOURNAL_KEY]: value });
    } catch (error) {
      if (/quota|bytes|storage.*full/i.test(error?.message || "")) {
        throw capacityError("Chrome could not reserve operation history space.", error);
      }
      throw error;
    }
  }

  return { read, write };
}

function estimateJournalCapacity(jobs) {
  // Charge the largest checkpoint shape up front, including any normalized Cookie copy.
  const reservedJobs = jobs.map((job) => ({
    ...job,
    status: "completed",
    action: "apply",
    revision: Number.MAX_SAFE_INTEGER,
    updatedAt: "9999-12-31T23:59:59.999Z",
    executionTarget: job.executionTarget || job.target,
    items: job.items.map((item) => ({
      ...item,
      after: item.requestedAfter || item.after,
      ...(item.kind === "cookies" && item.after ? { requestedAfter: item.requestedAfter || item.after } : {}),
      state: "undo-conflict",
      error: "x".repeat(1024),
      recovered: true,
      normalized: true,
      undoRecovered: true,
      writeUncertain: true
    }))
  }));
  return new TextEncoder().encode(OPERATION_JOURNAL_KEY + JSON.stringify({ schemaVersion: 1, jobs: reservedJobs })).length + 512;
}

function requireSessionStorage() {
  if (!chrome.storage?.session) {
    throw new Error("Session storage is required for recoverable site data operations.");
  }
}

function capacityError(message, cause) {
  const error = new Error(`${message} Clear completed batches in History and try again.`, { cause });
  error.code = "OPERATION_JOURNAL_FULL";
  return error;
}
