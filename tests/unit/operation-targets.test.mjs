import assert from "node:assert/strict";
import test from "node:test";
import { installOperationBrowser } from "../helpers/operation-browser.mjs";
import { runOperation } from "../../src/shared/operation-client.js";
import { operationItemFromRow } from "../../src/shared/operation-presentation.js";

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
  const originalLocal = browser.local;
  browser.origin = "https://other.test";
  await assert.rejects(getStorageItems(11, ORIGINAL_TAB.url, "local"), /changed sites/);
  await assert.rejects(setStorageValue(11, ORIGINAL_TAB.url, "local", "key", "new"), /changed sites/);
  await assert.rejects(removeStorageItem(11, ORIGINAL_TAB.url, "local", "key"), /changed sites/);
  assert.equal(originalLocal.getItem("key"), "original");
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
  const changeId = await recordStorageEdit(browser, controller, state, "local");
  state.tab = { ...ORIGINAL_TAB, id: 12, url: "https://other.test/" };
  await controller.undoRecentChange(changeId);
  assert.match(statuses.at(-1).message, /only available for https:\/\/example.test/);
  assert.equal(browser.writes.length, 0);
  assert.equal(state.undoSnapshots.has(changeId), true);
});

test("Session Storage undo requires the original tab and permits same-tab reloads", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(browser, controller, state, "session");
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
  const changeId = await recordStorageEdit(browser, controller, state, "local");
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
  const changeId = await recordStorageEdit(browser, controller, state, "local");
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
  const changeId = await recordHistoryChange(browser, controller, state, row, "after");
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
  const changeId = await recordHistoryChange(browser, controller, state, row, "after");
  row.raw.partitionKey.topLevelSite = "https://mutated.test";
  await controller.undoRecentChange(changeId);
  assert.equal(browser.writes[0].kind, "cookie-set");
  assert.deepEqual(browser.writes[0].details, {
      url: "https://example.test/account",
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
  await recordHistoryChange(browser, controller, state, row, row.value, { source: "quick-import", create: true });
  await controller.undoRecentChange(state.recentChanges[0].id);
  assert.equal(browser.writes[0].kind, "cookie-remove");
  assert.deepEqual(browser.writes[0].details, {
      url: "https://example.test/account",
      name: "setting",
      storeId: "0",
      partitionKey: { topLevelSite: "https://example.test", hasCrossSiteAncestor: false }
  });
  assert.equal(statuses.at(-1).type, "success");
});

test("repeated Undo clicks share a single mutation", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(browser, controller, state, "local");
  await Promise.all([controller.undoRecentChange(changeId), controller.undoRecentChange(changeId)]);
  assert.equal(browser.writes.length, 1);
  assert.equal(state.undoSnapshots.has(changeId), false);
});

test("history mutation waits until current site writes and reads finish", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(browser, controller, state, "local");
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
  await recordHistoryChange(browser, controller, state, row, "after", { target });
  assert.equal(state.undoSnapshots.get(state.recentChanges[0].id).target.cookieStoreId, "");
  await controller.undoRecentChange(state.recentChanges[0].id);
  assert.equal(browser.local.getItem("setting"), "before");
  assert.equal(statuses.at(-1).type, "success");
});

test("import-create undo removes only the item in its captured target", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const row = toStorageRow({ type: "session", key: "imported", value: "new", origin: "https://example.test" });
  await recordHistoryChange(browser, controller, state, row, "new", { source: "quick-import", create: true });
  const changeId = state.recentChanges[0].id;
  assert.equal(browser.jobs[0].items[0].before, null);
  assert.equal(state.undoSnapshots.get(changeId).operationId, browser.jobs[0].id);
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
  await recordHistoryChange(browser, controller, state, row, "after", { target, source: "quick-import" });
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

test("history undo sends the selected operation item ID without undoing its batch siblings", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const target = createOperationContext(state.tab, "0");
  const rows = ["first", "second"].map((key) => toStorageRow({ type: "local", key, value: "before", origin: target.origin }));
  rows.forEach((row) => browser.local.setItem(row.name, row.value));
  const job = await runOperation({ target, source: "batch-edit", items: rows.map((row) => operationItemFromRow(row, { ...row.raw, value: "after" })) });
  await controller.loadRecentChanges();
  browser.messages = [];
  browser.writes = [];

  await controller.undoRecentChange(`${job.id}:${rows[1].id}`);

  const request = browser.messages.find((message) => message.command === "undo");
  assert.equal(request.id, job.id);
  assert.deepEqual(request.options.itemIds, [rows[1].id]);
  assert.deepEqual(request.options.target, target);
  assert.equal(browser.local.getItem("first"), "after");
  assert.equal(browser.local.getItem("second"), "before");
  assert.equal(browser.writes.length, 1);
  assert.equal(statuses.at(-1).type, "success");
});

test("history undo retains a conflicting snapshot and reports the preserved later value", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  const changeId = await recordStorageEdit(browser, controller, state, "local");
  browser.local.setItem("setting", "later");

  await controller.undoRecentChange(changeId);

  assert.equal(browser.local.getItem("setting"), "later");
  assert.equal(browser.writes.length, 0);
  assert.equal(state.undoSnapshots.has(changeId), true);
  assert.match(statuses.at(-1).message, /changed after.*prepared/);
  assert.equal(statuses.at(-1).type, "error");
});

test("loaded legacy snapshots with target metadata remain readable but cannot bypass the journal", async (t) => {
  const browser = mockBrowser(t);
  const { state, controller, statuses } = createHistoryHarness(browser);
  browser.localData.recentCookieChanges = [{ id: "legacy", name: "setting", timestamp: 1, itemKind: "localStorage" }];
  browser.sessionData.recentChangeSnapshots = { legacy: {
    target: createOperationContext(state.tab, "0"), itemKind: "localStorage", storageType: "local",
    raw: { origin: "https://example.test", key: "setting", value: "before" }, key: "setting",
    beforeValue: "before", afterValue: "after"
  } };
  await controller.loadRecentChanges();
  assert.equal(state.recentChanges.length, 1);
  assert.equal(state.undoSnapshots.get("legacy").beforeValue, "before");

  await controller.undoRecentChange("legacy");
  assert.match(statuses.at(-1).message, /older change.*no operation journal/);
  assert.equal(browser.messages.some((message) => message.command === "undo"), false);
  assert.equal(browser.writes.length, 0);
});

async function recordStorageEdit(browser, controller, state, type) {
  const target = createOperationContext(state.tab, "0");
  const row = toStorageRow({ type, key: "setting", value: "before", origin: target.origin });
  await recordHistoryChange(browser, controller, state, row, "after", { target });
  return state.recentChanges[0].id;
}

async function recordHistoryChange(browser, controller, state, row, value, {
  target = createOperationContext(state.tab, "0"), source = "edit", create = false
} = {}) {
  if (!create) {
    if (row.type) browser.getStorage(target.tabId, row.type).setItem(row.name, row.value);
    else browser.cookies.push(structuredClone(row.raw));
  }
  const item = operationItemFromRow(row, { ...row.raw, value });
  if (create) item.before = null;
  const job = await runOperation({ target, source, label: `Change ${row.name}`, items: [item] });
  assert.equal(job.items[0].state, "applied", job.items[0].error);
  await controller.loadRecentChanges();
  browser.writes = [];
  return `${job.id}:${item.id}`;
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
    refreshData: async () => {}, suppressCookieWatcher() {}, setBusy: (busy) => { state.busy = busy; }, clearStatus() {},
    showStatus: (message, type) => statuses.push({ message, type })
  });
  return { state, controller, statuses };
}

function mockBrowser(t) {
  const browser = installOperationBrowser(t, { tabs: [ORIGINAL_TAB, { ...ORIGINAL_TAB, id: 12 }] });
  let activeTabId = ORIGINAL_TAB.id;
  Object.defineProperties(browser, {
    tab: { get: () => browser.tabs.get(activeTabId), set: (tab) => { activeTabId = tab.id; browser.tabs.set(tab.id, tab); } },
    origin: { get: () => browser.origins.get(activeTabId) || new URL(browser.tab.url).origin,
      set: (origin) => browser.origins.set(activeTabId, origin) },
    storeId: { get: () => browser.stores[0].id, set: (id) => { browser.stores[0].id = id; } },
    local: { get: () => browser.getStorage(activeTabId, "local") },
    session: { get: () => browser.getStorage(activeTabId, "session") }
  });
  return browser;
}
