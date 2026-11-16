import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { t, messageKey, getUiLocale } from "../../src/shared/i18n.js";
import { detectChromeLanguage, getUiPreferences, saveUiPreference } from "../../src/shared/ui-preferences.js";
import { installWebLocks } from "../helpers/web-locks.mjs";

test("localization falls back to English and never interprets substituted data", () => {
  const previous = globalThis.chrome;
  try {
    delete globalThis.chrome;
    assert.equal(t("Save changes"), "Save changes");
    const name = '$1 <script> & "$&"';
    assert.equal(t`Delete ${name}?`, `Delete ${name}?`);
    assert.equal(t("$1 of $2 selected", [2, 9]), "2 of 9 selected");
    assert.equal(getUiLocale(), "en");
  } finally {
    globalThis.chrome = previous;
  }
});

test("native messages receive positional values separately from source identifiers", () => {
  const previous = globalThis.chrome;
  const calls = [];
  try {
    globalThis.chrome = { i18n: { getMessage(key, values) {
      if (key === "@@ui_locale") return "zh_TW";
      calls.push({ key, values });
      return `translated:${values.join("|")}`;
    } } };
    const raw = "$1 <b>user value</b>";
    assert.equal(t`Delete ${raw}?`, `translated:${raw}`);
    assert.deepEqual(calls[0], { key: messageKey("Delete $1?"), values: [raw] });
    assert.equal(getUiLocale(), "zh-TW");
  } finally {
    globalThis.chrome = previous;
  }
});

test("message identifiers distinguish punctuation and remain valid Chrome keys", () => {
  assert.notEqual(messageKey("Delete $1?"), messageKey("Delete $1"));
  assert.match(messageKey("A/B? $1"), /^[a-z0-9_]+$/);
});

test("manual language overrides Chrome, preserves literal placeholders, and survives write failures", async context => {
  installWebLocks(context);
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const listeners = [];
  let stored = { uiLanguage: "zh_TW" };
  let failWrite = false;
  try {
    globalThis.chrome = {
      runtime: { getURL: path => path },
      i18n: { getMessage: () => "native English", getUILanguage: () => "en-US" },
      storage: {
        onChanged: { addListener: listener => listeners.push(listener) },
        local: {
          get(defaults, callback) { callback({ ...defaults, ...stored }); },
          set(patch, callback) {
            if (failWrite) {
              chrome.runtime.lastError = { message: "quota" };
              callback();
              delete chrome.runtime.lastError;
            } else {
              stored = { ...stored, ...patch };
              callback();
              for (const listener of listeners) listener({ uiLanguage: { newValue: patch.uiLanguage } }, "local");
            }
          }
        }
      }
    };
    globalThis.fetch = async path => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), "utf8")) });
    const localized = await import("../../src/shared/i18n.js?manual-test");
    await localized.initializeI18n();
    assert.equal(localized.getUiLocale(), "zh-TW");
    const raw = '$1 <b>$slot_1$</b> & "$&"';
    assert.ok(localized.t`Delete ${raw}?`.includes(raw));
    await localized.setUiLanguage("en");
    assert.equal(localized.t("Save changes"), "Save changes");
    assert.equal(localized.getUiLocale(), "en");
    failWrite = true;
    await assert.rejects(localized.setUiLanguage("de"), /Could not save settings/);
    assert.equal(stored.uiLanguage, "en");
    assert.equal(localized.getUiLocale(), "en");
    failWrite = false;
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(localized.setUiLanguage("ja"), /Could not load this language/);
    assert.equal(stored.uiLanguage, "en");
    assert.equal(localized.getUiLocale(), "en");
    await localized.setUiLanguage("zh_TW");
    assert.equal(localized.getUiLocale(), "zh-TW");
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});

test("only the latest language change wins while catalogs load", async () => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const pending = new Map();
  const listeners = [];
  try {
    globalThis.chrome = {
      runtime: { getURL: path => path },
      storage: {
        onChanged: { addListener: listener => listeners.push(listener) },
        local: { get(defaults, callback) { callback({ ...defaults, uiLanguage: "en" }); } }
      }
    };
    globalThis.fetch = path => path.includes("/en/")
      ? Promise.resolve({ ok: true, json: async () => ({}) })
      : new Promise(resolve => pending.set(path, resolve));
    const localized = await import("../../src/shared/i18n.js?race-test");
    await localized.initializeI18n();
    listeners[0]({ uiLanguage: { newValue: "de" } }, "local");
    listeners[0]({ uiLanguage: { newValue: "fr" } }, "local");
    pending.get("_locales/fr/messages.json")({ ok: true, json: async () => ({}) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(localized.getUiLocale(), "fr");
    pending.get("_locales/de/messages.json")({ ok: true, json: async () => ({}) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(localized.getUiLocale(), "fr");
  } finally { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; }
});

test("first-install language matching handles regions, Chinese scripts, and English fallback", () => {
  for (const [input, expected] of [
    ["en-GB", "en"], ["zh-CN", "zh_CN"], ["zh-SG", "zh_CN"], ["zh", "zh_CN"],
    ["zh-TW", "zh_TW"], ["zh-HK", "zh_TW"], ["zh-MO", "zh_TW"],
    ["zh-Hant", "zh_TW"], ["zh-Hans-HK", "zh_CN"], ["zh_Hant_TW", "zh_TW"],
    ["pt-BR", "pt_BR"], ["pt-PT", "pt_BR"], ["es-MX", "es"], ["de-AT", "de"],
    ["fr-CA", "fr"], ["ja-JP", "ja"], ["ro", "ro"], ["ro-RO", "ro"], ["ro-MD", "ro"],
    ["RO_ro", "ro"], ["it-IT", "en"], ["ko-KR", "en"], [null, "en"]
  ]) assert.equal(detectChromeLanguage(input), expected, input);
});

for (const initial of [null, "auto"]) {
  test(`initial ${initial ?? "missing"} language is detected once and keeps later manual choices`, async context => {
    installWebLocks(context);
    const previousChrome = globalThis.chrome;
    const previousFetch = globalThis.fetch;
    const stored = initial === null ? {} : { uiLanguage: initial };
    const listeners = [];
    let browserLanguage = "zh-HK";
    let writes = 0;
    try {
      globalThis.chrome = {
        runtime: { getURL: path => path },
        i18n: { getUILanguage: () => browserLanguage },
        storage: {
          onChanged: { addListener: listener => listeners.push(listener) },
          local: {
            get(defaults, callback) { queueMicrotask(() => callback({ ...defaults, ...stored })); },
            set(patch, callback) {
              Object.assign(stored, patch);
              writes += 1;
              callback();
              for (const listener of listeners) listener({ uiLanguage: { newValue: patch.uiLanguage } }, "local");
            }
          }
        }
      };
      globalThis.fetch = async path => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), "utf8")) });
      const localized = await import(`../../src/shared/i18n.js?initial=${initial}`);
      await localized.initializeI18n();
      assert.equal(localized.getLanguagePreference(), "zh_TW");
      assert.equal(localized.t("Settings"), "設定");
      assert.equal(stored.uiLanguage, "zh_TW");
      assert.equal(writes, 1);
      browserLanguage = "fr-CA";
      assert.equal((await getUiPreferences()).uiLanguage, "zh_TW");
      assert.equal(writes, 1, "Chrome language changes must not reset the saved choice");
      await localized.setUiLanguage("ja");
      const reopened = await import(`../../src/shared/i18n.js?reopened=${initial}`);
      await reopened.initializeI18n();
      assert.equal(reopened.getUiLocale(), "ja");
      assert.equal(stored.uiLanguage, "ja");
    } finally { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; }
  });
}

test("concurrent first-run initialization preserves an intervening manual language choice", async context => {
  installWebLocks(context);
  const previousChrome = globalThis.chrome;
  let stored = {};
  try {
    globalThis.chrome = {
      runtime: {},
      i18n: { getUILanguage: () => "it-IT" },
      storage: { local: {
        get(defaults, callback) {
          const snapshot = { ...defaults, ...stored };
          queueMicrotask(() => callback(snapshot));
        },
        set(patch, callback) { stored = { ...stored, ...patch }; callback(); }
      } }
    };
    await Promise.all([getUiPreferences(), saveUiPreference("uiLanguage", "de"), getUiPreferences()]);
    assert.equal(stored.uiLanguage, "de");
    assert.equal((await getUiPreferences()).uiLanguage, "de");
    stored = {};
    assert.equal((await getUiPreferences()).uiLanguage, "en");
    assert.equal(stored.uiLanguage, "en");
  } finally { globalThis.chrome = previousChrome; }
});
