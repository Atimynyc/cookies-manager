import { callChrome } from "./chrome-call.js";
import { withStorageWriteLock } from "./storage-write-coordinator.js";
import { compareRecentChangeOrder, projectOperationHistory } from "./operation-history.js";
import { normalizeRecentChanges } from "./recent-changes.js";

const RECENT_CHANGES_KEY = "recentCookieChanges";
const RECENT_CHANGE_SNAPSHOTS_KEY = "recentChangeSnapshots";
const DISMISSED_CHANGES_KEY = "dismissedOperationChanges";

export async function getDismissedChangeIds() {
  const result = await callChrome("storage.session.get", { [DISMISSED_CHANGES_KEY]: [] });
  return result[DISMISSED_CHANGES_KEY];
}

export async function persistOperationHistory(job) {
  return withStorageWriteLock(RECENT_CHANGES_KEY, async () => {
    const dismissed = new Set(await getDismissedChangeIds());
    const existing = normalizeRecentChanges(await getRecentCookieChanges());
    const merged = new Map(existing.map((item) => [item.id, item]));
    for (const item of projectOperationHistory([job]).changes) if (!dismissed.has(item.id)) merged.set(item.id, item);
    await saveRecentCookieChanges(normalizeRecentChanges([...merged.values()].sort(compareRecentChangeOrder)));
  });
}

export async function clearHistoryKind(itemKind, operationChangeIds) {
  return withStorageWriteLock(RECENT_CHANGES_KEY, async () => {
    const changes = normalizeRecentChanges(await getRecentCookieChanges());
    const clearedIds = changes.filter((item) => item.itemKind === itemKind).map((item) => item.id);
    const dismissed = new Set([...await getDismissedChangeIds(), ...clearedIds, ...operationChangeIds]);
    await callChrome("storage.session.set", { [DISMISSED_CHANGES_KEY]: [...dismissed] });
    await saveRecentCookieChanges(changes.filter((item) => item.itemKind !== itemKind));
    const snapshots = await getRecentChangeSnapshots();
    for (const id of clearedIds) delete snapshots[id];
    await saveRecentChangeSnapshots(snapshots);
  });
}

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
