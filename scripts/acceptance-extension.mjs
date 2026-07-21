import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(projectRoot, "tests", "fixtures", "cookie-test-page.html");
const artifactDir = path.join(projectRoot, "tests", "artifacts");
const extensionPath = projectRoot;
const runId = Date.now().toString(36);
const jwt =
  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiZGV2Iiwicm9sZXMiOlsicWEiXX0.";

let server;
let context;
let userDataDir;

try {
  const { baseUrl, closeServer } = await startCookieServer();
  server = { close: closeServer };

  userDataDir = await mkdtemp(path.join(tmpdir(), "cookie-controller-profile-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: process.env.HEADED !== "1",
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const extensionId = await getExtensionId(context);
  const testPage = await context.newPage();

  await mkdir(artifactDir, { recursive: true });
  await testPage.goto(`${baseUrl}/cookie-test-page.html?seed=${runId}`);
  await waitForCookie(context, baseUrl, "plain");

  const popup = await openPopupForActiveTab(context, testPage, extensionId);
  await waitForPopupReady(popup, "127.0.0.1");
  await assertPopupListsSeededCookies(popup);
  await assertValueTools(popup);
  await assertStressLayout(popup);
  await assertExportFlow(popup);
  await assertColumnPreference(popup);
  await assertTemplateFlow(popup);
  await assertBatchFlow(popup, context, baseUrl);
  await assertLiveCookieRefresh(popup, context, baseUrl);
  await assertLocalStorageFlow(popup, testPage, runId);
  await assertSessionStorageFlow(popup, testPage, runId);
  await assertHistoryPartitioning(popup, runId);
  await switchDataView(popup, "cookies");
  await screenshot(popup, "milestone-4-popup-tools.png");
  await assertEditFlow(popup, context, baseUrl);
  await assertImportFlow(popup, context, baseUrl);
  await popup.locator("#historyViewButton").click();
  await screenshot(popup, "milestone-4-popup-history.png");
  await assertDeleteFlow(popup, context, baseUrl);

  await popup.locator("#searchInput").fill("");
  await popup.waitForFunction(() => document.querySelectorAll("#cookieTableBody tr").length >= 7);
  await screenshot(popup, "milestone-4-popup-final.png");
  await assertHistoryRequiresValueSnapshots(popup);
  await assertSingleHistoryDetailLayout(popup, runId);
  console.log("extension acceptance ok");
} finally {
  if (context) {
    await context.close();
  }
  if (server) {
    await server.close();
  }
  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function startCookieServer() {
  const html = await readFile(fixturePath);
  const serverInstance = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname !== "/" && url.pathname !== "/cookie-test-page.html") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const headers = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    };

    if (url.searchParams.has("seed")) {
      headers["set-cookie"] = createSeedCookies();
    }

    response.writeHead(200, headers);
    response.end(html);
  });

  await new Promise((resolve) => serverInstance.listen(0, "127.0.0.1", resolve));
  const address = serverInstance.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    closeServer: () => new Promise((resolve, reject) => {
      serverInstance.close((error) => error ? reject(error) : resolve());
    })
  };
}

function createSeedCookies() {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();

  return [
    `plain=hello-world-${runId}; Path=/; SameSite=Lax`,
    `editable=before-${runId}; Path=/; SameSite=Lax`,
    `delete_me=remove-me-${runId}; Path=/; SameSite=Lax`,
    "encoded=%7B%22ok%22%3Atrue%2C%22from%22%3A%22playwright%22%7D; Path=/; SameSite=Lax",
    `jwt=${jwt}; Path=/; SameSite=Lax`,
    `http_only=server-secret-${runId}; HttpOnly; Path=/; SameSite=Lax`,
    `expires_cookie=lasting-${runId}; Expires=${expires}; Path=/; SameSite=Lax`,
    `strict_cookie=strict-${runId}; Path=/; SameSite=Strict`
  ];
}

async function getExtensionId(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  }

  const extensionId = worker.url().split("/")[2];
  assert.ok(extensionId, `Could not resolve extension id from ${worker.url()}`);
  return extensionId;
}

async function openPopupForActiveTab(context, activePage, extensionId) {
  await activePage.bringToFront();

  const [worker] = context.serviceWorkers();
  assert.ok(worker, "Extension service worker is not available.");

  const popupPromise = context.waitForEvent("page", { timeout: 10000 });

  try {
    await worker.evaluate(() => chrome.action.openPopup());
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    return popup;
  } catch (error) {
    console.warn(`action popup was not exposed by this browser mode: ${error.message}`);
    return openPopupTabForActivePage(context, activePage, extensionId);
  }
}

async function openPopupTabForActivePage(context, activePage, extensionId) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  await activePage.bringToFront();
  await popup.reload({ waitUntil: "domcontentloaded" });
  return popup;
}

async function waitForPopupReady(popup, expectedHost) {
  await popup.waitForSelector("#cookieTableBody tr", { timeout: 10000 });
  await popup.waitForFunction((host) => {
    const label = document.querySelector("#hostLabel");
    return label?.textContent?.includes(host);
  }, expectedHost);
}

async function assertPopupListsSeededCookies(popup) {
  const names = await getTableNames(popup);

  for (const expected of ["plain", "editable", "delete_me", "encoded", "jwt", "http_only"]) {
    assert.ok(names.includes(expected), `Expected popup list to include ${expected}. Got: ${names.join(", ")}`);
  }
}

async function assertValueTools(popup) {
  await selectCookieBySearch(popup, "encoded");
  await runValueTool(popup, "urlDecode");
  await expectToolOutput(popup, '"ok":true');

  await runValueTool(popup, "jsonFormat");
  await expectToolOutput(popup, '"from": "playwright"');

  await runValueTool(popup, "jsonCompact");
  await expectToolOutput(popup, '{"ok":true,"from":"playwright"}');

  await runValueTool(popup, "urlEncode");
  await expectToolOutput(popup, "%257B%2522ok%2522%253Atrue");

  await selectCookieBySearch(popup, "jwt");
  await runValueTool(popup, "jwt");
  await expectToolOutput(popup, '"user": "dev"');

  const storedMode = await readStorageValue(popup, "valueToolMode");
  assert.equal(storedMode, "jwt");
}

async function assertStressLayout(popup) {
  await selectCookieBySearch(popup, "jwt");
  await popup.evaluate(() => {
    const longValue = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJ1c2VyIjoiYnl0ZWJhc2UtdGVzdGVyIiwicm9sZXMiOlsiYWRtaW4iLCJvcGVyYXRvciIsInJlYWRlciIsImJpbGxpbmciXSwiZXhwIjoxNzgxNDk0ODA1LCJpYXQiOjE3ODA4OTAwMDUsInNjb3BlIjoiYmIudXNlci5hY2Nlc3MucHJvZCJ9",
      "aduU5kaIqrHADq5fgHCp-di_I"
    ].join(".");

    document.querySelector("#hostLabel").textContent = "bytebase.z-trip.cn";
    document.querySelector("#editorName").textContent = "access-token";
    document.querySelector("#editorLocation").textContent = "bytebase.z-trip.cn/";
    document.querySelector("#valueInput").value = longValue;
    document.querySelector("#valueToolModeSelect").value = "jwt";
    document.querySelector("#toolOutputTitle").textContent = "JWT payload";
    document.querySelector("#toolOutputBody").textContent = JSON.stringify({
      user: "bytebase-tester",
      roles: ["admin", "operator", "reader", "billing"],
      scope: "bb.user.access.prod",
      exp: 1781494805,
      iat: 1780890005
    }, null, 2);
    document.querySelector("#toolOutput").hidden = false;
    document.querySelector(".detail-pane").scrollTop = 0;
  });

  const layout = await popup.evaluate(() => {
    const selectors = {
      app: ".app-shell",
      topbar: ".topbar",
      content: ".content",
      tablePane: ".table-pane",
      detailPane: ".detail-pane",
      valueField: ".value-field",
      valueInput: "#valueInput",
      utilityActions: ".utility-actions",
      toolOutput: "#toolOutput",
      metaGrid: ".meta-grid",
      runButton: "#runToolButton",
      autoRefresh: ".switch"
    };
    const rects = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [name, {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      }];
    }));
    const ordered = [rects.valueField, rects.utilityActions, rects.toolOutput, rects.metaGrid];

    return {
      rects,
      orderedVertically: ordered.every((rect, index) => {
        const previous = ordered[index - 1];
        return !previous || previous.bottom <= rect.top + 1;
      }),
      runButtonInsideUtilityRow:
        rects.runButton.left >= rects.utilityActions.left &&
        rects.runButton.right <= rects.utilityActions.right + 1 &&
        rects.runButton.top >= rects.utilityActions.top &&
        rects.runButton.bottom <= rects.utilityActions.bottom + 1,
      topbarInsideApp:
        rects.autoRefresh.right <= rects.app.right + 1 &&
        rects.autoRefresh.left >= rects.app.left,
      panesDoNotOverlap: rects.tablePane.right <= rects.detailPane.left + 1,
      detailChildrenInsidePane:
        rects.valueInput.right <= rects.detailPane.right + 1 &&
        rects.toolOutput.right <= rects.detailPane.right + 1 &&
        rects.utilityActions.right <= rects.detailPane.right + 1
    };
  });

  assert.equal(layout.orderedVertically, true, JSON.stringify(layout.rects, null, 2));
  assert.equal(layout.runButtonInsideUtilityRow, true, JSON.stringify(layout.rects, null, 2));
  assert.equal(layout.topbarInsideApp, true, JSON.stringify(layout.rects, null, 2));
  assert.equal(layout.panesDoNotOverlap, true, JSON.stringify(layout.rects, null, 2));
  assert.equal(layout.detailChildrenInsidePane, true, JSON.stringify(layout.rects, null, 2));
  await screenshot(popup, "milestone-4-popup-layout-stress.png");
}

async function assertExportFlow(popup) {
  await popup.evaluate(() => {
    window.__lastClipboardWrite = "";
    const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      window.__lastClipboardWrite = text;
      return originalWriteText(text);
    };
  });
  await popup.locator("#exportButton").click();
  await waitForStatus(popup, "Exported");
  const exportedText = await popup.evaluate(() => window.__lastClipboardWrite);
  const exported = JSON.parse(exportedText);
  assert.ok(exported.cookies.some((cookie) => cookie.name === "plain"));
  assert.ok(exported.count >= 7);
}

async function assertTemplateFlow(popup) {
  await selectCookieBySearch(popup, "plain");
  popup.once("dialog", (dialog) => dialog.accept(`Plain template ${runId}`));
  await popup.locator("#saveTemplateButton").click();
  await waitForStatus(popup, "Saved template");

  await selectCookieBySearch(popup, "editable");
  popup.once("dialog", (dialog) => dialog.accept("1"));
  await popup.locator("#applyTemplateButton").click();
  await waitForStatus(popup, "Applied template");
  const value = await popup.locator("#valueInput").inputValue();
  assert.match(value, new RegExp(`hello-world-${runId}`));
  await popup.locator("#resetButton").click();
}

async function assertBatchFlow(popup, context, baseUrl) {
  await popup.locator("#searchInput").fill("batch_");
  await context.addCookies([
    {
      name: `batch_one_${runId}`,
      value: "one",
      url: baseUrl
    },
    {
      name: `batch_two_${runId}`,
      value: "two",
      url: baseUrl
    }
  ]);
  await popup.locator("#refreshButton").click();
  await popup.waitForFunction(() => document.querySelectorAll("#cookieTableBody tr").length >= 2);
  await popup.locator("#selectAllCheckbox").check();

  popup.once("dialog", (dialog) => dialog.accept(`batch-updated-${runId}`));
  await popup.locator("#batchEditButton").click();
  await waitForStatus(popup, "Updated 2 selected cookies.");

  let cookies = await context.cookies(baseUrl);
  assert.equal(cookies.find((cookie) => cookie.name === `batch_one_${runId}`)?.value, `batch-updated-${runId}`);
  assert.equal(cookies.find((cookie) => cookie.name === `batch_two_${runId}`)?.value, `batch-updated-${runId}`);

  await popup.locator("#selectAllCheckbox").check();
  popup.once("dialog", (dialog) => dialog.accept());
  await popup.locator("#batchDeleteButton").click();
  await waitForStatus(popup, "Deleted 2 selected cookies.");

  cookies = await context.cookies(baseUrl);
  assert.equal(cookies.some((cookie) => cookie.name === `batch_one_${runId}`), false);
  assert.equal(cookies.some((cookie) => cookie.name === `batch_two_${runId}`), false);
  await popup.locator("#searchInput").fill("");
}

async function assertLiveCookieRefresh(popup, context, baseUrl) {
  await switchDataView(popup, "cookies");
  await popup.locator("#searchInput").fill(`live_${runId}`);
  await context.addCookies([
    {
      name: `live_${runId}`,
      value: "from-change-listener",
      url: baseUrl
    }
  ]);
  await popup.waitForFunction((name) => {
    return Array.from(document.querySelectorAll("#cookieTableBody tr td:nth-child(2)"))
      .some((cell) => cell.textContent === name);
  }, `live_${runId}`);
  await popup.locator("#searchInput").fill("");
}

async function assertEditFlow(popup, context, baseUrl) {
  const nextValue = `after-${runId}`;

  await selectCookieBySearch(popup, "editable");
  await popup.locator("#valueInput").fill(nextValue);
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved editable.");
  await popup.locator("#closeStatusButton").click();
  assert.equal(await popup.locator("#statusBar").isHidden(), true);
  assert.equal(await popup.locator("#statusMessage").textContent(), "");
  assert.equal(await popup.locator("#closeStatusButton").count(), 1);

  const cookies = await context.cookies(baseUrl);
  const edited = cookies.find((cookie) => cookie.name === "editable");
  assert.equal(edited?.value, nextValue);

  assert.equal(await popup.locator("#historyCountBadge").isHidden(), false);
  await popup.locator("#historyViewButton").click();
  await popup.waitForFunction(() => {
    return document.querySelector("#historyPanel")?.hidden === false &&
      document.querySelector("#detailsView")?.hidden === true;
  });
  assert.equal(await popup.locator("#historyCountBadge").isHidden(), true);
  const historyText = await popup.locator("#historyList").innerText();
  assert.match(historyText, /editable/);
  assert.match(historyText, /Undo/);

  await popup.locator(".history-detail-button").first().click();
  await popup.waitForFunction(() => {
    return document.querySelector("#historyDetail")?.hidden === false;
  });
  await assertHistoryDetailLayout(popup);
  await screenshot(popup, "milestone-4-popup-history-detail.png");
  const detailText = await popup.locator("#historyDetail").innerText();
  assert.match(detailText, /Edit/);
  assert.match(detailText, /editable/);
  assert.match(detailText, new RegExp(`before-${runId}`));
  assert.match(detailText, new RegExp(nextValue));
  assert.equal(await popup.locator("#historyBeforeValue .diff-removed").count(), 1);
  assert.equal(await popup.locator("#historyAfterValue .diff-added").count(), 1);

  await popup.locator(".history-undo-button").first().click();
  await waitForStatus(popup, "Undid the selected change.");

  const restoredCookies = await context.cookies(baseUrl);
  const restored = restoredCookies.find((cookie) => cookie.name === "editable");
  assert.equal(restored?.value, `before-${runId}`);

  await popup.locator("#detailsViewButton").click();
  await popup.waitForFunction(() => {
    return document.querySelector("#detailsView")?.hidden === false &&
      document.querySelector("#historyPanel")?.hidden === true;
  });
}

async function assertImportFlow(popup, context, baseUrl) {
  const name = `imported_${runId}`;
  const value = `from-input-${runId}`;

  await popup.evaluate(() => {
    window.__clipboardReadAttempted = false;
    navigator.clipboard.readText = async () => {
      window.__clipboardReadAttempted = true;
      throw new Error("Clipboard reads are disabled for import.");
    };
  });
  popup.once("dialog", (dialog) => dialog.accept(`${name}=${value}`));
  await popup.locator("#importButton").click();
  await waitForStatus(popup, `Imported ${name}.`);
  assert.equal(await popup.evaluate(() => window.__clipboardReadAttempted), false);

  const cookies = await context.cookies(baseUrl);
  const imported = cookies.find((cookie) => cookie.name === name);
  assert.equal(imported?.value, value);

  assert.equal(await popup.locator("#historyCountBadge").isHidden(), false);
  await popup.locator("#historyViewButton").click();
  assert.equal(await popup.locator("#historyCountBadge").isHidden(), true);
  await popup.locator(".history-detail-button").first().click();
  const detailText = await popup.locator("#historyDetail").innerText();
  assert.match(detailText, /Import create/);
  assert.match(detailText, new RegExp(name));
  assert.match(detailText, new RegExp(value));

  await popup.locator(".history-undo-button").first().click();
  await waitForStatus(popup, "Undid the selected change.");

  const afterUndo = await context.cookies(baseUrl);
  assert.equal(afterUndo.some((cookie) => cookie.name === name), false);
}

async function assertDeleteFlow(popup, context, baseUrl) {
  await selectCookieBySearch(popup, "delete_me");
  popup.once("dialog", (dialog) => dialog.accept());
  await popup.locator("#deleteButton").click();
  await waitForStatus(popup, "Deleted delete_me.");

  const cookies = await context.cookies(baseUrl);
  assert.equal(cookies.some((cookie) => cookie.name === "delete_me"), false);
}

async function assertHistoryRequiresValueSnapshots(popup) {
  const storedChanges = await popup.evaluate(async () => {
    const result = await chrome.storage.local.get({ recentCookieChanges: [] });
    return result.recentCookieChanges;
  });
  assert.ok(storedChanges.length > 0, "Expected persisted history metadata before reloading the popup.");

  await popup.reload({ waitUntil: "domcontentloaded" });
  await waitForPopupReady(popup, "127.0.0.1");
  await popup.locator("#historyViewButton").click();

  assert.equal(await popup.locator("#historyList li").count(), 0);
  assert.equal(await popup.locator("#historyList").isHidden(), true);
  assert.equal(await popup.locator("#historyEmpty").innerText(), "No recent changes");
  assert.equal(await popup.locator("#historyCountBadge").isHidden(), true);
  assert.equal(await popup.locator("#clearHistoryButton").isDisabled(), true);
}

async function assertHistoryDetailLayout(popup) {
  const layout = await popup.evaluate(() => {
    const list = document.querySelector("#historyList");
    const detail = document.querySelector("#historyDetail");
    const expandedItem = detail?.closest("li");
    const summary = expandedItem?.querySelector(".history-sub");
    const detailRect = detail?.getBoundingClientRect();
    const itemRect = expandedItem?.getBoundingClientRect();
    const summaryRect = summary?.getBoundingClientRect();
    const items = Array.from(list?.querySelectorAll("li") || []);
    const expandedIndex = items.indexOf(expandedItem);
    const nextItemRect = items[expandedIndex + 1]?.getBoundingClientRect();

    return {
      detailIsInline: expandedItem?.parentElement === list,
      expanded: expandedItem?.classList.contains("is-expanded") || false,
      summaryBottom: summaryRect?.bottom || 0,
      detailTop: detailRect?.top || 0,
      detailLeft: detailRect?.left || 0,
      detailRight: detailRect?.right || 0,
      itemLeft: itemRect?.left || 0,
      itemRight: itemRect?.right || 0,
      itemBottom: itemRect?.bottom || 0,
      detailBottom: detailRect?.bottom || 0,
      nextItemTop: nextItemRect?.top || 0
    };
  });

  assert.equal(layout.detailIsInline, true, "History detail is not nested in its source record.");
  assert.equal(layout.expanded, true, "Source history record is not marked as expanded.");
  assert.ok(layout.detailTop >= layout.summaryBottom, "History detail overlaps its record summary.");
  assert.ok(layout.detailTop - layout.summaryBottom <= 9, "Unexpected blank space before inline history detail.");
  assert.ok(layout.detailLeft >= layout.itemLeft && layout.detailRight <= layout.itemRight, "History detail exceeds its record bounds.");
  assert.ok(
    layout.detailBottom <= layout.itemBottom + 1,
    `History detail exceeds its record height: ${JSON.stringify(layout)}`
  );
  if (layout.nextItemTop > 0) {
    assert.ok(layout.detailBottom <= layout.nextItemTop, "Expanded history detail overlaps the next record.");
  }
}

async function assertSingleHistoryDetailLayout(popup, seed) {
  await popup.locator("#detailsViewButton").click();
  await selectCookieBySearch(popup, "editable");
  await popup.locator("#valueInput").fill(`single-history-${seed}`);
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved editable.");

  await popup.locator("#historyViewButton").click();
  await popup.locator(".history-detail-button").first().click();
  await assertHistoryDetailLayout(popup);
  await screenshot(popup, "milestone-4-popup-history-detail-single.png");
}

async function assertLocalStorageFlow(popup, page, seed) {
  await switchDataView(popup, "localStorage");
  await waitForPopupReady(popup, "127.0.0.1");
  await selectItemBySearch(popup, "local_plain");
  await popup.locator("#valueInput").fill(`local-after-${seed}`);
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved local_plain.");

  const edited = await page.evaluate(() => localStorage.getItem("local_plain"));
  assert.equal(edited, `local-after-${seed}`);

  await popup.locator("#historyViewButton").click();
  await popup.locator(".history-detail-button").first().click();
  const detailText = await popup.locator("#historyDetail").innerText();
  assert.match(detailText, /Local Storage/);
  assert.match(detailText, /local_plain/);

  await popup.locator(".history-undo-button").first().click();
  await waitForStatus(popup, "Undid the selected change.");
  const restored = await page.evaluate(() => localStorage.getItem("local_plain"));
  assert.equal(restored, `local-before-${seed}`);

  await popup.locator("#detailsViewButton").click();
  await selectItemBySearch(popup, "local_json");
  await runValueTool(popup, "jsonFormat");
  await expectToolOutput(popup, '"area": "local"');

  await popup.evaluate(() => {
    window.__lastClipboardWrite = "";
    const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      window.__lastClipboardWrite = text;
      return originalWriteText(text);
    };
  });
  await popup.locator("#exportButton").click();
  await waitForStatus(popup, "Exported");
  const exportedText = await popup.evaluate(() => window.__lastClipboardWrite);
  const exported = JSON.parse(exportedText);
  assert.equal(exported.type, "localStorage");
  assert.ok(exported.items.some((item) => item.key === "local_plain"));

  const importName = `local_imported_${seed}`;
  popup.once("dialog", (dialog) => dialog.accept(`${importName}=local-import-value`));
  await popup.locator("#importButton").click();
  await waitForStatus(popup, `Imported ${importName}.`);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), importName), "local-import-value");

  await selectItemBySearch(popup, "local_delete_me");
  popup.once("dialog", (dialog) => dialog.accept());
  await popup.locator("#deleteButton").click();
  await waitForStatus(popup, "Deleted local_delete_me.");
  assert.equal(await page.evaluate(() => localStorage.getItem("local_delete_me")), null);
}

async function assertSessionStorageFlow(popup, page, seed) {
  await switchDataView(popup, "sessionStorage");
  await waitForPopupReady(popup, "127.0.0.1");
  await selectItemBySearch(popup, "session_plain");
  await popup.locator("#valueInput").fill(`session-after-${seed}`);
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved session_plain.");

  const edited = await page.evaluate(() => sessionStorage.getItem("session_plain"));
  assert.equal(edited, `session-after-${seed}`);

  await selectItemBySearch(popup, "session_json");
  await runValueTool(popup, "jsonFormat");
  await expectToolOutput(popup, '"area": "session"');

  await selectItemBySearch(popup, "session_delete_me");
  popup.once("dialog", (dialog) => dialog.accept());
  await popup.locator("#deleteButton").click();
  await waitForStatus(popup, "Deleted session_delete_me.");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("session_delete_me")), null);
}

async function assertHistoryPartitioning(popup, seed) {
  await switchDataView(popup, "localStorage");
  await popup.locator("#historyViewButton").click();
  let historyText = await popup.locator("#historyList").innerText();
  assert.match(historyText, new RegExp(`local_imported_${seed}`));
  assert.doesNotMatch(historyText, /session_plain/);
  assert.doesNotMatch(historyText, new RegExp(`batch_(one|two)_${seed}`));

  await switchDataView(popup, "sessionStorage");
  await popup.locator("#historyViewButton").click();
  historyText = await popup.locator("#historyList").innerText();
  assert.match(historyText, /session_plain/);
  assert.doesNotMatch(historyText, new RegExp(`local_imported_${seed}`));

  await switchDataView(popup, "cookies");
  await popup.locator("#historyViewButton").click();
  historyText = await popup.locator("#historyList").innerText();
  assert.match(historyText, new RegExp(`batch_(one|two)_${seed}`));
  assert.doesNotMatch(historyText, /session_plain/);
  assert.doesNotMatch(historyText, new RegExp(`local_imported_${seed}`));

  await switchDataView(popup, "localStorage");
  await popup.locator("#historyViewButton").click();
  await popup.locator("#clearHistoryButton").click();
  await waitForStatus(popup, "Local Storage history cleared.");
  assert.equal(await popup.locator("#historyList li").count(), 0);

  await switchDataView(popup, "sessionStorage");
  await popup.locator("#historyViewButton").click();
  assert.match(await popup.locator("#historyList").innerText(), /session_plain/);
}

async function selectCookieBySearch(popup, query) {
  await selectItemBySearch(popup, query);
}

async function selectItemBySearch(popup, query) {
  await popup.locator("#searchInput").fill(query);
  await popup.waitForFunction((expected) => {
    return Array.from(document.querySelectorAll("#cookieTableBody tr td:nth-child(2)"))
      .some((cell) => cell.textContent === expected);
  }, query);
  await popup.locator("#cookieTableBody tr").first().click();
}

async function switchDataView(popup, view) {
  await popup.locator(`.data-switch button[data-view="${view}"]`).click();
  await popup.waitForFunction((expected) => document.body.dataset.view === expected, view);
  await popup.waitForFunction(() => document.querySelector("#loadingState")?.hidden === true);
}

async function runValueTool(popup, mode) {
  await popup.locator("#valueToolModeSelect").selectOption(mode);
  await popup.locator("#runToolButton").click();
}

async function assertColumnPreference(popup) {
  await popup.locator("th[data-column-index='0'] .column-resizer").press("ArrowRight");
  const widths = await readStorageValue(popup, "columnWidths");
  assert.ok(Array.isArray(widths));
  assert.equal(widths[0], 127);
}

async function getTableNames(popup) {
  return popup.locator("#cookieTableBody tr td:nth-child(2)").evaluateAll((cells) =>
    cells.map((cell) => cell.textContent || "")
  );
}

async function expectToolOutput(popup, expectedText) {
  await popup.waitForFunction((text) => {
    return document.querySelector("#toolOutputBody")?.textContent?.includes(text);
  }, expectedText);
}

async function waitForStatus(popup, expectedText) {
  try {
    await popup.waitForFunction((text) => {
      return document.querySelector("#statusBar")?.textContent?.includes(text);
    }, expectedText);
  } catch (error) {
    const state = await popup.evaluate(() => ({
      expectedText: "",
      status: document.querySelector("#statusBar")?.textContent || "",
      statusHidden: document.querySelector("#statusBar")?.hidden,
      view: document.body.dataset.view || "",
      selectedName: document.querySelector("#editorName")?.textContent || "",
      selectedValue: document.querySelector("#valueInput")?.value || "",
      saveDisabled: document.querySelector("#saveButton")?.disabled,
      selectionCount: document.querySelector("#selectionCount")?.textContent || "",
      batchEditDisabled: document.querySelector("#batchEditButton")?.disabled,
      batchDeleteDisabled: document.querySelector("#batchDeleteButton")?.disabled,
      selectAllChecked: document.querySelector("#selectAllCheckbox")?.checked,
      selectAllIndeterminate: document.querySelector("#selectAllCheckbox")?.indeterminate,
      rowNames: Array.from(document.querySelectorAll("#cookieTableBody tr td:nth-child(2)"))
        .map((cell) => cell.textContent || "")
    }));
    throw new Error(`Timed out waiting for status "${expectedText}". Popup state: ${JSON.stringify(state)}`);
  }
}

async function readStorageValue(popup, key) {
  return popup.evaluate((storageKey) => new Promise((resolve, reject) => {
    chrome.storage.local.get(storageKey, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result[storageKey]);
    });
  }), key);
}

async function waitForCookie(context, baseUrl, name) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const cookies = await context.cookies(baseUrl);
    if (cookies.some((cookie) => cookie.name === name)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for cookie ${name}`);
}

async function screenshot(page, name) {
  const screenshotPath = path.join(artifactDir, name);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`popup screenshot: ${screenshotPath}`);
}
