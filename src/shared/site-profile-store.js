import { callChrome } from "./chrome-call.js";
import { normalizeSiteProfiles } from "./site-profiles.js";

export const SITE_PROFILES_KEY = "siteDataProfiles";
export const MAX_SITE_PROFILES = 50;

export async function getSiteProfiles() {
  const result = await callChrome("storage.local.get", { [SITE_PROFILES_KEY]: [] });
  return normalizeSiteProfiles(result[SITE_PROFILES_KEY]);
}

export async function saveSiteProfiles(profiles) {
  const normalized = normalizeSiteProfiles(profiles);
  const existing = await getSiteProfiles();
  const existingIds = new Set(existing.map((profile) => profile.id));
  const addsProfiles = normalized.length > existing.length
    || normalized.some((profile) => !existingIds.has(profile.id));
  if (normalized.length > MAX_SITE_PROFILES && addsProfiles) {
    throw Object.assign(new Error(
      `Saved States is limited to ${MAX_SITE_PROFILES} states. Return to the Saved States list and delete unused states before saving or copying another state. Your existing states have not been changed.`
    ), { code: "SAVED_STATE_LIMIT_REACHED" });
  }

  const quota = chrome.storage.local.QUOTA_BYTES;
  try {
    if (Number.isFinite(quota) && quota > 0 && typeof chrome.storage.local.getBytesInUse === "function") {
      const [totalBytes, storedProfileBytes] = await Promise.all([
        callChrome("storage.local.getBytesInUse", null),
        callChrome("storage.local.getBytesInUse", SITE_PROFILES_KEY)
      ]);
      const encoder = new TextEncoder();
      const nextProfileBytes = encoder.encode(SITE_PROFILES_KEY).length
        + encoder.encode(JSON.stringify(normalized)).length;
      const projectedBytes = totalBytes - storedProfileBytes + nextProfileBytes;
      if (projectedBytes > quota && nextProfileBytes > storedProfileBytes) {
        throw createQuotaError(quota, projectedBytes);
      }
    }
    await callChrome("storage.local.set", { [SITE_PROFILES_KEY]: normalized });
  } catch (error) {
    if (error.code === "SAVED_STATE_QUOTA_EXCEEDED") {
      throw error;
    }
    if (/quota/i.test(error.message)) {
      throw createQuotaError(quota, null, error);
    }
    throw error;
  }
  return normalized;
}

function createQuotaError(quota, projectedBytes, cause) {
  const usage = Number.isFinite(quota) && quota > 0
    ? ` (Chrome limit: ${formatBytes(quota)}${projectedBytes == null ? "" : `; required: ${formatBytes(projectedBytes)}`})`
    : "";
  return Object.assign(new Error(
    `Extension storage is full${usage}. Return to the Saved States list and delete unused states, or save fewer site data entries, then try again. Your existing states have not been changed.`,
    cause ? { cause } : undefined
  ), { code: "SAVED_STATE_QUOTA_EXCEEDED" });
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}
