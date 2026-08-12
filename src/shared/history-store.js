import { callChrome } from "./chrome-call.js";

const RECENT_CHANGES_KEY = "recentCookieChanges";
const RECENT_CHANGE_SNAPSHOTS_KEY = "recentChangeSnapshots";

export async function getRecentCookieChanges() {
  const result = await callChrome("storage.local.get", {
    [RECENT_CHANGES_KEY]: []
  });
  return Array.isArray(result[RECENT_CHANGES_KEY]) ? result[RECENT_CHANGES_KEY] : [];
}

export async function saveRecentCookieChanges(changes) {
  await callChrome("storage.local.set", {
    [RECENT_CHANGES_KEY]: changes
  });
}

export async function clearRecentCookieChanges() {
  await callChrome("storage.local.remove", RECENT_CHANGES_KEY);
}

export async function getRecentChangeSnapshots() {
  if (!chrome.storage?.session) {
    return {};
  }

  const result = await callChrome("storage.session.get", {
    [RECENT_CHANGE_SNAPSHOTS_KEY]: {}
  });
  const snapshots = result[RECENT_CHANGE_SNAPSHOTS_KEY];
  return snapshots && typeof snapshots === "object" && !Array.isArray(snapshots) ? snapshots : {};
}

export async function saveRecentChangeSnapshots(snapshots) {
  if (!chrome.storage?.session) {
    return;
  }
  await callChrome("storage.session.set", {
    [RECENT_CHANGE_SNAPSHOTS_KEY]: snapshots
  });
}

export async function clearRecentChangeSnapshots() {
  if (!chrome.storage?.session) {
    return;
  }
  await callChrome("storage.session.remove", RECENT_CHANGE_SNAPSHOTS_KEY);
}
