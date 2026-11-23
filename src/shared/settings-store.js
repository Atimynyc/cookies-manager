import { t } from "./i18n.js";
import { callChrome } from "./chrome-call.js";
import { hasAllSitesPermission } from "./cookie-api.js";
import { normalizeFavoriteItemIds } from "./favorites.js";
import { getSiteOrigin } from "./url.js";
import { withStorageWriteLock } from "./storage-write-coordinator.js";

export const FAVORITE_SITE_DATA_IDS_KEY = "favoriteSiteDataIds";
export const ALL_SITES_ACCESS_KEY = "allSitesAccess";
export const ALL_SITES_ACCESS_GENERATION_KEY = "allSitesAccessGeneration";
export const ALL_SITES_ACCESS_RESULT_KEY_PREFIX = "allSitesAccessResult:";
export const SITE_ACCESS_CONSENTS_KEY = "siteAccessConsents";
export const SITE_ACCESS_CONSENT_KEY_PREFIX = "siteAccessConsent:";
export const LAST_VIEWED_SITE_DATA_KEY_PREFIX = "lastViewedSiteData:";
const SITE_DATA_VIEWS = ["cookies", "localStorage", "sessionStorage"];
const DEFAULT_PREFERENCES = {
  [ALL_SITES_ACCESS_KEY]: false,
  autoRefreshPage: false,
  valueToolMode: "none",
  columnWidths: null,
  columnWidthsVersion: 0
};

export async function getPreferences() {
  const result = await callChrome("storage.local.get", {
    ...DEFAULT_PREFERENCES,
    [ALL_SITES_ACCESS_GENERATION_KEY]: ""
  });
  result[ALL_SITES_ACCESS_KEY] = await resolveAllSitesAccessIntent(result);
  return result;
}

export async function getAllSitesAccessIntent() {
  const result = await callChrome("storage.local.get", {
    [ALL_SITES_ACCESS_KEY]: false,
    [ALL_SITES_ACCESS_GENERATION_KEY]: ""
  });
  return {
    generation: result[ALL_SITES_ACCESS_GENERATION_KEY],
    enabled: await resolveAllSitesAccessIntent(result)
  };
}

async function resolveAllSitesAccessIntent(result) {
  if (result[ALL_SITES_ACCESS_KEY] !== true) return false;
  const generation = result[ALL_SITES_ACCESS_GENERATION_KEY];
  if (!generation) return true;
  const key = `${ALL_SITES_ACCESS_RESULT_KEY_PREFIX}${generation}`;
  const outcome = await callChrome("storage.local.get", { [key]: null });
  return outcome[key] !== false;
}

export function isAllSitesAccessStorageChange(changes) {
  return Object.keys(changes).some(key => key === ALL_SITES_ACCESS_KEY
    || key === ALL_SITES_ACCESS_GENERATION_KEY
    || key.startsWith(ALL_SITES_ACCESS_RESULT_KEY_PREFIX));
}

export async function savePreferences(nextPreferences) {
  await callChrome("storage.local.set", nextPreferences);
}

export async function getSiteAccessConsents() {
  const result = await callChrome("storage.local.get", null);
  const origins = new Set(normalizeSiteAccessConsents(result[SITE_ACCESS_CONSENTS_KEY]));
  for (const [key, consent] of Object.entries(result)) {
    if (!key.startsWith(SITE_ACCESS_CONSENT_KEY_PREFIX)) continue;
    const origin = key.slice(SITE_ACCESS_CONSENT_KEY_PREFIX.length);
    if (getSiteOrigin(origin) !== origin) continue;
    if (consent === true) origins.add(origin);
    else if (consent === false) origins.delete(origin);
  }
  return [...origins];
}

export function getSiteAccessConsentStorageKey(url) {
  const origin = getSiteOrigin(url);
  return origin ? `${SITE_ACCESS_CONSENT_KEY_PREFIX}${origin}` : "";
}

export async function hasSiteAccessConsent(url) {
  const origin = getSiteOrigin(url);
  if (!origin) {
    return false;
  }
  const key = getSiteAccessConsentStorageKey(url);
  const result = await callChrome("storage.local.get", {
    [ALL_SITES_ACCESS_KEY]: false,
    [ALL_SITES_ACCESS_GENERATION_KEY]: "",
    [key]: null,
    [SITE_ACCESS_CONSENTS_KEY]: []
  });
  if (await resolveAllSitesAccessIntent(result) && await hasAllSitesPermission()) return true;
  return typeof result[key] === "boolean" ? result[key] : normalizeSiteAccessConsents(result[SITE_ACCESS_CONSENTS_KEY]).includes(origin);
}

export async function grantSiteAccessConsent(url) {
  const key = getSiteAccessConsentStorageKey(url);
  if (!key) return false;
  // Enqueue an atomic write before the native prompt can close or reload this context.
  await callChrome("storage.local.set", { [key]: true });
  return true;
}

export async function revokeSiteAccessConsent(url) {
  const key = getSiteAccessConsentStorageKey(url);
  if (!key) return false;
  await callChrome("storage.local.set", { [key]: false });
  return true;
}

function normalizeSiteAccessConsents(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((origin) => typeof origin === "string" && origin.length > 0))];
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
    throw new TypeError(t("A favorite item ID and enabled state are required."));
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
