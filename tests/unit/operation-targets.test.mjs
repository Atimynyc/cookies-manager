import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  assertOperationContext,
  createOperationContext,
  getUndoUnavailableReason
} from "../../src/shared/operation-context.js";
import { getStorageItems, removeStorageItem, setStorageValue } from "../../src/shared/storage-api.js";
import { toCookieRow } from "../../src/shared/cookie-format.js";
import { toStorageRow } from "../../src/shared/storage-format.js";
import { createPopupHistoryController } from "../../src/popup/popup-history-controller.js";

const ORIGINAL_TAB = { id: 11, url: "https://example.test/settings", incognito: false };

test("operation contexts stay fixed and reject changed origin, mode, and cookie store", async (t) => {
  const browser = mockBrowser(t);
  const target = createOperationContext(browser.tab, "0");
  assert.equal(Object.isFrozen(target), true);
  browser.tab.url = "https://other.test/";
  assert.equal(target.origin, "https://example.test");
  await assert.rejects(assertOperationContext(target), /changed sites/);

  browser.tab.url = ORIGINAL_TAB.url;
  browser.tab.incognito = true;
  await assert.rejects(assertOperationContext(target), /browsing modes/);

  browser.tab.incognito = false;
  browser.storeId = "1";
  await assert.rejects(assertOperationContext(target), /cookie store changed/);

  browser.storeId = "0";
  assert.equal(await assertOperationContext(target), target);
});

test("Storage reads, writes, and deletes reject navigation inside the injected document", async (t) => {
  const browser = mockBrowser(t);
  browser.local.setItem("key", "original");
  browser.origin = "https://other.test";
  await assert.rejects(getStorageItems(11, ORIGINAL_TAB.url, "local"), /changed sites/);
  await assert.rejects(setStorageValue(11, ORIGINAL_TAB.url, "local", "key", "new"), /changed sites/);
  await assert.rejects(removeStorageItem(11, ORIGINAL_TAB.url, "local", "key"), /changed sites/);
  assert.equal(browser.local.getItem("key"), "original");
  assert.equal(browser.writes.length, 0);
});

test("Storage operations return verified page values and detect rejected mutations", async (t) => {
  const browser = mockBrowser(t);
  const saved = await setStorageValue(11, ORIGINAL_TAB.url, "local", "key", "new");
  assert.deepEqual(saved, { type: "local", key: "key", value: "new", origin: "https://example.test" });
  const items = await getStorageItems(11, ORIGINAL_TAB.url, "local");
  assert.deepEqual(JSON.parse(JSON.stringify(items)), [saved]);
  await removeStorageItem(11, ORIGINAL_TAB.url, "local", "key");
  assert.equal(browser.local.getItem("key"), null);

  browser.local.setItem = () => {};
  await assert.rejects(setStorageValue(11, ORIGINAL_TAB.url, "local", "key", "ignored"), /verified after saving/);
  browser.local.getItem = () => "still-present";
  browser.local.removeItem = () => {};
  await assert.rejects(removeStorageItem(11, ORIGINAL_TAB.url, "local", "key"), /verified as deleted/);
});

test("Storage rejects an absent injection result instead of reporting success", async (t) => {
  mockBrowser(t);
  chrome.scripting.executeScript = (_details, callback) => callback([]);
  await assert.rejects(setStorageValue(11, ORIGINAL_TAB.url, "local", "key", "new"), /verified result/);
  await assert.rejects(removeStorageItem(11, ORIGINAL_TAB.url, "session", "key"), /verified result/);
});

test("history refuses cross-origin undo and preserves its snapshot", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(controller, state, "local");
  state.tab = { ...ORIGINAL_TAB, id: 12, url: "https://other.test/" };
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /only available for https:\/\/example.test/);
  assert.equal(browser.writes.length, 0);
  assert.equal(state.undoSnapshots.has(changeId), true);
});

test("Session Storage undo requires the original tab and permits same-tab reloads", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(controller, state, "session");
  state.tab = { ...ORIGINAL_TAB, id: 12 };
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /original tab/);
  assert.equal(browser.writes.length, 0);

  state.tab = { ...ORIGINAL_TAB, url: "https://example.test/after-reload" };
  browser.tab = { ...state.tab };
  await controller.undoRecentChange(changeId);
  assert.equal(browser.session.getItem("setting"), "before");
  assert.equal(state.undoSnapshots.has(changeId), false);
  assert.equal(statuses.at(-1).type, "success");
});

test("Local Storage undo can use another tab at the original origin", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(controller, state, "local");
  state.tab = { ...ORIGINAL_TAB, id: 12 };
  browser.tab = { ...state.tab };
  await controller.undoRecentChange(changeId);
  assert.equal(browser.local.getItem("setting"), "before");
  assert.equal(browser.writes[0].tabId, 12);
  assert.equal(statuses.at(-1).type, "success");
});

test("undo refuses navigation between the tab check and the injected write", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(controller, state, "local");
  browser.origin = "https://other.test";
  browser.local.setItem("setting", "other-site-value");
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /changed sites/);
  assert.equal(browser.local.getItem("setting"), "other-site-value");
  assert.equal(state.undoSnapshots.has(changeId), true);
});

test("history refuses different Cookie stores and incognito modes", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const row = makeCookieRow();
  await controller.recordRecentChange(row, "after", { target: createOperationContext(state.tab, "0") });
  const changeId = state.recentChanges[0].id;
  state.cookieStoreId = "1";
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /original cookie store/);

  state.cookieStoreId = "0";
  state.tab = { ...state.tab, incognito: true };
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /original browsing mode/);

  state.tab = { ...state.tab, incognito: false };
  browser.storeId = "1";
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /cookie store changed/);
  assert.equal(browser.writes.length, 0);
  assert.equal(state.undoSnapshots.has(changeId), true);
});

test("Cookie undo restores its complete identity, partition, and attributes", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const row = makeCookieRow();
  await controller.recordRecentChange(row, "after", { target: createOperationContext(state.tab, "0") });
  const changeId = state.recentChanges[0].id;
  row.raw.partitionKey.topLevelSite = "https://mutated.test";
  await controller.undoRecentChange(changeId);
  assert.deepEqual(browser.writes[0], {
    kind: "cookie-set",
    details: {
      url: ORIGINAL_TAB.url,
      name: "setting",
      value: "before",
      path: "/account",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
      storeId: "0",
      domain: ".example.test",
      expirationDate: 2000000000,
      partitionKey: { topLevelSite: "https://example.test", hasCrossSiteAncestor: false }
    }
  });
  assert.equal(statuses.at(-1).type, "success");
});

test("legacy snapshots remain readable but cannot mutate site data", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  state.recentChanges = [{ id: "legacy", name: "setting", timestamp: 1, itemKind: "localStorage" }];
  state.undoSnapshots.set("legacy", { itemKind: "localStorage", storageType: "local", key: "setting", value: "old", beforeValue: "old", afterValue: "new" });
  await controller.undoRecentChange("legacy");
  assert.match(statuses.at(-1).message, /older change has no verified target/);
  assert.equal(state.recentChanges.length, 1);
  assert.equal(state.undoSnapshots.has("legacy"), true);
  assert.equal(browser.writes.length, 0);
});

test("Cookie import-create undo removes the original partition and path", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const row = makeCookieRow();
  await controller.recordImportChange(row, row.value, null, { target: createOperationContext(state.tab, "0") });
  await controller.undoRecentChange(state.recentChanges[0].id);
  assert.deepEqual(browser.writes[0], {
    kind: "cookie-remove",
    details: {
      url: "https://example.test/account",
      name: "setting",
      storeId: "0",
      partitionKey: { topLevelSite: "https://example.test", hasCrossSiteAncestor: false }
    }
  });
  assert.equal(statuses.at(-1).type, "success");
});

test("repeated Undo clicks share a single mutation", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(controller, state, "local");
  await Promise.all([controller.undoRecentChange(changeId), controller.undoRecentChange(changeId)]);
  assert.equal(browser.writes.length, 1);
  assert.equal(state.undoSnapshots.has(changeId), false);
});

test("history mutation waits until current site writes and reads finish", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(controller, state, "local");
  for (const flag of ["busy", "loading"]) {
    state[flag] = true;
    await controller.undoRecentChange(changeId);
    await controller.clearHistory();
    assert.equal(browser.writes.length, 0);
    assert.equal(state.undoSnapshots.has(changeId), true);
    assert.equal(state.recentChanges.length, 1);
    state[flag] = false;
  }
  await controller.undoRecentChange(changeId);
  assert.equal(browser.writes.length, 1);
  await controller.clearHistory();
  assert.equal(state.recentChanges.length, 0);
});

test("Storage history works without Cookie store metadata", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const target = createOperationContext(state.tab);
  const row = toStorageRow({ type: "local", key: "setting", value: "before", origin: target.origin });
  await controller.recordRecentChange(row, "after", { target });
  assert.equal(state.undoSnapshots.get(state.recentChanges[0].id).target.cookieStoreId, "");
  await controller.undoRecentChange(state.recentChanges[0].id);
  assert.equal(browser.local.getItem("setting"), "before");
  assert.equal(statuses.at(-1).type, "success");
});

test("import-create undo removes only the item in its captured target", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const row = toStorageRow({ type: "session", key: "imported", value: "new", origin: "https://example.test" });
  browser.session.setItem("imported", "new");
  await controller.recordImportChange(row, "new", null, { target: createOperationContext(state.tab, "0") });
  const changeId = state.recentChanges[0].id;
  assert.equal(state.undoSnapshots.get(changeId).deleteOnUndo, true);
  state.tab = { ...ORIGINAL_TAB, id: 12 };
  await controller.undoRecentChange(changeId);
  assert.equal(browser.session.getItem("imported"), "new");
  assert.match(statuses.at(-1).message, /original tab/);
  state.tab = { ...ORIGINAL_TAB };
  await controller.undoRecentChange(changeId);
  assert.equal(browser.session.getItem("imported"), null);
  assert.equal(statuses.at(-1).type, "success");
});

test("history uses captured row and target when the visible site and data view change", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller } = createHistoryHarness(browser);
  const target = createOperationContext(state.tab, "0");
  const row = toStorageRow({ type: "session", key: "setting", value: "before", origin: target.origin });
  state.tab = { ...ORIGINAL_TAB, id: 12, url: "https://other.test/" };
  await controller.recordImportChange(row, "after", row, { target });
  const change = state.recentChanges[0];
  assert.equal(change.itemKind, "sessionStorage");
  assert.equal(change.host, "example.test");
  assert.equal(change.targetTabId, ORIGINAL_TAB.id);
  assert.deepEqual(state.undoSnapshots.get(change.id).target, target);
});

test("invalid Cookie scope and missing store information disable undo", () => {
  const snapshot = {
    itemKind: "cookie",
    target: createOperationContext(ORIGINAL_TAB, "0"),
    raw: makeCookieRow().raw
  };
  assert.equal(getUndoUnavailableReason(snapshot, ORIGINAL_TAB, "0"), "");
  snapshot.raw.domain = ".other.test";
  assert.match(getUndoUnavailableReason(snapshot, ORIGINAL_TAB, "0"), /incomplete cookie target/);
  snapshot.raw = makeCookieRow().raw;
  snapshot.raw.storeId = "";
  assert.match(getUndoUnavailableReason(snapshot, ORIGINAL_TAB, "0"), /incomplete cookie target/);
});

async function recordStorageEdit(controller, state, type) {
  const target = createOperationContext(state.tab, "0");
  const row = toStorageRow({ type, key: "setting", value: "before", origin: target.origin });
  await controller.recordRecentChange(row, "after", { target });
  return state.recentChanges[0].id;
}

function makeCookieRow() {
  return toCookieRow({
    name: "setting", value: "before", domain: ".example.test", path: "/account",
    hostOnly: false, secure: true, httpOnly: true, sameSite: "no_restriction",
    storeId: "0", session: false, expirationDate: 2000000000,
    partitionKey: { topLevelSite: "https://example.test", hasCrossSiteAncestor: false }
  });
}

function createHistoryHarness(browser) {
  const state = {
    tab: { ...browser.tab }, cookieStoreId: "0", recentChanges: [], undoSnapshots: new Map(),
    unreadHistoryIds: new Set(), selectedHistoryId: "", autoRefreshPage: false
  };
  const statuses = [];
  const controller = createPopupHistoryController({
    state,
    getCurrentView: () => ({ storageType: "local", title: "Local Storage" }),
    getHistoryItemKind: () => "localStorage",
    rememberCurrentSelection() {}, clearHistoryDetail() {}, renderHistory() {},
    refreshData: async () => {}, suppressCookieWatcher() {}, setBusy() {}, clearStatus() {},
    showStatus: (message, type) => statuses.push({ message, type })
  });
  return { state, controller, statuses };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function mockBrowser(t) {
  const previousChrome = globalThis.chrome;
  t.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  const browser = {
    tab: { ...ORIGINAL_TAB }, origin: "https://example.test", storeId: "0", writes: [],
    local: createMemoryStorage(), session: createMemoryStorage()
  };
  const storageArea = () => ({
    set: (_data, callback) => callback(),
    get: (defaults, callback) => callback(defaults),
    remove: (_key, callback) => callback()
  });
  globalThis.chrome = {
    runtime: {},
    tabs: { get: (_tabId, callback) => callback(browser.tab), reload: (_tabId, callback) => callback() },
    cookies: {
      getAllCookieStores: (callback) => callback([{ id: browser.storeId, tabIds: [browser.tab.id] }]),
      set: (details, callback) => {
        browser.writes.push({ kind: "cookie-set", details: structuredClone(details) });
        callback({ ...details, domain: details.domain || "example.test", hostOnly: !details.domain });
      },
      remove: (details, callback) => {
        browser.writes.push({ kind: "cookie-remove", details: structuredClone(details) });
        callback(details);
      }
    },
    scripting: {
      executeScript: (details, callback) => {
        const result = vm.runInNewContext(`(${details.func.toString()})(...args)`, {
          args: details.args,
          location: { origin: browser.origin },
          localStorage: browser.local,
          sessionStorage: browser.session
        });
        if (result.ok && details.args[2] !== "read") {
          browser.writes.push({ kind: details.args[2], tabId: details.target.tabId });
        }
        callback([{ result }]);
      }
    },
    storage: { local: storageArea(), session: storageArea() }
  };
  return browser;
}
