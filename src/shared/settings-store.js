import { callChrome } from "./chrome-call.js";
import { normalizeFavoriteItemIds } from "./favorites.js";
import { getSiteOrigin } from "./url.js";

const COOKIE_TEMPLATES_KEY = "cookieTemplates";
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
  await callChrome("storage.local.set", {
    [FAVORITE_SITE_DATA_IDS_KEY]: normalizeFavoriteItemIds(itemIds)
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

  await callChrome("storage.local.set", {
    [storageKey]: normalizeLastViewedSiteData(value)
  });
}

export async function getCookieTemplates() {
  const result = await callChrome("storage.local.get", {
    [COOKIE_TEMPLATES_KEY]: []
  });
  return normalizeCookieTemplates(result[COOKIE_TEMPLATES_KEY]);
}

export async function saveCookieTemplates(templates) {
  await callChrome("storage.local.set", {
    [COOKIE_TEMPLATES_KEY]: normalizeCookieTemplates(templates)
  });
}

export function normalizeCookieTemplates(templates, limit = 12) {
  if (!Array.isArray(templates)) {
    return [];
  }

  return templates
    .filter((template) => template && typeof template.label === "string" && typeof template.value === "string")
    .slice(0, limit);
}
