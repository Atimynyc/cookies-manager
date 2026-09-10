import { createBatchOperationResult, addOperationSuccess, addOperationFailure, addOperationSkip } from "./operation-result.js";

export function operationItemFromRow(row, after) {
  return {
    id: row.id,
    kind: row.type === "local" ? "localStorage" : row.type === "session" ? "sessionStorage" : "cookies",
    name: row.name,
    before: structuredClone(row.raw),
    after: after === null ? null : structuredClone(after)
  };
}

export function operationToBatchResult(job, { undo = false, itemIds = null } = {}) {
  const result = createBatchOperationResult();
  for (const item of job.items) {
    if (itemIds && !itemIds.includes(item.id)) continue;
    if (item.state === (undo ? "undone" : "applied")) {
      addOperationSuccess(result, item, undo ? item.before : item.after);
    } else if (["failed", "conflict", "undo-failed", "undo-conflict"].includes(item.state)) {
      addOperationFailure(result, item, item.error || "The operation could not be completed.");
    }
  }
  if (!undo) {
    for (const entry of job.skipped || []) {
      addOperationSkip(result, entry.item || entry, entry.reason);
    }
  }
  return result;
}

export function assertOperationSucceeded(job) {
  const failure = job.items.find((item) => item.state !== "applied");
  if (failure) throw new Error(failure.error || "The operation was not completed. Open Operations to review its result.");
  return job;
}
