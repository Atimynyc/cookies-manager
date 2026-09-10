import assert from "node:assert/strict";
import test from "node:test";
import { createPopupItemActionsController } from "../../src/popup/popup-item-actions-controller.js";

function setup(t) {
  const originalChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = originalChrome; });
  const tab = { id: 1, url: "https://a.example/", incognito: false };
  const otherTab = { id: 2, url: "https://b.example/", incognito: false };
  const row = { id: "flag", name: "flag", type: "local", value: "before", raw: { type: "local", key: "flag", value: "before", origin: "https://a.example" } };
  const state = { tab, cookieStoreId: "0", autoRefreshPage: true, selectedIds: new Set() };
  const calls = [];
  const tabs = new Map([[1, tab], [2, otherTab]]);
  globalThis.chrome = {
    runtime: {},
    tabs: {
      get: (id, callback) => callback(tabs.get(id)),
      reload: (id, callback) => { calls.push(["reload", id]); callback(); }
    },
    cookies: { getAllCookieStores: (callback) => callback([{ id: "0", tabIds: [1, 2] }]) },
    scripting: { executeScript: (details, callback) => {
      calls.push(["storage", details.target.tabId, details.args]);
      callback([{ result: { ok: true, origin: new URL(tabs.get(details.target.tabId).url).origin, value: details.args[4] } }]);
    } }
  };
  const elements = { valueInput: { value: "draft" }, expirationInput: { reportValidity() {} } };
  const options = {
    state, elements,
    getCurrentView: () => ({ singular: "storage item", plural: "storage items", storageType: "local" }),
    isCookieView: () => false,
    getSelectedRow: () => row,
    getSelectedRows: () => [row, { ...row, id: "second", name: "second" }],
    getExpirationDraft: () => null,
    hasSelectedItemChanges: () => true,
    getRowLocation: () => row.raw.origin,
    getRowJson: () => "{}",
    populateExpirationEditor: () => calls.push(["expiration"]),
    updateValueWorkspaceHeight: () => calls.push(["height"]),
    updateSaveState: () => calls.push(["save-state"]),
    updateAutoToolOutput: () => calls.push(["tools"]),
    prepareRowForSave: async (value) => value,
    discardEditorDraft: (value, target) => calls.push(["discard", value.id, target.tabId]),
    rememberCurrentSelection() {},
    refreshData: async () => { state.tab = otherTab; },
    recordRecentChange: async (value, nextValue, metadata) => calls.push(["history", value, nextValue, metadata]),
    suppressCookieWatcher() {},
    requestDeleteConfirmation: async () => true,
    requestTextInput: async () => "batch-value",
    setBusy: (busy) => { state.busy = busy; },
    showStatus: (message, type) => calls.push(["status", message, type]),
    clearStatus() {},
    writeClipboard() {}, showCopyFeedback() {}, resetCopyFeedback() {}
  };
  return { options, state, row, otherTab, tabs, calls, elements };
}

test("single saves retain their target for history and reload after the UI changes", async (t) => {
  const env = setup(t);
  env.options.prepareRowForSave = async (row) => {
    env.state.tab = env.otherTab;
    return row;
  };
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  assert.equal(env.calls.find(([kind]) => kind === "storage")[1], 1);
  assert.equal(env.calls.find(([kind]) => kind === "history")[3].target.tabId, 1);
  assert.deepEqual(env.calls.find(([kind]) => kind === "reload"), ["reload", 1]);
  assert.equal(env.state.busy, false);
});

test("deleting after navigation refuses the write and retains the draft", async (t) => {
  const env = setup(t);
  env.options.requestDeleteConfirmation = async () => {
    env.tabs.set(1, { ...env.state.tab, url: env.otherTab.url });
    return true;
  };
  await createPopupItemActionsController(env.options).deleteSelectedItem();
  assert.equal(env.calls.some(([kind]) => kind === "storage" || kind === "discard"), false);
  assert.match(env.calls.find(([kind]) => kind === "status")[1], /changed sites/);
});

test("a successful save does not reload a target that navigates during refresh", async (t) => {
  const env = setup(t);
  env.options.refreshData = async () => {
    env.tabs.set(1, { ...env.state.tab, url: env.otherTab.url });
  };
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  assert.equal(env.calls.some(([kind]) => kind === "reload"), false);
  assert.deepEqual(env.calls.at(-1), ["status", "Saved flag.", "success"]);
});

test("batch edits use the original target even if the dialog changes the selected site", async (t) => {
  const env = setup(t);
  env.options.requestTextInput = async () => {
    env.state.tab = env.otherTab;
    env.options.isCookieView = () => true;
    return "batch-value";
  };
  await createPopupItemActionsController(env.options).batchEditSelected();
  const writes = env.calls.filter(([kind]) => kind === "storage");
  assert.equal(writes.length, 2);
  assert.ok(writes.every(([, tabId, args]) => tabId === 1 && args[0] === "local"));
  assert.ok(env.calls.filter(([kind]) => kind === "history").every((entry) => entry[3].target.origin === "https://a.example"));
});

test("cancelling a draft conflict causes no mutation or draft discard", async (t) => {
  const env = setup(t);
  env.options.prepareRowForSave = async () => null;
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  assert.equal(env.calls.length, 0);
  assert.equal(env.state.busy, false);
});

test("Reset clears the draft and updates expiration, layout, save state, and tools", (t) => {
  const env = setup(t);
  createPopupItemActionsController(env.options).resetSelectedItem();
  assert.equal(env.elements.valueInput.value, "before");
  assert.deepEqual(env.calls.map(([kind]) => kind), ["discard", "expiration", "height", "save-state", "tools"]);
});
