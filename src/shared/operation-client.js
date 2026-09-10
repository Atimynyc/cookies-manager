import { callChrome } from "./chrome-call.js";

export const OPERATION_MESSAGE_CHANNEL = "cookie-controller-operations-v1";
const ACTIVE_STATES = new Set(["pending", "running", "undoing"]);

export function submitOperation(spec) {
  return request("submit", { spec });
}

export async function runOperation(spec, { onProgress } = {}) {
  return waitForOperation(await submitOperation(spec), onProgress);
}

export function listOperations() {
  return request("list");
}

export function getOperation(id) {
  return request("get", { id });
}

export async function retryOperation(id, { onProgress } = {}) {
  return waitForOperation(await request("retry", { id }), onProgress);
}

export async function undoOperation(id, { itemIds, target, onProgress } = {}) {
  return waitForOperation(await request("undo", { id, options: { itemIds, target } }), onProgress);
}

export function forgetOperation(id) {
  return request("forget", { id });
}

async function waitForOperation(initialJob, onProgress) {
  let job = initialJob;
  let lastRevision = -1;
  while (job) {
    if (job.revision !== lastRevision) {
      lastRevision = job.revision;
      onProgress?.({
        completed: job.items.filter((item) => !ACTIVE_STATES.has(item.state)).length,
        total: job.items.length,
        job
      });
    }
    if (job.executionError) {
      const error = new Error(job.executionError.message);
      error.code = job.executionError.code;
      error.job = job;
      throw error;
    }
    if (job.status === "completed") return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
    job = await getOperation(job.id);
  }
  throw new Error("The operation history is no longer available in this browser session.");
}

async function request(command, payload = {}) {
  const response = await callChrome("runtime.sendMessage", {
    channel: OPERATION_MESSAGE_CHANNEL,
    command,
    ...payload
  });
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "The background operation service is unavailable. Reopen the extension and try again.");
    if (response?.error?.code) error.code = response.error.code;
    throw error;
  }
  return response.value;
}
