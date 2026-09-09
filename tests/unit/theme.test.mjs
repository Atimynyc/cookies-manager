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
