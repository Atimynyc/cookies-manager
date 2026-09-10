import assert from "node:assert/strict";
import test from "node:test";
import { installOperationBrowser } from "../helpers/operation-browser.mjs";

import { createPopupSiteDataController } from "../../src/popup/popup-site-data-controller.js";
import { toCookieRow } from "../../src/shared/cookie-format.js";
import { createSiteDataPackage } from "../../src/shared/site-data-package.js";

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

function setup(t) {
  const env = installOperationBrowser(t, { tabs: [
    { id: 1, url: SOURCE_URL, incognito: false },
    { id: 2, url: "https://other.example/app", incognito: false }
  ] });
  env.onRefresh = null;
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
  assert.equal(env.writes[0].url, "https://example.com/");
  assert.equal(env.writes[0].storeId, "0");
  assert.deepEqual(env.writes.slice(1).map((write) => write.tabId), [1, 1]);
  assert.equal(env.getStorage(2, "local").getItem("flag"), null);
  assert.deepEqual(env.reloads, [1]);
  assert.deepEqual(env.jobs[0].target, preview.operationTarget);
  assert.equal(env.jobs[0].source, "package-import");
  assert.equal(env.jobs[0].target.url, SOURCE_URL);
});

test("navigation during a package batch prevents remaining writes and preserves successful-item undo", async (t) => {
  const { env, state, controller } = setup(t);
  state.autoRefreshPage = true;
  const preview = await controller.previewPackage(dataPackage({
    localStorage: [{ key: "first", value: "1" }, { key: "second", value: "2" }]
  }));
  env.afterWrite = () => {
    if (env.writes.length === 1) env.tabs.set(1, { id: 1, url: "https://other.example/", incognito: false });
  };
  const outcome = await controller.applyPackage(preview, applyOptions);

  assert.equal(outcome.result.success.length, 1);
  assert.match(outcome.result.failed[0].error.message, /changed sites/);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.jobs[0].items.map((item) => item.state), ["applied", "failed"]);
  assert.equal(env.jobs[0].target.origin, "https://example.com");
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
  assert.ok(env.jobs[0].items.every((item) => item.state === "undone"));
  assert.deepEqual(env.reloads, [1]);
});

test("batch undo rejects changed target contexts before any mutation", async (t) => {
  const { env, state, controller } = setup(t);
  const originalTab = state.tab;
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "after" }] }));
  await controller.applyPackage(preview, applyOptions);
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
  assert.equal(env.writes.length, 0);
});

test("legacy import snapshots stay untouched and cannot bypass operation journal validation", async (t) => {
  const { env, controller } = setup(t);
  const legacy = { id: "legacy", targetOrigin: "https://example.com", entries: [{ kind: "localStorage", after: { key: "flag", value: "after" } }] };
  env.sessionData.latestSiteDataBatchSnapshot = structuredClone(legacy);
  await assert.rejects(controller.undoLatestBatch(), /No import snapshot/);
  assert.equal(env.writes.length, 0);
  assert.deepEqual(env.sessionData.latestSiteDataBatchSnapshot, legacy);
});

test("navigation during batch undo leaves remaining entries retryable and does not touch the new site", async (t) => {
  const { env, controller } = setup(t);
  const preview = await controller.previewPackage(dataPackage({
    localStorage: [{ key: "first", value: "1" }, { key: "second", value: "2" }]
  }));
  await controller.applyPackage(preview, applyOptions);
  env.writes = [];
  env.afterWrite = () => {
    if (env.writes.length === 1) env.tabs.set(1, { id: 1, url: "https://other.example/", incognito: false });
  };
  const outcome = await controller.undoLatestBatch();

  assert.equal(outcome.complete, false);
  assert.equal(outcome.result.success.length, 1);
  assert.match(outcome.result.failed[0].error.message, /changed sites/);
  assert.equal(env.writes.length, 1);
  assert.deepEqual(env.jobs[0].items.map((item) => item.state), ["undo-failed", "undone"]);
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

test("package apply submits preview before-values and preserves data changed after preview", async (t) => {
  const { env, controller } = setup(t);
  env.getStorage(1, "local").setItem("flag", "before");
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "imported" }] }));
  env.getStorage(1, "local").setItem("flag", "external");

  const result = await controller.applyPackage(preview, applyOptions);
  const request = env.messages.find((message) => message.command === "submit").spec;
  assert.equal(request.items[0].before.value, "before");
  assert.equal(request.items[0].after.value, "imported");
  assert.equal(result.result.failed.length, 1);
  assert.equal(result.canUndo, false);
  assert.equal(env.getStorage(1, "local").getItem("flag"), "external");
  assert.equal(env.writes.length, 0);
});

test("package undo reports conflicts and leaves later changes available for review", async (t) => {
  const { env, controller } = setup(t);
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "imported" }] }));
  await controller.applyPackage(preview, applyOptions);
  env.getStorage(1, "local").setItem("flag", "later");
  env.writes = [];

  const result = await controller.undoLatestBatch();
  assert.equal(result.complete, false);
  assert.equal(result.result.failed.length, 1);
  assert.match(result.result.failed[0].error.message, /changed after.*prepared/);
  assert.equal(env.getStorage(1, "local").getItem("flag"), "later");
  assert.equal(env.jobs[0].items[0].state, "undo-conflict");
  assert.equal(env.writes.length, 0);
});

test("an all-skipped package returns its result without mutating site data", async (t) => {
  const { env, controller } = setup(t);
  env.getStorage(1, "local").setItem("flag", "before");
  const preview = await controller.previewPackage(dataPackage({ localStorage: [{ key: "flag", value: "imported" }] }));

  const outcome = await controller.applyPackage(preview, { strategy: "skip" });
  assert.equal(outcome.result.skipped.length, 1);
  assert.equal(outcome.result.success.length, 0);
  assert.equal(outcome.canUndo, false);
  assert.equal(env.getStorage(1, "local").getItem("flag"), "before");
  assert.equal(env.writes.length, 0);
  assert.equal(env.jobs[0].status, "completed");
  assert.equal(env.jobs[0].items.length, 0);
  assert.equal(env.jobs[0].skipped.length, 1);
});
