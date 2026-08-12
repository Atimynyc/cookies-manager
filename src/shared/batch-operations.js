import {
  addOperationFailure,
  addOperationSkip,
  addOperationSuccess,
  createBatchOperationResult
} from "./operation-result.js";

export function skipBatchOperation(reason) {
  return { status: "skipped", reason: String(reason || "Skipped") };
}

export async function executeBatchOperation(items, operate) {
  if (!Array.isArray(items)) {
    throw new TypeError("Batch operation items must be an array.");
  }
  if (typeof operate !== "function") {
    throw new TypeError("Batch operation handler must be a function.");
  }

  const result = createBatchOperationResult();
  for (const item of items) {
    try {
      const value = await operate(item);
      if (value?.status === "skipped") {
        addOperationSkip(result, item, value.reason);
      } else {
        addOperationSuccess(result, item, value);
      }
    } catch (error) {
      addOperationFailure(result, item, error);
    }
  }
  return result;
}
