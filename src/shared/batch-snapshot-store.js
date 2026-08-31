import { callChrome } from "./chrome-call.js";

const LATEST_BATCH_SNAPSHOT_KEY = "latestSiteDataBatchSnapshot";

export async function getLatestBatchSnapshot() {
  if (!chrome.storage?.session) {
    return null;
  }
  const result = await callChrome("storage.session.get", { [LATEST_BATCH_SNAPSHOT_KEY]: null });
  const snapshot = result[LATEST_BATCH_SNAPSHOT_KEY];
  return snapshot && typeof snapshot === "object" && Array.isArray(snapshot.entries) ? snapshot : null;
}

export async function saveLatestBatchSnapshot(snapshot) {
  if (!chrome.storage?.session) {
    return;
  }
  await callChrome("storage.session.set", { [LATEST_BATCH_SNAPSHOT_KEY]: snapshot });
}

export async function clearLatestBatchSnapshot() {
  if (!chrome.storage?.session) {
    return;
  }
  await callChrome("storage.session.remove", LATEST_BATCH_SNAPSHOT_KEY);
}
