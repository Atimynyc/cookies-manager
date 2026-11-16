import { callChrome } from "./chrome-call.js";
import { withStorageWriteLock } from "./storage-write-coordinator.js";

export const UI_LANGUAGES = Object.freeze([
  { value: "en", label: "English" },
  { value: "zh_CN", label: "简体中文" },
  { value: "zh_TW", label: "繁體中文" },
  { value: "es", label: "Español" },
  { value: "pt_BR", label: "Português (Brasil)" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "ja", label: "日本語" },
  { value: "ro", label: "Română" }
]);

export function normalizeUiLanguage(value) {
  return UI_LANGUAGES.some(language => language.value === value) ? value : "en";
}

export function detectChromeLanguage(value = globalThis.chrome?.i18n?.getUILanguage?.()
  || globalThis.chrome?.i18n?.getMessage?.("@@ui_locale")) {
  const parts = typeof value === "string" ? value.toLowerCase().replaceAll("_", "-").split("-") : [];
  if (parts[0] === "zh") {
    if (parts.includes("hans")) return "zh_CN";
    return parts.some(part => ["hant", "tw", "hk", "mo"].includes(part)) ? "zh_TW" : "zh_CN";
  }
  if (parts[0] === "pt") return "pt_BR";
  return normalizeUiLanguage(parts[0]);
}

export async function getUiPreferences() {
  const preferences = await callChrome("storage.local.get", { uiLanguage: null });
  if (!UI_LANGUAGES.some(language => language.value === preferences.uiLanguage)) {
    // Resolve first-install and legacy Automatic preferences once across extension surfaces.
    preferences.uiLanguage = await withStorageWriteLock("uiLanguage", async () => {
      const current = await callChrome("storage.local.get", { uiLanguage: null });
      if (UI_LANGUAGES.some(language => language.value === current.uiLanguage)) return current.uiLanguage;
      const language = detectChromeLanguage();
      await callChrome("storage.local.set", { uiLanguage: language });
      return language;
    });
  }
  return {
    uiLanguage: normalizeUiLanguage(preferences.uiLanguage)
  };
}

export function saveUiPreference(key, value) {
  if (!["uiLanguage", "uiThemeRegular", "uiThemeIncognito"].includes(key)) throw new TypeError("Unknown UI preference");
  if (key !== "uiLanguage" && !["light", "dark"].includes(value)) throw new TypeError("Unknown color theme");
  const normalized = key === "uiLanguage" ? normalizeUiLanguage(value) : value;
  const save = () => callChrome("storage.local.set", { [key]: normalized });
  return key === "uiLanguage" ? withStorageWriteLock(key, save) : save();
}
