import { callChrome } from "./chrome-call.js";

const COOKIE_TEMPLATES_KEY = "cookieTemplates";
const DEFAULT_PREFERENCES = {
  autoRefreshPage: false,
  valueToolMode: "none",
  columnWidths: null
};

export async function getPreferences() {
  return callChrome("storage.local.get", DEFAULT_PREFERENCES);
}

export async function savePreferences(nextPreferences) {
  await callChrome("storage.local.set", nextPreferences);
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
