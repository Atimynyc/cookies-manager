import { callChrome } from "./chrome-call.js";
import {
  duplicateSiteProfile,
  normalizeSiteProfile,
  normalizeSiteProfiles,
  renameSiteProfile
} from "./site-profiles.js";
import { withStorageWriteLock } from "./storage-write-coordinator.js";

export const SITE_PROFILES_KEY = "siteDataProfiles";
export const MAX_SITE_PROFILES = 50;

export async function getSiteProfiles() {
  const result = await callChrome("storage.local.get", { [SITE_PROFILES_KEY]: [] });
  return normalizeSiteProfiles(result[SITE_PROFILES_KEY]);
}

export async function saveSiteProfiles(profiles) {
  const normalized = normalizeSiteProfiles(profiles);
  return withStorageWriteLock(SITE_PROFILES_KEY, async () => {
    const existing = await getSiteProfiles();
    return writeSiteProfiles(normalized, existing);
  });
}

export async function addSiteProfile(profile) {
  const normalized = normalizeSiteProfile(profile);
  return mutateSiteProfiles((existing) => {
    if (existing.some((item) => item.id === normalized.id)) {
      throw Object.assign(new Error("A saved state with this ID already exists. Reload Saved States and try again."), {
        code: "SAVED_STATE_ALREADY_EXISTS"
      });
    }
    return [normalized, ...existing];
  });
}

export async function renameStoredSiteProfile(id, name) {
  return mutateSiteProfiles((existing) => {
    const current = requireStoredSiteProfile(existing, id);
    const renamed = renameSiteProfile(current, name);
    return existing.map((profile) => profile.id === id ? renamed : profile);
  });
}

export async function duplicateStoredSiteProfile(id) {
  return mutateSiteProfiles((existing) => [duplicateSiteProfile(requireStoredSiteProfile(existing, id)), ...existing]);
}

export async function deleteStoredSiteProfile(id) {
  return mutateSiteProfiles((existing) => existing.filter((profile) => profile.id !== id));
}

async function mutateSiteProfiles(update) {
  return withStorageWriteLock(SITE_PROFILES_KEY, async () => {
    const existing = await getSiteProfiles();
    return writeSiteProfiles(update(existing), existing);
  });
}

function requireStoredSiteProfile(profiles, id) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) {
    throw Object.assign(new Error("This saved state no longer exists. Reload Saved States and select another state."), {
      code: "SAVED_STATE_NOT_FOUND"
    });
  }
  return profile;
}

async function writeSiteProfiles(normalized, existing) {
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
