import assert from "node:assert/strict";
import test from "node:test";
import { installWebLocks } from "../helpers/web-locks.mjs";
import { disableAllSitesAccess, requestConfirmedAllSitesPermission, requestConfirmedSitePermission } from "../../src/shared/site-access-permission.js";
import { ALL_SITES_ACCESS_KEY, ALL_SITES_ACCESS_RESULT_KEY_PREFIX, getPreferences, getSiteAccessConsentStorageKey, hasSiteAccessConsent } from "../../src/shared/settings-store.js";
import { hasAllSitesPermission } from "../../src/shared/cookie-api.js";

function installPermissionRequest(t, { granted = true, error = "", storageError = "", removeError = "" } = {}) {
  const previousChrome = globalThis.chrome;
  installWebLocks(t);
  const browser = { data: {}, nativeRequests: 0, messages: 0, writes: 0, origins: new Set(), removals: [] };
  globalThis.chrome = {
    runtime: {
      sendMessage(_message, callback) {
        browser.messages += 1;
        chrome.runtime.lastError = { message: "The message port closed before a response was received." };
        callback();
        delete chrome.runtime.lastError;
      }
    },
    storage: {
      local: {
        get(defaults, callback) { callback({ ...defaults, ...browser.data }); },
        set(values, callback) {
          browser.writes += 1;
          if (!storageError) Object.assign(browser.data, values);
          queueMicrotask(() => {
            if (storageError) chrome.runtime.lastError = { message: storageError };
            callback();
            delete chrome.runtime.lastError;
          });
        },
        remove(keys, callback) {
          for (const key of keys) delete browser.data[key];
          callback();
        }
      }
    },
    permissions: {
      contains(options, callback) {
        callback(options.origins.every(origin => browser.origins.has(origin)));
      },
      request(options, callback) {
        browser.nativeRequests += 1;
        browser.confirmationEnqueuedBeforeNativePrompt = browser.writes > 0;
        browser.pattern = options.origins;
        if (granted && !error) options.origins.forEach(origin => browser.origins.add(origin));
        if (error) chrome.runtime.lastError = { message: error };
        callback(granted);
        delete chrome.runtime.lastError;
      },
      remove(options, callback) {
        browser.removals.push(options.origins);
        if (removeError) chrome.runtime.lastError = { message: removeError };
        else options.origins.forEach(origin => browser.origins.delete(origin));
        callback(!removeError);
        delete chrome.runtime.lastError;
      }
    }
  };
  t.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  return browser;
}

test("site authorization succeeds even when background message ports are unavailable", async (t) => {
  const browser = installPermissionRequest(t);
  assert.equal(await requestConfirmedSitePermission("https://example.com/account"), true);
  assert.equal(browser.messages, 0);
  assert.equal(await hasSiteAccessConsent("https://example.com"), true);
});

test("confirmation is enqueued before the native prompt without yielding the user gesture", async (t) => {
  const browser = installPermissionRequest(t);
  const result = requestConfirmedSitePermission("https://example.com/account");
  assert.equal(browser.nativeRequests, 1);
  assert.equal(browser.confirmationEnqueuedBeforeNativePrompt, true);
  assert.deepEqual(browser.pattern, ["http://example.com/*", "https://example.com/*"]);
  assert.equal(await result, true);
});

test("denied site permission clears confirmation and a second Allow can succeed", async (t) => {
  installPermissionRequest(t, { granted: false });
  assert.equal(await requestConfirmedSitePermission("https://example.com"), false);
  assert.equal(await hasSiteAccessConsent("https://example.com"), false);
  chrome.permissions.request = (_options, callback) => callback(true);
  assert.equal(await requestConfirmedSitePermission("https://example.com"), true);
  assert.equal(await hasSiteAccessConsent("https://example.com"), true);
});

test("native permission errors clear confirmation and preserve their original error", async (t) => {
  installPermissionRequest(t, { error: "Native permission failed" });
  await assert.rejects(requestConfirmedSitePermission("https://example.com"), /Native permission failed/);
  assert.equal(await hasSiteAccessConsent("https://example.com"), false);
});

test("failed storage writes do not report authorization success", async (t) => {
  installPermissionRequest(t, { storageError: "Consent could not be saved" });
  await assert.rejects(requestConfirmedSitePermission("https://example.com"), /Consent could not be saved/);
});

test("unsupported pages do not request permission or save confirmation", async (t) => {
  const browser = installPermissionRequest(t);
  assert.equal(await requestConfirmedSitePermission("chrome://extensions"), false);
  assert.equal(browser.nativeRequests, 0);
  assert.equal(browser.writes, 0);
});

test("all-site access defaults off without implicitly consenting to a new site", async (t) => {
  const browser = installPermissionRequest(t);
  assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], false);
  assert.equal(await hasSiteAccessConsent("https://new.example"), false);
  assert.equal(browser.nativeRequests, 0);
});

test("all-site authorization requests both web schemes within the original user gesture", async (t) => {
  const browser = installPermissionRequest(t);
  const result = requestConfirmedAllSitesPermission();
  assert.equal(browser.nativeRequests, 1);
  assert.equal(browser.confirmationEnqueuedBeforeNativePrompt, true);
  assert.deepEqual(browser.pattern, ["http://*/*", "https://*/*"]);
  assert.equal(await result, true);
  assert.equal(browser.messages, 0);
  assert.equal(await hasAllSitesPermission(), true);
  for (const url of ["https://unseen.example/account", "http://another.example/"]) {
    assert.equal(await hasSiteAccessConsent(url), true);
  }
  assert.equal(await hasSiteAccessConsent("chrome://extensions"), false);
  assert.equal(await hasSiteAccessConsent("file:///tmp/example.html"), false);
});

test("denying all-site access rolls back global intent and preserves individual site consents", async (t) => {
  const browser = installPermissionRequest(t, { granted: false });
  const siteKey = getSiteAccessConsentStorageKey("https://known.example");
  browser.data[siteKey] = true;
  const existingOrigins = ["http://known.example/*", "https://known.example/*"];
  existingOrigins.forEach(origin => browser.origins.add(origin));
  assert.equal(await requestConfirmedAllSitesPermission(), false);
  assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], false);
  assert.equal(await hasSiteAccessConsent("https://known.example"), true);
  assert.equal(await hasSiteAccessConsent("https://new.example"), false);
  assert.deepEqual(browser.removals, [], "Denying broad access must not revoke any existing browser permission");
  assert.deepEqual([...browser.origins], existingOrigins);
});

test("native all-site errors clear global intent and preserve the original error", async (t) => {
  const browser = installPermissionRequest(t, { error: "Native all-sites request failed" });
  await assert.rejects(requestConfirmedAllSitesPermission(), /Native all-sites request failed/);
  assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], false);
  assert.equal(await hasSiteAccessConsent("https://new.example"), false);
});

test("all-site storage failures cannot report successful authorization", async (t) => {
  const browser = installPermissionRequest(t, { storageError: "Global consent write failed" });
  await assert.rejects(requestConfirmedAllSitesPermission(), /Global consent write failed/);
  assert.notEqual(browser.data[ALL_SITES_ACCESS_KEY], true);
});

test("disabling all-site access revokes wildcard grants and returns new sites to individual consent", async (t) => {
  const browser = installPermissionRequest(t);
  await requestConfirmedSitePermission("https://known.example");
  await requestConfirmedAllSitesPermission();
  await disableAllSitesAccess();
  assert.equal(browser.data[ALL_SITES_ACCESS_KEY], false);
  assert.equal(await hasAllSitesPermission(), false);
  assert.deepEqual(browser.removals, [["http://*/*", "https://*/*"]]);
  assert.equal(await hasSiteAccessConsent("https://known.example"), true);
  assert.equal(await hasSiteAccessConsent("https://new.example"), false);
  assert.equal(browser.origins.has("https://known.example/*"), true);
});

test("partial browser revocation makes stale global intent ineffective without clearing individual consents", async (t) => {
  const browser = installPermissionRequest(t);
  await requestConfirmedSitePermission("https://known.example");
  await requestConfirmedAllSitesPermission();
  browser.origins.delete("http://*/*");
  assert.equal(await hasAllSitesPermission(), false);
  assert.equal(await hasSiteAccessConsent("https://new.example"), false);
  assert.equal(await hasSiteAccessConsent("https://known.example"), true);
});

test("revocation errors are reported after global consent is disabled", async (t) => {
  const browser = installPermissionRequest(t, { removeError: "Browser revocation failed" });
  await requestConfirmedAllSitesPermission();
  await assert.rejects(disableAllSitesAccess(), /Browser revocation failed/);
  assert.equal(browser.data[ALL_SITES_ACCESS_KEY], false);
  assert.equal(await hasSiteAccessConsent("https://new.example"), false);
});

function deferNativeRequests(browser) {
  const pending = [];
  chrome.permissions.request = (options, callback) => {
    browser.nativeRequests += 1;
    pending.push((granted, error = "") => {
      if (granted) options.origins.forEach(origin => browser.origins.add(origin));
      if (error) chrome.runtime.lastError = { message: error };
      callback(granted);
      delete chrome.runtime.lastError;
    });
  };
  return pending;
}

test("a late global grant cannot restore wildcard access after another surface disabled it", async (t) => {
  const browser = installPermissionRequest(t);
  const pending = deferNativeRequests(browser);
  const request = requestConfirmedAllSitesPermission();
  assert.equal(pending.length, 1, "The native request starts before yielding to any coordination lock");
  await disableAllSitesAccess();
  pending[0](true);
  assert.equal(await request, false);
  assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], false);
  assert.equal(await hasAllSitesPermission(), false);
});

for (const staleResult of ["denied", "error"]) {
  test(`an older ${staleResult} request cannot roll back a newer global grant`, async (t) => {
    const browser = installPermissionRequest(t);
    const pending = deferNativeRequests(browser);
    const older = requestConfirmedAllSitesPermission();
    const newer = requestConfirmedAllSitesPermission();
    pending[1](true);
    assert.equal(await newer, true);
    pending[0](false, staleResult === "error" ? "Older native request failed" : "");
    if (staleResult === "error") await assert.rejects(older, /Older native request failed/);
    else assert.equal(await older, false);
    assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], true);
    assert.equal(await hasAllSitesPermission(), true);
    assert.equal(await hasSiteAccessConsent("https://new.example"), true);
  });
}

test("global failure outcomes remain bounded and legacy boolean preferences remain readable", async (t) => {
  const browser = installPermissionRequest(t, { granted: false });
  browser.data[ALL_SITES_ACCESS_KEY] = true;
  assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], true, "Boolean data without a generation remains compatible");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(await requestConfirmedAllSitesPermission(), false);
    assert.equal((await getPreferences())[ALL_SITES_ACCESS_KEY], false);
    assert.equal(Object.keys(browser.data).filter(key => key.startsWith(ALL_SITES_ACCESS_RESULT_KEY_PREFIX)).length, 1);
  }
  await disableAllSitesAccess();
  assert.equal(Object.keys(browser.data).filter(key => key.startsWith(ALL_SITES_ACCESS_RESULT_KEY_PREFIX)).length, 0);
});
