import { callChrome } from "./chrome-call.js";
import { normalizeFavoriteItemIds } from "./favorites.js";

const COOKIE_TEMPLATES_KEY = "cookieTemplates";
export const FAVORITE_SITE_DATA_IDS_KEY = "favoriteSiteDataIds";
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
