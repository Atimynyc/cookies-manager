import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(projectRoot, ".tmp", "v033-acceptance");
const journalKey = "siteDataOperationJournal";
const faultMarkerKey = "v033AcceptanceFault";
const pageErrors = [];
const watchedPages = new WeakSet();
const report = { actionPopup: { verified: false }, scenarios: [] };
let context;
let profileDir;
let server;
let extensionId;
let origin;
let targetPage;
let inspector;
let cdp;
let operationTarget;

try {
  await mkdir(artifactDir, { recursive: true });
  origin = await startServer();
  profileDir = await mkdtemp(path.join(tmpdir(), "cookie-controller-v033-"));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: process.env.HEADED !== "1",
    viewport: { width: 760, height: 800 },
    args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`]
  });
  context.on("page", watchPage);
  context.pages().forEach(watchPage);
  const worker = await getWorker();
  extensionId = new URL(worker.url()).host;
  targetPage = await context.newPage();
  await targetPage.goto(origin);
  inspector = await openExtensionPage();
  cdp = await context.newCDPSession(targetPage);
  await cdp.send("ServiceWorker.enable");
  operationTarget = await inspector.evaluate(async (url) => {
    const { createOperationContext } = await import(chrome.runtime.getURL("src/shared/operation-context.js"));
    const tab = (await chrome.tabs.query({})).find((entry) => entry.url === url);
    const stores = await chrome.cookies.getAllCookieStores();
    const storeId = stores.find((entry) => entry.tabIds.includes(tab.id)).id;
    return createOperationContext(tab, storeId);
  }, targetPage.url());

  await testSurfaceClosure();
  await testPartialFailureRetry();
  await testUndoConflict();
  await testConcurrentWriteConflict();
  await testWorkerRecovery("before");
  await testWorkerRecovery("after");
  await testOperationsView();
  assert.equal(pageErrors.length, 0, pageErrors.join("\n\n"));
  report.passed = true;
  console.log("v0.3.3 durable operation acceptance ok");
  console.log(report.actionPopup.verified
    ? "Native action popup lifecycle: submission, closure and reopening verified through CDP."
    : report.actionPopup.submissionVerified
      ? "Native action popup submission and closure verified; results reopened in an extension page."
      : "Native action popup lifecycle: NOT VERIFIED; extension page closure and reopening passed.");
} catch (error) {
  report.passed = false;
  throw new Error(`${error.stack || error.message}${pageErrors.length ? `\nPage errors:\n${pageErrors.join("\n\n")}` : ""}`);
} finally {
  await writeFile(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2)).catch(() => {});
  if (cdp) await cdp.detach().catch(() => {});
  if (context) await context.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}

async function startServer() {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end("<!doctype html><title>Operation acceptance target</title><h1>Operation acceptance target</h1>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/`;
}

function watchPage(page) {
  if (watchedPages.has(page)) return;
  watchedPages.add(page);
  page.on("pageerror", (error) => pageErrors.push(`${page.url()}\n${error.name}: ${error.message}`));
}

async function getWorker() {
  return context.serviceWorkers().find((worker) => worker.url().includes("/src/background/service-worker.js"))
    || context.waitForEvent("serviceworker", { timeout: 10000 });
}

async function openExtensionPage() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await targetPage.bringToFront();
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#loadingState")?.hidden === true);
  return page;
}

async function callClient(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const client = await import(chrome.runtime.getURL("src/shared/operation-client.js"));
    return client[method](...args);
  }, { method, args });
}

function makeSpec(label, items) {
  return {
    id: `v033-${label}-${crypto.randomUUID()}`,
    target: operationTarget,
    label,
    source: "acceptance-v033",
    items,
    skipped: []
  };
}

function storageItem(name, beforeValue, afterValue) {
  const raw = (value) => value === null ? null : { type: "local", key: name, value, origin: new URL(origin).origin };
  return { id: name, name, kind: "localStorage", before: raw(beforeValue), after: raw(afterValue) };
}

function cookieItem(name, beforeValue, afterValue) {
  const raw = (value) => value === null ? null : {
    name, value, domain: new URL(origin).hostname, path: "/", hostOnly: true,
    session: true, secure: false, httpOnly: false, sameSite: "lax", storeId: operationTarget.cookieStoreId
  };
  return { id: name, name, kind: "cookies", before: raw(beforeValue), after: raw(afterValue) };
}

async function waitForJob(id, predicate = (job) => job.status === "completed") {
  const deadline = Date.now() + 20000;
  let job;
  do {
    job = await callClient(inspector, "getOperation", id);
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`Operation did not reach the expected state: ${summarizeJob(job)}`);
}

function summarizeJob(job) {
  return JSON.stringify({ id: job?.id, status: job?.status, items: job?.items?.map(({ id, state }) => ({ id, state })) });
}

function assertItemStates(job, expected) {
  assert.deepEqual(job.items.map(({ state }) => state), expected, "Unexpected operation item states");
}

function recordScenario(name, job) {
  report.scenarios.push({ name, id: job.id, status: job.status, items: job.items.map(({ id, state }) => ({ id, state })) });
  console.log(`ok: ${name}`);
}

async function testSurfaceClosure() {
  const surface = await openActionPopupOrPage();
  const submissionEvidence = { ...report.actionPopup };
  const items = Array.from({ length: 60 }, (_, index) => storageItem(`close_${index}`, null, `synthetic-${index}`));
  const spec = makeSpec("surface-close", items);
  const ack = await callClient(surface.page, "submitOperation", spec);
  assert.ok(ack.id, "Submit must return a durable operation id");
  const beforeClose = await inspector.evaluate(async ({ key, id }) =>
    (await chrome.storage.session.get(key))[key].jobs.find((job) => job.id === id), { key: journalKey, id: ack.id });
  assert.ok(beforeClose.items.some((item) => ["pending", "running"].includes(item.state)), "The native surface must close while accepted work is still unfinished");
  await surface.page.close();
  const reopened = surface.native ? await openActionPopupOrPage() : { page: await openExtensionPage(), native: false };
  if (surface.native && !reopened.native) {
    report.actionPopup.verified = false;
    report.actionPopup.submissionVerified = true;
    report.actionPopup.submission = submissionEvidence;
    report.actionPopup.reason = "Native submission surface was observed, but native reopening was not available.";
  }
  const listed = await callClient(reopened.page, "listOperations");
  assert.ok(listed.some((job) => job.id === ack.id), "The reopened surface must list the accepted operation");
  const job = await waitForJob(ack.id);
  assertItemStates(job, items.map(() => "applied"));
  const allPresent = await targetPage.evaluate((names) => names.every((name, index) => localStorage.getItem(name) === `synthetic-${index}`), items.map(({ name }) => name));
  assert.ok(allPresent, "Accepted writes must complete after the initiating surface closes");
  await reopened.page.close();
  recordScenario("initiator closes and reopens after durable ACK", job);
}

async function testOperationsView() {
  await targetPage.bringToFront();
  await inspector.locator("#refreshButton").click();
  await inspector.locator("#historyViewButton").click();
  await inspector.locator("#operationsTabButton").click();
  await inspector.locator("#operationList > li").first().waitFor();
  const jobs = await callClient(inspector, "listOperations");
  const conflict = jobs.find((job) => job.label === "undo-conflict");
  const row = inspector.locator(`#operationList > li[data-operation-id="${conflict.id}"]`);
  await row.locator("summary").click();
  await row.locator('[data-state="undo-conflict"] p').waitFor();
  for (const width of [760, 420]) {
    await inspector.setViewportSize({ width, height: 820 });
    await inspector.evaluate((size) => {
      document.body.dataset.surface = size === 420 ? "sidepanel" : "popup";
      document.documentElement.dataset.surface = document.body.dataset.surface;
    }, width);
    await row.scrollIntoViewIfNeeded();
    const layout = await inspector.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      listOverflow: document.querySelector("#operationList").scrollWidth > document.querySelector("#operationList").clientWidth + 1,
      visibleErrors: [...document.querySelectorAll('[data-state="undo-conflict"] p')].some((node) => node.getBoundingClientRect().height > 0)
    }));
    assert.deepEqual(layout, { pageOverflow: false, listOverflow: false, visibleErrors: true });
    await inspector.screenshot({ path: path.join(artifactDir, `operations-${width}.png`) });
  }
  await targetPage.evaluate(() => localStorage.setItem("undo_guard", "after"));
  await row.getByRole("button", { name: "Undo", exact: true }).click();
  await inspector.waitForFunction(() => document.querySelector("#statusMessage").textContent === "Operation undone.");
  assert.equal(await targetPage.evaluate(() => localStorage.getItem("undo_guard")), "before");
  const retrySpec = makeSpec("ui-retry", [storageItem("ui_retry", "required-baseline", "applied")]);
  await callClient(inspector, "runOperation", retrySpec);
  const retryRow = inspector.locator(`#operationList > li[data-operation-id="${retrySpec.id}"]`);
  await retryRow.getByRole("button", { name: "Retry failed" }).waitFor();
  await targetPage.evaluate(() => localStorage.setItem("ui_retry", "required-baseline"));
  await retryRow.getByRole("button", { name: "Retry failed" }).click();
  await inspector.waitForFunction(() => document.querySelector("#statusMessage").textContent === "Retry complete.");
  assert.equal(await targetPage.evaluate(() => localStorage.getItem("ui_retry")), "applied");
  const completedRetry = await callClient(inspector, "getOperation", retrySpec.id);
  await retryRow.getByRole("button", { name: "Remove record" }).click();
  await inspector.locator("#confirmDialogDeleteButton").click();
  await inspector.waitForFunction(() => document.querySelector("#statusMessage").textContent === "Operation record removed.");
  assert.equal(await callClient(inspector, "getOperation", retrySpec.id), null);
  assert.equal(await targetPage.evaluate(() => localStorage.getItem("ui_retry")), "applied", "Removing a record must leave site data unchanged");
  recordScenario("operation results, UI retry, UI undo, record removal and responsive layout", completedRetry);
}

async function openActionPopupOrPage() {
  await targetPage.bringToFront();
  const before = new Set((await cdp.send("Target.getTargets")).targetInfos.map(({ targetId }) => targetId));
  const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
  const pagePromise = context.waitForEvent("page", {
    predicate: (page) => page.url().startsWith(popupUrl), timeout: 4000
  }).catch(() => null);
  let openError = "";
  try {
    const worker = await getWorker();
    await worker.evaluate(() => chrome.action.openPopup());
  } catch (error) {
    openError = error.message;
  }
  const candidate = await pagePromise;
  const targets = (await cdp.send("Target.getTargets")).targetInfos;
  const created = targets.filter((target) => !before.has(target.targetId) && target.url.startsWith(popupUrl));
  if (candidate) {
    const session = await context.newCDPSession(candidate);
    const { targetInfo } = await session.send("Target.getTargetInfo");
    await session.detach();
    if (targetInfo.type === "page" && created.some(({ targetId }) => targetId === targetInfo.targetId)) {
      report.actionPopup = { verified: true, targetType: targetInfo.type, targetUrl: targetInfo.url, openedBy: "chrome.action.openPopup" };
      await candidate.waitForLoadState("domcontentloaded");
      return { page: candidate, native: true };
    }
    await candidate.close();
  }
  for (const target of targets.filter((item) => item.url.startsWith(popupUrl))) {
    const nativePopup = await attachPopupTarget(target.targetId);
    if (await nativePopup.evaluate(() => chrome.extension.getViews({ type: "popup" }).includes(window))) {
      report.actionPopup = { verified: true, targetType: target.type, targetUrl: target.url, openedBy: "chrome.action.openPopup", automation: "CDP Runtime" };
      return { page: nativePopup, native: true };
    }
    await nativePopup.detach();
  }
  for (const target of created) await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
  report.actionPopup = {
    verified: false,
    observedTargets: created.map(({ type, url }) => ({ type, url })),
    reason: openError || (created.length ? "Action popup target was not exposed as an automatable page." : "No new action popup page target was observed.")
  };
  return { page: await openExtensionPage(), native: false };
}

async function attachPopupTarget(targetId) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false });
  let commandId = 0;
  const pending = new Map();
  const onMessage = (event) => {
    if (event.sessionId !== sessionId) return;
    const result = JSON.parse(event.message);
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    clearTimeout(request.timer);
    if (result.error) request.reject(new Error(result.error.message));
    else request.resolve(result.result);
  };
  cdp.on("Target.receivedMessageFromTarget", onMessage);
  function send(method, params) {
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native Popup ${method} timed out.`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    });
  }
  return {
    async evaluate(fn, arg) {
      const result = await send("Runtime.evaluate", {
        expression: `(${fn.toString()})(${JSON.stringify(arg) ?? "undefined"})`,
        awaitPromise: true, returnByValue: true
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async detach() {
      await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
      cdp.off("Target.receivedMessageFromTarget", onMessage);
    },
    async close() {
      await cdp.send("Target.sendMessageToTarget", {
        sessionId, message: JSON.stringify({ id: ++commandId, method: "Runtime.evaluate", params: { expression: "window.close()" } })
      });
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const targets = (await cdp.send("Target.getTargets")).targetInfos;
        if (!targets.some((target) => target.targetId === targetId)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      cdp.off("Target.receivedMessageFromTarget", onMessage);
    }
  };
}

async function testPartialFailureRetry() {
  const first = cookieItem("retry_success", null, "first-write");
  const second = cookieItem("retry_transient", null, "retry-write");
  await installCookieFault(second.name, "throw-once");
  const job = await callClient(inspector, "runOperation", makeSpec("partial-failure", [first, second]));
  assertItemStates(job, ["applied", "failed"]);
  await context.addCookies([{ url: origin, name: first.name, value: "external-success-edit", sameSite: "Lax" }]);
  const retried = await callClient(inspector, "retryOperation", job.id);
  assertItemStates(retried, ["applied", "applied"]);
  const values = await context.cookies(origin);
  assert.ok(values.find(({ name }) => name === first.name)?.value === "external-success-edit", "Retry must not replay successful items");
  assert.ok(values.find(({ name }) => name === second.name)?.value === "retry-write", "Retry must apply the transiently failed item");
  recordScenario("partial failure retries only failed items", retried);
}

async function testUndoConflict() {
  await targetPage.evaluate(() => localStorage.setItem("undo_guard", "before"));
  const item = storageItem("undo_guard", "before", "after");
  const applied = await callClient(inspector, "runOperation", makeSpec("undo-conflict", [item]));
  assertItemStates(applied, ["applied"]);
  await targetPage.evaluate(() => localStorage.setItem("undo_guard", "external"));
  const undone = await callClient(inspector, "undoOperation", applied.id, { itemIds: [item.id], target: operationTarget });
  assertItemStates(undone, ["undo-conflict"]);
  assert.ok(await targetPage.evaluate(() => localStorage.getItem("undo_guard") === "external"), "Undo must preserve externally modified data");
  recordScenario("undo rejects external changes", undone);
}

async function testConcurrentWriteConflict() {
  await targetPage.evaluate(() => localStorage.setItem("concurrent_guard", "baseline"));
  const secondPage = await openExtensionPage();
  const specs = ["writer-a", "writer-b"].map((label) => makeSpec(label, [storageItem("concurrent_guard", "baseline", label)]));
  const accepted = await Promise.all([
    callClient(inspector, "submitOperation", specs[0]),
    callClient(secondPage, "submitOperation", specs[1])
  ]);
  const jobs = await Promise.all(accepted.map(({ id }) => waitForJob(id)));
  assert.deepEqual(jobs.map((job) => job.items[0].state).sort(), ["applied", "conflict"], "Concurrent jobs must detect stale before-state");
  const winner = jobs.findIndex((job) => job.items[0].state === "applied");
  assert.ok(await targetPage.evaluate((expected) => localStorage.getItem("concurrent_guard") === expected, specs[winner].items[0].after.value), "The conflicting job must not overwrite the winner");
  await secondPage.close();
  recordScenario("concurrent surfaces detect a same-item conflict", jobs[winner]);
}

async function installCookieFault(name, mode) {
  await inspector.evaluate((key) => chrome.storage.session.remove(key), faultMarkerKey);
  const worker = await getWorker();
  await worker.evaluate(({ name, mode, markerKey }) => {
    const original = chrome.cookies.set.bind(chrome.cookies);
    chrome.cookies.set = (details, callback) => {
      if (details.name !== name) return original(details, callback);
      chrome.cookies.set = original;
      if (mode === "throw-once") throw new Error("Synthetic transient cookie write failure.");
      if (mode === "before") {
        void chrome.storage.session.set({ [markerKey]: { mode, held: true } });
        return undefined;
      }
      return original(details, () => {
        const failed = Boolean(chrome.runtime.lastError);
        void chrome.storage.session.set({ [markerKey]: { mode, held: true, failed } });
      });
    };
  }, { name, mode, markerKey: faultMarkerKey });
}

async function testWorkerRecovery(mode) {
  const item = cookieItem(`recovery_${mode}`, null, `recovery-${mode}`);
  const tail = storageItem(`recovery_tail_${mode}`, null, "completed-after-restart");
  await installCookieFault(item.name, mode);
  const accepted = await callClient(inspector, "submitOperation", makeSpec(`worker-${mode}`, [item, tail]));
  const markerDeadline = Date.now() + 10000;
  let marker;
  while (Date.now() < markerDeadline) {
    marker = await inspector.evaluate(async (key) => (await chrome.storage.session.get(key))[key], faultMarkerKey);
    if (marker?.held) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(marker?.held, "The injected cookie fault must hold the browser callback");
  assert.ok(!marker.failed, "The injected after-write interruption must occur after a successful browser mutation");
  const checkpoint = await inspector.evaluate(async ({ key, id }) => {
    const journal = (await chrome.storage.session.get(key))[key];
    const job = journal.jobs.find((entry) => entry.id === id);
    return { status: job.status, states: job.items.map(({ state }) => state) };
  }, { key: journalKey, id: accepted.id });
  assert.equal(checkpoint.states[0], "running", "An uncertain running checkpoint must precede interruption");
  assert.equal(checkpoint.states[1], "pending", "Unstarted work must be checkpointed before interruption");
  const visibleCheckpoint = await callClient(inspector, "getOperation", accepted.id);
  assert.equal(visibleCheckpoint.items[0].state, "running", "Reopened views must read progress while the browser callback is pending");
  const valueBeforeRestart = (await context.cookies(origin)).find(({ name }) => name === item.name)?.value;
  assert.ok(mode === "before" ? valueBeforeRestart === undefined : valueBeforeRestart === item.after.value, "Fault injection must stop at the requested mutation boundary");
  await stopExtensionWorker();
  const recovered = await waitForJob(accepted.id);
  assertItemStates(recovered, ["applied", "applied"]);
  assert.ok((await context.cookies(origin)).find(({ name }) => name === item.name)?.value === item.after.value, "Recovered mutation must match the intended state");
  assert.ok(await targetPage.evaluate((key) => localStorage.getItem(key) === "completed-after-restart", tail.name), "Queued work must continue after worker restart");
  recordScenario(`worker restart reconciles ${mode}-mutation running checkpoint`, recovered);
}

async function stopExtensionWorker() {
  const versions = new Map();
  const onVersions = ({ versions: updates }) => {
    for (const version of updates) versions.set(version.versionId, version);
  };
  cdp.on("ServiceWorker.workerVersionUpdated", onVersions);
  await cdp.send("ServiceWorker.disable");
  await cdp.send("ServiceWorker.enable");
  const deadline = Date.now() + 5000;
  let version;
  while (Date.now() < deadline) {
    version = [...versions.values()].find((entry) => entry.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && entry.runningStatus === "running");
    if (version) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(version, "CDP must expose the running extension service worker before a restart test");
  await cdp.send("ServiceWorker.stopWorker", { versionId: version.versionId });
  const stoppedDeadline = Date.now() + 5000;
  while (Date.now() < stoppedDeadline && versions.get(version.versionId)?.runningStatus !== "stopped") {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(versions.get(version.versionId)?.runningStatus, "stopped", "Worker must actually stop before recovery is exercised");
  cdp.off("ServiceWorker.workerVersionUpdated", onVersions);
}
