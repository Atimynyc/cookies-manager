import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const themeScript = await readFile(new URL("../../src/popup/popup-theme.js", import.meta.url), "utf8");
const themeCss = await readFile(new URL("../../src/popup/popup-themes.css", import.meta.url), "utf8");
const componentCss = await readFile(new URL("../../src/popup/popup.css", import.meta.url), "utf8");

test("detects incognito mode from the extension or active tab context", () => {
  assert.equal(runThemeScript({ extensionIncognito: false, tabIncognito: false }), "light");
  assert.equal(runThemeScript({ extensionIncognito: false, tabIncognito: true }), "incognito");
  assert.equal(runThemeScript({ extensionIncognito: true, tabIncognito: false }), "incognito");
  assert.equal(runThemeScript(), "light");
});

test("keeps every theme palette token-complete and component colors tokenized", () => {
  const lightTokens = getThemeTokens(/:root,\s*:root\[data-theme="light"\]\s*\{([^}]*)\}/);
  const incognitoTokens = getThemeTokens(/:root\[data-theme="incognito"\]\s*\{([^}]*)\}/);

  assert.ok(lightTokens.length > 0);
  assert.deepEqual(incognitoTokens, lightTokens);
  assert.doesNotMatch(componentCss, /#[0-9a-f]{3,8}|rgba?\(/i);
});

test("regular and incognito choices stay independent and ignore system appearance", () => {
  const documentElement = { dataset: {} };
  const context = {
    document: { documentElement },
    matchMedia: () => { throw new Error("System appearance must not affect mode defaults"); },
    chrome: { extension: { inIncognitoContext: false } }
  };
  vm.runInNewContext(themeScript, context);
  const controller = context.cookieControllerTheme;
  assert.equal(documentElement.dataset.theme, "light");
  controller.setPreference("dark");
  assert.equal(documentElement.dataset.theme, "incognito");
  assert.equal(controller.getStorageKey(), "uiThemeRegular");
  controller.setActiveTabIncognito(true);
  assert.equal(documentElement.dataset.theme, "incognito");
  assert.equal(controller.getStorageKey(), "uiThemeIncognito");
  controller.setPreference("light");
  assert.equal(documentElement.dataset.theme, "light");
  controller.setActiveTabIncognito(false);
  assert.equal(documentElement.dataset.theme, "incognito");
  controller.setActiveTabIncognito(true);
  assert.equal(documentElement.dataset.theme, "light");
  assert.equal(controller.getPreference("regular"), "dark");
  assert.equal(controller.getPreference("incognito"), "light");
});

test("stored mode choices survive reopening and synchronize only their own mode", async () => {
  const stored = { uiThemeRegular: "dark", uiThemeIncognito: "light" };
  const listeners = [];
  const create = () => {
    const context = {
      document: { documentElement: { dataset: {} } },
      chrome: { runtime: {}, storage: {
        local: { get(defaults, callback) { callback({ ...defaults, ...stored }); } },
        onChanged: { addListener(listener) { listeners.push(listener); } }
      } }
    };
    vm.runInNewContext(themeScript, context);
    return context;
  };
  const first = create();
  const second = create();
  await Promise.all([first.cookieControllerTheme.ready, second.cookieControllerTheme.ready]);
  const controller = second.cookieControllerTheme;
  const dataset = second.document.documentElement.dataset;
  assert.equal(dataset.theme, "incognito");
  controller.setActiveTabIncognito(true);
  assert.equal(dataset.theme, "light");
  for (const listener of listeners) listener({ uiThemeRegular: { newValue: "light" } }, "local");
  assert.equal(dataset.theme, "light");
  assert.equal(first.document.documentElement.dataset.theme, "light");
  for (const listener of listeners) listener({ uiThemeIncognito: { newValue: "dark" } }, "local");
  assert.equal(dataset.theme, "incognito");
  assert.equal(first.document.documentElement.dataset.theme, "light");
  for (const listener of listeners) listener({ uiThemeRegular: { newValue: "dark" } }, "sync");
  assert.equal(first.document.documentElement.dataset.theme, "light");
});

test("late startup reads cannot overwrite mode changes or a newer active tab", async () => {
  let readStorage;
  let readTabs;
  const context = {
    document: { documentElement: { dataset: {} } },
    chrome: {
      runtime: {},
      storage: { local: { get(defaults, callback) { readStorage = callback; } } },
      tabs: { query(options, callback) { readTabs = callback; } }
    }
  };
  vm.runInNewContext(themeScript, context);
  const controller = context.cookieControllerTheme;
  controller.setActiveTabIncognito(true);
  controller.setPreference("light");
  readStorage({ uiThemeRegular: "dark", uiThemeIncognito: "dark" });
  readTabs([{ incognito: false }]);
  await controller.ready;
  assert.equal(controller.getScope(), "incognito");
  assert.equal(controller.getPreference(), "light");
  controller.setActiveTabIncognito(false);
  assert.equal(controller.getPreference(), "dark");
});

test("removing a saved choice restores each mode's own default", () => {
  const documentElement = { dataset: {} };
  const context = { document: { documentElement } };
  vm.runInNewContext(themeScript, context);
  const controller = context.cookieControllerTheme;
  controller.setPreference("dark");
  controller.setPreference(null);
  assert.equal(documentElement.dataset.theme, "light");
  controller.setActiveTabIncognito(true);
  controller.setPreference("light");
  controller.setPreference(null);
  assert.equal(documentElement.dataset.theme, "incognito");
});

function runThemeScript(options = null) {
  const documentElement = { dataset: {} };
  const context = {
    document: { documentElement }
  };
  if (options) {
    context.chrome = {
      extension: { inIncognitoContext: options.extensionIncognito },
      runtime: {},
      tabs: {
        query(queryInfo, callback) {
          assert.equal(queryInfo.active, true);
          assert.equal(queryInfo.currentWindow, true);
          callback([{ incognito: options.tabIncognito }]);
        }
      }
    };
  }

  vm.runInNewContext(themeScript, context);
  return documentElement.dataset.theme;
}

function getThemeTokens(blockPattern) {
  const block = themeCss.match(blockPattern)?.[1] || "";
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)]
    .map((match) => match[1])
    .sort();
}
