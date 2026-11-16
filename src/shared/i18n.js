import { detectChromeLanguage, getUiPreferences, normalizeUiLanguage, saveUiPreference } from "./ui-preferences.js";

let languagePreference = null;
let activeCatalog = null;
let languageRequest = 0;
let initialization;
let pendingLanguageChange;
const catalogs = new Map();
const languageListeners = new Set();
const localizedNodes = new WeakMap();

export const getLanguagePreference = () => languagePreference || detectChromeLanguage();

async function loadCatalog(language) {
  if (!catalogs.has(language)) {
    const request = fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`))
      .then(response => {
        if (!response.ok) throw new Error("Language catalog unavailable");
        return response.json();
      }).catch(error => { catalogs.delete(language); throw error; });
    catalogs.set(language, request);
  }
  return catalogs.get(language);
}

async function applyLanguagePreference(value) {
  const language = normalizeUiLanguage(value);
  const request = ++languageRequest;
  const catalog = await loadCatalog(language);
  if (request !== languageRequest || language === languagePreference) return;
  languagePreference = language;
  activeCatalog = catalog;
  for (const listener of languageListeners) listener();
}

export function initializeI18n() {
  if (!initialization) initialization = (async () => {
    if (!globalThis.chrome?.storage?.local) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.uiLanguage) {
        pendingLanguageChange = applyLanguagePreference(changes.uiLanguage.newValue).catch(() => {});
      }
    });
    const request = languageRequest;
    try {
      const preferences = await getUiPreferences();
      if (request === languageRequest) await applyLanguagePreference(preferences.uiLanguage);
      else await pendingLanguageChange;
    } catch {
      // Keep the detected interface usable if preferences cannot be saved or read.
      if (request === languageRequest) await applyLanguagePreference(detectChromeLanguage()).catch(() => {});
    }
  })();
  return initialization;
}

export async function setUiLanguage(value) {
  const language = normalizeUiLanguage(value);
  try { await loadCatalog(language); } catch { throw new Error(t("Could not load this language. Please try again.")); }
  try { await saveUiPreference("uiLanguage", language); }
  catch { throw new Error(t("Could not save settings. Please try again.")); }
  await applyLanguagePreference(language);
}

export function onLanguageChanged(listener) {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

// English source strings are stable message identifiers and readable fallbacks.
export function messageKey(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  const label = source.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
  return `m_${label}_${(hash >>> 0).toString(16)}`;
}

export function t(source, ...values) {
  // Tagged templates keep dynamic values separate from translatable text.
  const template = Array.isArray(source);
  const text = template
    ? source.map((part, index) => part + (index < values.length ? `$${index + 1}` : "")).join("")
    : source;
  const substitutions = (template ? values : (values[0] || [])).map(String);
  if (activeCatalog) {
    const entry = activeCatalog[messageKey(text)];
    if (!entry) return substitute(text, substitutions);
    return entry.message.replace(/\$([a-z0-9_]+)\$|\$\$/gi, (match, name) => {
      if (match === "$$") return "$";
      const placeholder = entry.placeholders?.[name.toLowerCase()];
      return placeholder ? substitute(placeholder.content, substitutions) : match;
    });
  }
  try {
    const translated = globalThis.chrome?.i18n?.getMessage(messageKey(text), substitutions);
    if (translated) return translated;
  } catch {
    // Keep the UI usable in tests, previews, and browsers without i18n support.
  }
  return substitute(text, substitutions);
}

function substitute(text, substitutions) {
  return text.replace(/\$([1-9])/g, (match, index) => substitutions[Number(index) - 1] ?? match);
}

export function getUiLocale() {
  return getLanguagePreference().replaceAll("_", "-");
}

// Only marked extension markup is localized. Retain originals for live switching.
// Never scan or translate cookie values, editor contents, or imported data.
export function localizeDocument(root = document) {
  for (const template of root.querySelectorAll("template")) {
    localizeDocument(template.content);
  }
  for (const element of root.querySelectorAll("[data-i18n-attrs]")) {
    if (!element.dataset.i18nOriginalAttrs) element.dataset.i18nOriginalAttrs = JSON.stringify(
      Object.fromEntries(element.dataset.i18nAttrs.split(" ").map(attribute => [attribute, element.getAttribute(attribute)])));
    const originals = JSON.parse(element.dataset.i18nOriginalAttrs);
    for (const attribute of element.dataset.i18nAttrs.split(" ")) {
      element.setAttribute(attribute, t(originals[attribute]));
    }
  }
  for (const element of Array.from(root.querySelectorAll("[data-i18n]")).reverse()) {
    const source = element.dataset.i18n;
    let record = localizedNodes.get(element);
    // Dynamic labels are refreshed by their view, not replaced with initial markup.
    const ownText = () => Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join("");
    if (record && (ownText() !== record.lastText
      || Array.from(element.children).some(child => !record.slots.includes(child)))) continue;
    if (!record) {
      record = { slots: Array.from(element.childNodes).filter(node => node.nodeType === 1) };
      localizedNodes.set(element, record);
    }
    const slots = record.slots;
    const markers = slots.map((_, index) => `\uFFF0${index}\uFFF1`);
    const text = t(source, markers);
    const parts = text.split(/(\uFFF0\d+\uFFF1)/);
    element.replaceChildren(...parts.map((part) => {
      const match = /^\uFFF0(\d+)\uFFF1$/.exec(part);
      return match && slots[Number(match[1])] ? slots[Number(match[1])] : document.createTextNode(part);
    }));
    record.lastText = ownText();
  }
  if (root.documentElement) root.documentElement.lang = getUiLocale();
}
