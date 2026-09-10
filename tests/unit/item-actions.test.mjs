import assert from "node:assert/strict";
import test from "node:test";
import { createPopupItemActionsController } from "../../src/popup/popup-item-actions-controller.js";
import { toStorageRow } from "../../src/shared/storage-format.js";
import { toCookieRow } from "../../src/shared/cookie-format.js";
import { installOperationBrowser } from "../helpers/operation-browser.mjs";

function setup(t) {
  const tab = { id: 1, url: "https://a.example/", incognito: false };
  const otherTab = { id: 2, url: "https://b.example/", incognito: false };
  const browser = installOperationBrowser(t, { tabs: [tab, otherTab] });
  const rows = ["flag", "second"].map((key) => toStorageRow({ type: "local", key, value: "before", origin: "https://a.example" }));
  const row = rows[0];
  rows.forEach((item) => browser.getStorage(1, "local").setItem(item.name, item.value));
  const state = { tab, cookieStoreId: "0", autoRefreshPage: true, selectedIds: new Set() };
  const calls = [];
  const elements = { valueInput: { value: "draft" }, expirationInput: { reportValidity() {} } };
  const options = {
    state, elements,
    getCurrentView: () => ({ singular: "storage item", plural: "storage items", storageType: "local" }),
    isCookieView: () => false,
    getSelectedRow: () => row,
    getSelectedRows: () => rows,
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
    loadRecentChanges: async () => calls.push(["history-loaded"]),
    suppressCookieWatcher() {},
    requestDeleteConfirmation: async () => true,
    requestTextInput: async () => "batch-value",
    setBusy: (busy) => { state.busy = busy; },
    showStatus: (message, type) => calls.push(["status", message, type]),
    clearStatus() {},
    writeClipboard() {}, showCopyFeedback() {}, resetCopyFeedback() {}
  };
  return { options, state, row, rows, otherTab, tabs: browser.tabs, calls, elements, browser };
}

test("single saves retain their target for history and reload after the UI changes", async (t) => {
  const env = setup(t);
  env.options.prepareRowForSave = async (row) => {
    env.state.tab = env.otherTab;
    return row;
  };
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  const request = env.browser.messages.find((message) => message.command === "submit").spec;
  assert.equal(request.target.tabId, 1);
  assert.equal(request.source, "edit");
  assert.deepEqual(request.items[0].before, env.row.raw);
  assert.equal(request.items[0].after.value, "draft");
  assert.equal(env.browser.getStorage(1, "local").getItem("flag"), "draft");
  assert.equal(env.browser.getStorage(2, "local").getItem("flag"), null);
  assert.deepEqual(env.browser.reloads, [1]);
  assert.equal(env.calls.filter(([kind]) => kind === "history-loaded").length, 1);
  assert.equal(env.state.busy, false);
});

test("deleting after navigation refuses the write and retains the draft", async (t) => {
  const env = setup(t);
  env.options.requestDeleteConfirmation = async () => {
    env.tabs.set(1, { ...env.state.tab, url: env.otherTab.url });
    return true;
  };
  await createPopupItemActionsController(env.options).deleteSelectedItem();
  assert.equal(env.browser.writes.length, 0);
  assert.equal(env.browser.messages.length, 0);
  assert.equal(env.calls.some(([kind]) => kind === "discard"), false);
  assert.match(env.calls.find(([kind]) => kind === "status")[1], /changed sites/);
});

test("a successful save does not reload a target that navigates during refresh", async (t) => {
  const env = setup(t);
  env.options.refreshData = async () => {
    env.tabs.set(1, { ...env.state.tab, url: env.otherTab.url });
  };
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  assert.deepEqual(env.browser.reloads, []);
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
  const writes = env.browser.writes;
  assert.equal(writes.length, 2);
  assert.ok(writes.every((write) => write.tabId === 1 && write.type === "local"));
  const request = env.browser.messages.find((message) => message.command === "submit").spec;
  assert.equal(request.source, "batch-edit");
  assert.ok(request.items.every((item) => item.kind === "localStorage" && item.after.value === "batch-value"));
  assert.equal(env.calls.filter(([kind]) => kind === "discard").length, 2);
});

test("cancelling a draft conflict causes no mutation or draft discard", async (t) => {
  const env = setup(t);
  env.options.prepareRowForSave = async () => null;
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  assert.equal(env.calls.length, 0);
  assert.equal(env.browser.messages.length, 0);
  assert.equal(env.state.busy, false);
});

test("Reset clears the draft and updates expiration, layout, save state, and tools", (t) => {
  const env = setup(t);
  createPopupItemActionsController(env.options).resetSelectedItem();
  assert.equal(env.elements.valueInput.value, "before");
  assert.deepEqual(env.calls.map(([kind]) => kind), ["discard", "expiration", "height", "save-state", "tools"]);
});

test("an engine conflict retains the draft and displays an error without reporting success", async (t) => {
  const env = setup(t);
  env.browser.getStorage(1, "local").setItem("flag", "external");
  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });
  assert.equal(env.browser.getStorage(1, "local").getItem("flag"), "external");
  assert.equal(env.calls.some(([kind]) => kind === "discard"), false);
  assert.match(env.calls.at(-1)[1], /changed after.*prepared/);
  assert.equal(env.calls.at(-1)[2], "error");
  assert.equal(env.state.busy, false);
});

test("single delete submits a reversible null after-state", async (t) => {
  const env = setup(t);
  await createPopupItemActionsController(env.options).deleteSelectedItem();
  const request = env.browser.messages.find((message) => message.command === "submit").spec;
  assert.equal(request.source, "delete");
  assert.deepEqual(request.items[0].before, env.row.raw);
  assert.equal(request.items[0].after, null);
  assert.equal(env.browser.getStorage(1, "local").getItem("flag"), null);
  assert.equal(env.browser.jobs[0].items[0].state, "applied");
});

test("partial batch deletion retains failed selections and clears only successful drafts", async (t) => {
  const env = setup(t);
  env.browser.getStorage(1, "local").setItem("second", "external");
  await createPopupItemActionsController(env.options).batchDeleteSelected();
  assert.equal(env.browser.getStorage(1, "local").getItem("flag"), null);
  assert.equal(env.browser.getStorage(1, "local").getItem("second"), "external");
  assert.deepEqual([...env.state.selectedIds], [env.rows[1].id]);
  assert.deepEqual(env.calls.filter(([kind]) => kind === "discard"), [["discard", env.row.id, 1]]);
  assert.match(env.calls.at(-1)[1], /Deleted 1, 1 failed/);
});

test("editing an unnamed browser cookie preserves its identity and expiration draft", async (t) => {
  const env = setup(t);
  const row = toCookieRow({ name: "", value: "before", domain: "a.example", path: "/", storeId: "0",
    session: true, hostOnly: true, secure: false, httpOnly: false, sameSite: "unspecified" });
  env.browser.cookies.push(structuredClone(row.raw));
  env.options.getSelectedRow = () => row;
  env.options.isCookieView = () => true;
  env.options.getExpirationDraft = () => ({ session: false, expirationDate: 2000000000 });

  await createPopupItemActionsController(env.options).saveSelectedItem({ preventDefault() {} });

  assert.equal(env.browser.cookies[0].name, "");
  assert.equal(env.browser.cookies[0].value, "draft");
  assert.equal(env.browser.cookies[0].expirationDate, 2000000000);
  assert.equal(env.browser.jobs[0].items[0].state, "applied");
  assert.equal(env.calls.at(-1)[2], "success");
});
