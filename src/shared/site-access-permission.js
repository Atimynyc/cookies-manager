import { ALL_SITES_PERMISSION_ORIGINS, hasAllSitesPermission, requestSitePermission } from "./cookie-api.js";
import {
  ALL_SITES_ACCESS_KEY,
  ALL_SITES_ACCESS_GENERATION_KEY,
  ALL_SITES_ACCESS_RESULT_KEY_PREFIX,
  getAllSitesAccessIntent,
  grantSiteAccessConsent,
  revokeSiteAccessConsent,
  savePreferences
} from "./settings-store.js";
import { callChrome } from "./chrome-call.js";
import { t } from "./i18n.js";
import { isSupportedPageUrl } from "./url.js";
import { withStorageWriteLock } from "./storage-write-coordinator.js";

export async function requestConfirmedSitePermission(url) {
  if (!isSupportedPageUrl(url)) return false;

  const confirmation = grantSiteAccessConsent(url);
  try {
    // Start the native request in the click handler's call stack to retain its user gesture.
    const [, granted] = await Promise.all([confirmation, requestSitePermission(url)]);
    if (!granted) await revokeSiteAccessConsent(url);
    return granted;
  } catch (error) {
    await confirmation.catch(() => {});
    await revokeSiteAccessConsent(url).catch(() => {});
    throw error;
  }
}

export async function requestConfirmedAllSitesPermission() {
  const generation = crypto.randomUUID();
  const confirmation = savePreferences({
    [ALL_SITES_ACCESS_KEY]: true,
    [ALL_SITES_ACCESS_GENERATION_KEY]: generation
  });
  try {
    // Do not await storage before requesting: Chrome requires this call in the user gesture.
    const [, granted] = await Promise.all([
      confirmation,
      callChrome("permissions.request", { origins: [...ALL_SITES_PERMISSION_ORIGINS] })
    ]);
    return await settleAllSitesPermission(generation, granted);
  } catch (error) {
    await confirmation.catch(() => {});
    await settleAllSitesPermission(generation, false).catch(() => {});
    throw error;
  }
}

export async function disableAllSitesAccess() {
  // Stop accepting global consent before revoking the browser's optional host grants.
  await savePreferences({
    [ALL_SITES_ACCESS_KEY]: false,
    [ALL_SITES_ACCESS_GENERATION_KEY]: crypto.randomUUID()
  });
  await withStorageWriteLock(ALL_SITES_ACCESS_KEY, async () => {
    try {
      if (!(await getAllSitesAccessIntent()).enabled) await removeAllSitesPermission();
    } finally {
      await pruneAllSitesPermissionOutcomes().catch(() => {});
    }
  });
}

async function settleAllSitesPermission(generation, granted) {
  // This lock covers only result reconciliation, never a native permission prompt.
  return withStorageWriteLock(ALL_SITES_ACCESS_KEY, async () => {
    try {
      const outcomeKey = `${ALL_SITES_ACCESS_RESULT_KEY_PREFIX}${generation}`;
      // A generation-specific outcome cannot overwrite a newer surface's enable intent.
      if (!granted) await savePreferences({ [outcomeKey]: false });
      const current = await getAllSitesAccessIntent();
      if (!current.enabled) {
        // A denied request must preserve any optional site grants the user already held.
        // Revoke only a grant that completed after another surface turned global access off.
        if (granted) await removeAllSitesPermission();
        return false;
      }
      if (current.generation !== generation) return false;
      if (granted && await hasAllSitesPermission()) return true;
      // Another surface may have revoked the grant while this request was completing.
      await savePreferences({ [outcomeKey]: false });
      return false;
    } finally {
      await pruneAllSitesPermissionOutcomes().catch(() => {});
    }
  });
}

async function pruneAllSitesPermissionOutcomes() {
  const stored = await callChrome("storage.local.get", null);
  const currentOutcome = `${ALL_SITES_ACCESS_RESULT_KEY_PREFIX}${stored[ALL_SITES_ACCESS_GENERATION_KEY]}`;
  const stale = Object.keys(stored).filter(key => key.startsWith(ALL_SITES_ACCESS_RESULT_KEY_PREFIX) && key !== currentOutcome);
  if (stale.length) await callChrome("storage.local.remove", stale);
}

async function removeAllSitesPermission() {
  const removed = await callChrome("permissions.remove", { origins: [...ALL_SITES_PERMISSION_ORIGINS] });
  if (!removed) throw new Error(t("Could not save settings. Please try again."));
}
