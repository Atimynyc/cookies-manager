import assert from "node:assert/strict";
import test from "node:test";
import { installWebLocks } from "../helpers/web-locks.mjs";
import {
  FAVORITE_SITE_DATA_IDS_KEY,
  getFavoriteSiteDataIds,
  getLastViewedSiteData,
  getLastViewedSiteDataStorageKey,
  saveLastViewedSiteData,
  savePreferences,
  setFavoriteSiteDataId
} from "../../src/shared/settings-store.js";

function installStorage(t, values = {}) {
  const previousChrome = globalThis.chrome;
  const locks = installWebLocks(t);
  const state = { data: structuredClone(values), writes: 0, writeError: null, lockRequests: locks.requests };
  globalThis.chrome = {
    runtime: {},
    storage: {
      local: {
        get(defaults, callback) {
          const snapshot = structuredClone({ ...defaults, ...state.data });
          queueMicrotask(() => callback(snapshot));
        },
        set(next, callback) {
          state.writes += 1;
          queueMicrotask(() => {
            if (state.writeError) {
              chrome.runtime.lastError = { message: state.writeError };
              callback();
              delete chrome.runtime.lastError;
              return;
            }
            Object.assign(state.data, structuredClone(next));
            callback();
          });
        }
      }
    }
  };
  t.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  return state;
}

test("concurrent favorite additions from independent surfaces retain both items", async (t) => {
  const storage = installStorage(t);
  const otherSurface = await import("../../src/shared/settings-store.js?surface=sidepanel");

  await Promise.all([
    setFavoriteSiteDataId("cookies:first", true),
    otherSurface.setFavoriteSiteDataId("localStorage:second", true)
  ]);

  assert.deepEqual(await getFavoriteSiteDataIds(), ["cookies:first", "localStorage:second"]);
  assert.ok(storage.lockRequests.every((request) => request.name === "cookie-controller:storage.local:favoriteSiteDataIds"));
});

test("favorite removal and addition merge against the latest stored set", async (t) => {
  const storage = installStorage(t, { [FAVORITE_SITE_DATA_IDS_KEY]: ["cookies:first", "cookies:retained"] });

  await Promise.all([
    setFavoriteSiteDataId("cookies:new", true),
    setFavoriteSiteDataId("cookies:first", false)
  ]);

  assert.deepEqual(storage.data[FAVORITE_SITE_DATA_IDS_KEY], ["cookies:retained", "cookies:new"]);
});

test("explicit favorite state is idempotent and never toggles a repeated request", async (t) => {
  const storage = installStorage(t);

  await Promise.all([setFavoriteSiteDataId("cookies:first", true), setFavoriteSiteDataId("cookies:first", true)]);
  assert.equal(storage.writes, 1);
  assert.deepEqual(await setFavoriteSiteDataId("cookies:missing", false), ["cookies:first"]);
  assert.equal(storage.writes, 1);
  await assert.rejects(setFavoriteSiteDataId("cookies:first", "false"), TypeError);
});

test("favorite write failures preserve old data and do not block later writes", async (t) => {
  const storage = installStorage(t, { [FAVORITE_SITE_DATA_IDS_KEY]: ["cookies:first"] });
  storage.writeError = "Storage unavailable";
  await assert.rejects(setFavoriteSiteDataId("cookies:new", true), { message: "Storage unavailable" });
  assert.deepEqual(storage.data[FAVORITE_SITE_DATA_IDS_KEY], ["cookies:first"]);

  storage.writeError = null;
  assert.deepEqual(await setFavoriteSiteDataId("cookies:new", true), ["cookies:first", "cookies:new"]);
});

test("last-viewed patches from different views preserve each selected item", async (t) => {
  installStorage(t);
  const url = "https://example.com/app";

  await Promise.all([
    saveLastViewedSiteData(url, { activeDataView: "cookies", selectedIds: { cookies: "cookie-id" } }),
    saveLastViewedSiteData(url, { activeDataView: "localStorage", selectedIds: { localStorage: "local-id" } }),
    saveLastViewedSiteData(url, { activeDataView: "sessionStorage", selectedIds: { sessionStorage: "session-id" } })
  ]);

  assert.deepEqual(await getLastViewedSiteData(url), {
    activeDataView: "sessionStorage",
    selectedIds: { cookies: "cookie-id", localStorage: "local-id", sessionStorage: "session-id" }
  });
});

test("last-viewed empty selections clear one view without clearing unrelated selections", async (t) => {
  const url = "https://example.com/app";
  const storage = installStorage(t, {
    [getLastViewedSiteDataStorageKey(url)]: {
      activeDataView: "localStorage",
      selectedIds: { cookies: "cookie-id", localStorage: "local-id", sessionStorage: "session-id" }
    }
  });

  const updated = await saveLastViewedSiteData(url, { selectedIds: { cookies: "" } });
  assert.deepEqual(updated, {
    activeDataView: "localStorage",
    selectedIds: { cookies: "", localStorage: "local-id", sessionStorage: "session-id" }
  });
  assert.deepEqual(storage.data[getLastViewedSiteDataStorageKey(url)], updated);
});

test("last-viewed writes are scoped by origin and ignore invalid patch fields", async (t) => {
  installStorage(t);
  const firstUrl = "https://example.com/app";
  const secondUrl = "https://other.example/app";
  await saveLastViewedSiteData(firstUrl, { activeDataView: "localStorage", selectedIds: { localStorage: "one" } });
  await saveLastViewedSiteData(secondUrl, { selectedIds: { cookies: "two" } });

  assert.deepEqual(await saveLastViewedSiteData(firstUrl, {
    activeDataView: "invalid", selectedIds: { localStorage: null, invalid: "ignored" }
  }), {
    activeDataView: "localStorage", selectedIds: { cookies: "", localStorage: "one", sessionStorage: "" }
  });
  assert.equal((await getLastViewedSiteData(secondUrl)).selectedIds.cookies, "two");
});

test("last-viewed write failures preserve every existing selection", async (t) => {
  const url = "https://example.com";
  const before = { activeDataView: "cookies", selectedIds: { cookies: "first", localStorage: "second", sessionStorage: "" } };
  const storage = installStorage(t, { [getLastViewedSiteDataStorageKey(url)]: before });
  storage.writeError = "Storage unavailable";

  await assert.rejects(saveLastViewedSiteData(url, { selectedIds: { cookies: "new" } }), { message: "Storage unavailable" });
  assert.deepEqual(storage.data[getLastViewedSiteDataStorageKey(url)], before);
});

test("unsupported last-viewed URLs do not write and preference patches preserve unrelated keys", async (t) => {
  const storage = installStorage(t, { valueToolMode: "jwt" });
  await saveLastViewedSiteData("chrome://extensions", { activeDataView: "localStorage" });
  assert.equal(storage.writes, 0);
  await Promise.all([savePreferences({ autoRefreshPage: true }), savePreferences({ columnWidthsVersion: 2 })]);
  assert.deepEqual(storage.data, { valueToolMode: "jwt", autoRefreshPage: true, columnWidthsVersion: 2 });
});
