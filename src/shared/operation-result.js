export function createBatchOperationResult() {
  return {
    success: [],
    failed: [],
    skipped: []
  };
}

export function addOperationSuccess(result, item, value = undefined) {
  assertBatchOperationResult(result);
  const entry = { itemId: getResultItemId(item), item };
  if (value !== undefined) {
    entry.value = value;
  }
  result.success.push(entry);
  return entry;
}

export function addOperationFailure(result, item, error) {
  assertBatchOperationResult(result);
  const entry = {
    itemId: getResultItemId(item),
    item,
    error: normalizeOperationError(error),
    rawError: error
  };
  result.failed.push(entry);
  return entry;
}

export function addOperationSkip(result, item, reason) {
  assertBatchOperationResult(result);
  const entry = {
    itemId: getResultItemId(item),
    item,
    reason: String(reason || "Skipped")
  };
  result.skipped.push(entry);
  return entry;
}

export function normalizeOperationError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
      ...(Object.hasOwn(error, "code") ? { code: error.code } : {})
    };
  }

  if (error && typeof error === "object") {
    return {
      name: String(error.name || "Error"),
      message: String(error.message || error.code || "Unknown error"),
      ...(Object.hasOwn(error, "code") ? { code: error.code } : {})
    };
  }

  return {
    name: "Error",
    message: String(error || "Unknown error")
  };
}

export function getBatchOperationCounts(result) {
  assertBatchOperationResult(result);
  return {
    success: result.success.length,
    failed: result.failed.length,
    skipped: result.skipped.length,
    total: result.success.length + result.failed.length + result.skipped.length
  };
}

function assertBatchOperationResult(result) {
  if (!result || !Array.isArray(result.success) || !Array.isArray(result.failed) || !Array.isArray(result.skipped)) {
    throw new TypeError("Invalid batch operation result.");
  }
}

function getResultItemId(item) {
  return typeof item === "string" ? item : item?.id || item?.itemId || "";
}
