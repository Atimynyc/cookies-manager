import { callChrome } from "./chrome-call.js";
import { normalizeSiteProfiles } from "./site-profiles.js";

export const SITE_PROFILES_KEY = "siteDataProfiles";

export async function getSiteProfiles() {
  const result = await callChrome("storage.local.get", { [SITE_PROFILES_KEY]: [] });
  return normalizeSiteProfiles(result[SITE_PROFILES_KEY]);
}

export async function saveSiteProfiles(profiles) {
  const normalized = normalizeSiteProfiles(profiles);
  await callChrome("storage.local.set", { [SITE_PROFILES_KEY]: normalized });
  return normalized;
}
