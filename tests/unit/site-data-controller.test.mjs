import assert from "node:assert/strict";
import test from "node:test";

import { createPopupSiteDataController } from "../../src/popup/popup-site-data-controller.js";
import { toCookieRow } from "../../src/shared/cookie-format.js";
import { createSiteDataPackage } from "../../src/shared/site-data-package.js";

const SNAPSHOT_KEY = "latestSiteDataBatchSnapshot";
const SOURCE_URL = "https://example.com/app";

function cookie(overrides = {}) {
  return {
    name: "token", value: "before", domain: "example.com", path: "/",
    session: true, secure: false, httpOnly: false, sameSite: "lax",
    storeId: "0", hostOnly: true, ...overrides
  };
}

function dataPackage(data = {}) {
  return createSiteDataPackage({ url: SOURCE_URL, ...data });
}

function storageMap(entries = []) {
  const values = new Map(entries);
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function setup(t) {
  const previousChrome = globalThis.chrome;
  const env = {
    tabs: new Map([
      [1, { id: 1, url: SOURCE_URL, incognito: false }],
      [2, { id: 2, url: "https://other.example/app", incognito: false }]
    ]),
    stores: [{ id: "0", tabIds: [1, 2] }],
    cookies: [],
    storage: new Map(),
    session: {},
    writes: [],
    reloads: [],
    onRead: null,
    onRefresh: null
  };
  env.getStorage = (tabId, type) => {
    const id = `${tabId}:${type}`;
    if (!env.storage.has(id)) {
      env.storage.set(id, storageMap());
    }
    return env.storage.get(id);
  };
  globalThis.chrome = {
    runtime: {},
    tabs: {
      get(tabId, callback) { callback(structuredClone(env.tabs.get(tabId))); },
      reload(tabId, callback) { env.reloads.push(tabId); callback(); }
    },
    cookies: {
      getAllCookieStores(callback) { callback(structuredClone(env.stores)); },
      getAll(details, callback) {
        const host = new URL(details.url).hostname;
        const matches = env.cookies.filter((item) => item.storeId === details.storeId &&
          host === item.domain.replace(/^\./, ""));
        env.onRead?.();
        callback(structuredClone(matches));
      },
      set(details, callback) {
        env.writes.push({ kind: "cookie-set", ...details });
        const saved = cookie({
          ...details,
          domain: details.domain || new URL(details.url).hostname,
          hostOnly: !details.domain,
          session: !Number.isFinite(details.expirationDate)
        });
        delete saved.url;
        env.cookies = env.cookies.filter((item) => !sameCookie(item, saved));
        env.cookies.push(saved);
        callback(structuredClone(saved));
      },
      remove(details, callback) {
        env.writes.push({ kind: "cookie-remove", ...details });
        const domain = new URL(details.url).hostname;
        env.cookies = env.cookies.filter((item) => item.name !== details.name ||
          item.storeId !== details.storeId || item.domain !== domain);
        callback(details);
      }
    },
    scripting: {
      executeScript({ target, func, args }, callback) {
        const names = ["location", "localStorage", "sessionStorage"];
        const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
        const tab = env.tabs.get(target.tabId);
        const values = [{ origin: new URL(tab.url).origin }, env.getStorage(tab.id, "local"), env.getStorage(tab.id, "session")];
        try {
          names.forEach((name, index) => Object.defineProperty(globalThis, name, { configurable: true, value: values[index] }));
          const result = func(...args);
          if (args[2] !== "read" && result.ok) {
            env.writes.push({ kind: `storage-${args[2]}`, tabId: target.tabId, type: args[0], origin: result.origin, key: args[3] });
          }
          callback([{ result }]);
        } finally {
          names.forEach((name, index) => {
            if (previous[index]) {
              Object.defineProperty(globalThis, name, previous[index]);
            } else {
              delete globalThis[name];
            }
          });
        }
      }
    },
    storage: {
      session: {
        get(defaults, callback) { callback(structuredClone({ ...defaults, ...env.session })); },
        set(values, callback) { Object.assign(env.session, structuredClone(values)); callback(); },
        remove(key, callback) { delete env.session[key]; callback(); }
      }
    }
  };
  t.after(() => {
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  });
  const state = {
    tab: structuredClone(env.tabs.get(1)), cookieStoreId: "0", dataView: "cookies",
    rows: [], autoRefreshPage: false
  };
  const controller = createPopupSiteDataController({
    state,
    getSelectedRows: () => state.rows,
    refreshData: async () => env.onRefresh?.(),
    suppressCookieWatcher: () => {},
    showStatus: () => {},
    requestDeleteConfirmation: async () => true,
    requestTextInput: async () => null
  });
  return { env, state, controller };
}

function sameCookie(left, right) {
  return ["name", "domain", "path", "storeId"].every((field) => left[field] === right[field]);
}

const applyOptions = { strategy: "overwrite" };

test("package previews keep the captured target when the selected tab changes during reads", async (t) => {
  const { env, state, controller } = setup(t);
  env.onRead = () => { state.tab = structuredClone(env.tabs.get(2)); };
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "on" }] }));

  assert.equal(preview.target.url, SOURCE_URL);
  assert.deepEqual(preview.operationTarget, {
    tabId: 1, url: SOURCE_URL, origin: "https://example.com", cookieStoreId: "0", incognito: false
  });
  assert.equal(Object.isFrozen(preview.operationTarget), true);
  await assert.rejects(controller.applyPackage(preview, applyOptions), /target changed.*new preview/);
  assert.equal(env.writes.length, 0);
});

for (const changedField of ["tab", "origin", "store", "incognito"]) {
  test(`package apply rejects a preview after its ${changedField} context changes`, async (t) => {
    const { env, state, controller } = setup(t);
    const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "on" }] }));
    if (changedField === "tab") state.tab = { ...state.tab, id: 2 };
    if (changedField === "origin") state.tab = { ...state.tab, url: "https://other.example/" };
    if (changedField === "store") state.cookieStoreId = "1";
    if (changedField === "incognito") state.tab = { ...state.tab, incognito: true };

    await assert.rejects(controller.applyPackage(preview, applyOptions), /target changed/);
    assert.equal(env.writes.length, 0);
  });
}

test("package apply rejects actual navigation even when the UI target is stale", async (t) => {
  const { env, controller } = setup(t);
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "on" }] }));
  env.tabs.set(1, { id: 1, url: "https://other.example/", incognito: false });

  await assert.rejects(controller.applyPackage(preview, applyOptions), /changed sites/);
  assert.equal(env.writes.length, 0);
});

test("package writes and automatic reload stay on the captured tab throughout a batch", async (t) => {
  const { env, state, controller } = setup(t);
  state.autoRefreshPage = true;
  const preview = await controller.previewPackage(dataPackage({
    cookies: [cookie({ value: "after" })],
    localStorage: [{ key: "flag", value: "on" }],
    sessionStorage: [{ key: "step", value: "2" }]
  }));
  const outcome = await controller.applyPackage(preview, {
    ...applyOptions,
    onProgress: () => { state.tab = structuredClone(env.tabs.get(2)); }
  });

  assert.equal(outcome.result.success.length, 3);
  assert.equal(outcome.result.failed.length, 0);
  assert.equal(env.writes[0].url, SOURCE_URL);
  assert.equal(env.writes[0].storeId, "0");
  assert.deepEqual(env.writes.slice(1).map((write) => write.tabId), [1, 1]);
  assert.equal(env.getStorage(2, "local").getItem("flag"), null);
  assert.deepEqual(env.reloads, [1]);
  assert.deepEqual(env.session[SNAPSHOT_KEY].target, preview.operationTarget);
  assert.equal(env.session[SNAPSHOT_KEY].targetUrl, SOURCE_URL);
});

test("navigation during a package batch prevents remaining writes and preserves successful-item undo", async (t) => {
  const { env, state, controller } = setup(t);
  state.autoRefreshPage = true;
  const preview = await controller.previewPackage(dataPackage({
    localStorage: [{ key: "first", value: "1" }, { key: "second", value: "2" }]
  }));
  const outcome = await controller.applyPackage(preview, {
    ...applyOptions,
    onProgress: ({ completed }) => {
      if (completed === 1) env.tabs.set(1, { id: 1, url: "https://other.example/", incognito: false });
    }
  });

  assert.equal(outcome.result.success.length, 1);
  assert.match(outcome.result.failed[0].error.message, /changed sites/);
  assert.equal(env.writes.length, 1);
  assert.equal(env.session[SNAPSHOT_KEY].entries.length, 1);
  assert.equal(env.session[SNAPSHOT_KEY].target.origin, "https://example.com");
  assert.deepEqual(env.reloads, []);
});

test("package cookies default to the target store while explicit foreign stores fail individually", async (t) => {
  const { env, controller } = setup(t);
  env.cookies.push(cookie({ name: "unspecified", value: "before" }));
  const preview = await controller.previewPackage(dataPackage({ cookies: [
    cookie({ name: "foreign", storeId: "1" }),
    cookie({ name: "unspecified", value: "after", storeId: "" }),
    cookie({ name: "allowed", storeId: "0" })
  ] }));
  assert.equal(preview.items[1].status, "modified");
  assert.equal(preview.items[1].incoming.storeId, "0");
  const outcome = await controller.applyPackage(preview, applyOptions);

  assert.equal(outcome.result.success.length, 2);
  assert.equal(outcome.result.failed.length, 1);
  assert.ok(outcome.result.failed.every((entry) => /cookie store/.test(entry.error.message)));
  assert.deepEqual(env.writes.map((write) => [write.name, write.storeId]), [["unspecified", "0"], ["allowed", "0"]]);
});

test("verified package undo restores overwritten data and removes newly imported data", async (t) => {
  const { env, state, controller } = setup(t);
  env.cookies.push(cookie());
  env.getStorage(1, "local").setItem("flag", "before");
  const preview = await controller.previewPackage(dataPackage({
    cookies: [cookie({ value: "after" }), cookie({ name: "new-cookie", value: "new" })],
    localStorage: [{ key: "flag", value: "after" }],
    sessionStorage: [{ key: "step", value: "2" }]
  }));
  await controller.applyPackage(preview, applyOptions);
  env.writes = [];
  state.autoRefreshPage = true;
  env.onRefresh = () => { state.tab = structuredClone(env.tabs.get(2)); };
  const undone = await controller.undoLatestBatch({
    onProgress: () => { state.tab = structuredClone(env.tabs.get(2)); }
  });

  assert.equal(undone.complete, true);
  assert.equal(undone.result.success.length, 4);
  assert.deepEqual(env.cookies, [cookie()]);
  assert.equal(env.getStorage(1, "local").getItem("flag"), "before");
  assert.equal(env.getStorage(1, "session").getItem("step"), null);
  assert.ok(env.writes.filter((write) => write.kind.startsWith("storage")).every((write) => write.tabId === 1));
  assert.equal(env.session[SNAPSHOT_KEY], undefined);
  assert.deepEqual(env.reloads, [1]);
});

test("batch undo rejects legacy snapshots and changed target contexts before any mutation", async (t) => {
  const { env, state, controller } = setup(t);
  const originalTab = state.tab;
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "after" }] }));
  await controller.applyPackage(preview, applyOptions);
  const snapshot = structuredClone(env.session[SNAPSHOT_KEY]);
  env.writes = [];
  for (const changedTarget of [
    { tab: { ...originalTab, id: 2 }, cookieStoreId: "0" },
    { tab: { ...originalTab, url: "https://other.example/" }, cookieStoreId: "0" },
    { tab: { ...originalTab, incognito: true }, cookieStoreId: "0" },
    { tab: originalTab, cookieStoreId: "1" }
  ]) {
    Object.assign(state, changedTarget);
    await assert.rejects(controller.undoLatestBatch(), /original target tab/);
  }
  state.tab = originalTab;
  state.cookieStoreId = "0";
  delete env.session[SNAPSHOT_KEY].target;
  await assert.rejects(controller.undoLatestBatch(), /older import.*cannot be undone/);
  env.session[SNAPSHOT_KEY] = { ...snapshot, target: { tabId: 1, origin: "https://example.com" } };
  await assert.rejects(controller.undoLatestBatch(), /original target tab/);
  assert.equal(env.writes.length, 0);
});

test("navigation during batch undo leaves remaining entries retryable and does not touch the new site", async (t) => {
  const { env, controller } = setup(t);
  const preview = await controller.previewPackage(dataPackage({
    localStorage: [{ key: "first", value: "1" }, { key: "second", value: "2" }]
  }));
  await controller.applyPackage(preview, applyOptions);
  env.writes = [];
  const outcome = await controller.undoLatestBatch({
    onProgress: ({ completed }) => {
      if (completed === 1) env.tabs.set(1, { id: 1, url: "https://other.example/", incognito: false });
    }
  });

  assert.equal(outcome.complete, false);
  assert.equal(outcome.result.success.length, 1);
  assert.match(outcome.result.failed[0].error.message, /changed sites/);
  assert.equal(env.writes.length, 1);
  assert.equal(env.session[SNAPSHOT_KEY].entries.length, 1);
});

test("all-data export keeps captured source metadata when another tab is selected during reads", async (t) => {
  const { env, state, controller } = setup(t);
  env.cookies.push(cookie());
  env.onRead = () => { state.tab = structuredClone(env.tabs.get(2)); state.dataView = "localStorage"; };
  const exported = await controller.buildExportForScope("all");

  assert.equal(exported.url, SOURCE_URL);
  assert.equal(exported.source.url, SOURCE_URL);
  assert.equal(exported.host, "example.com");
  assert.equal(exported.type, "siteData");
  assert.equal(exported.data.cookies[0].domain, "example.com");
});

test("view export keeps its captured kind and rows through asynchronous context verification", async (t) => {
  const { state, controller } = setup(t);
  state.rows = [toCookieRow(cookie())];
  const exporting = controller.buildExportForScope("current");
  state.dataView = "localStorage";
  state.rows = [];
  const exported = await exporting;

  assert.equal(exported.type, "cookies");
  assert.equal(exported.count, 1);
  assert.equal(exported.data.cookies[0].name, "token");
});
