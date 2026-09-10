import { callChrome } from "./chrome-call.js";
import { normalizeFavoriteItemIds } from "./favorites.js";
import { getSiteOrigin } from "./url.js";
import { withStorageWriteLock } from "./storage-write-coordinator.js";

export const FAVORITE_SITE_DATA_IDS_KEY = "favoriteSiteDataIds";
export const LAST_VIEWED_SITE_DATA_KEY_PREFIX = "lastViewedSiteData:";
const SITE_DATA_VIEWS = ["cookies", "localStorage", "sessionStorage"];
const DEFAULT_PREFERENCES = {
  autoRefreshPage: false,
  valueToolMode: "none",
  columnWidths: null,
  columnWidthsVersion: 0
};

export async function getPreferences() {
  return callChrome("storage.local.get", DEFAULT_PREFERENCES);
}

export async function savePreferences(nextPreferences) {
  await callChrome("storage.local.set", nextPreferences);
}

export async function getFavoriteSiteDataIds() {
  const result = await callChrome("storage.local.get", {
    [FAVORITE_SITE_DATA_IDS_KEY]: []
  });
  return normalizeFavoriteItemIds(result[FAVORITE_SITE_DATA_IDS_KEY]);
}

export async function saveFavoriteSiteDataIds(itemIds) {
  const normalized = normalizeFavoriteItemIds(itemIds);
  return withStorageWriteLock(FAVORITE_SITE_DATA_IDS_KEY, async () => {
    await callChrome("storage.local.set", { [FAVORITE_SITE_DATA_IDS_KEY]: normalized });
    return normalized;
  });
}

export async function setFavoriteSiteDataId(itemId, enabled) {
  if (typeof itemId !== "string" || !itemId || typeof enabled !== "boolean") {
    throw new TypeError("A favorite item ID and enabled state are required.");
  }
  return withStorageWriteLock(FAVORITE_SITE_DATA_IDS_KEY, async () => {
    const current = await getFavoriteSiteDataIds();
    const favorites = new Set(current);
    if (enabled) {
      favorites.add(itemId);
    } else {
      favorites.delete(itemId);
    }
    const next = [...favorites];
    if (next.length !== current.length) {
      await callChrome("storage.local.set", { [FAVORITE_SITE_DATA_IDS_KEY]: next });
    }
    return next;
  });
}

export function normalizeLastViewedSiteData(value) {
  const selectedIds = Object.fromEntries(SITE_DATA_VIEWS.map((view) => [
    view,
    typeof value?.selectedIds?.[view] === "string" ? value.selectedIds[view] : ""
  ]));

  return {
    activeDataView: SITE_DATA_VIEWS.includes(value?.activeDataView)
      ? value.activeDataView
      : "cookies",
    selectedIds
  };
}

export function getLastViewedSiteDataStorageKey(url) {
  const origin = getSiteOrigin(url);
  return origin ? `${LAST_VIEWED_SITE_DATA_KEY_PREFIX}${encodeURIComponent(origin)}` : "";
}

export async function getLastViewedSiteData(url) {
  const storageKey = getLastViewedSiteDataStorageKey(url);
  if (!storageKey) {
    return normalizeLastViewedSiteData(null);
  }

  const result = await callChrome("storage.local.get", { [storageKey]: null });
  return normalizeLastViewedSiteData(result[storageKey]);
}

export async function saveLastViewedSiteData(url, value) {
  const storageKey = getLastViewedSiteDataStorageKey(url);
  if (!storageKey) {
    return;
  }

  const selectedPatch = Object.fromEntries(SITE_DATA_VIEWS
    .filter((view) => typeof value?.selectedIds?.[view] === "string")
    .map((view) => [view, value.selectedIds[view]]));
  const activeDataView = SITE_DATA_VIEWS.includes(value?.activeDataView) ? value.activeDataView : null;
  return withStorageWriteLock(storageKey, async () => {
    const current = await getLastViewedSiteData(url);
    const next = {
      activeDataView: activeDataView || current.activeDataView,
      selectedIds: { ...current.selectedIds, ...selectedPatch }
    };
    await callChrome("storage.local.set", { [storageKey]: next });
    return next;
  });
}
