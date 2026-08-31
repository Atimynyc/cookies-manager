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
const favoritesOnly = process.argv.includes("--favorites-only");
const v030Only = process.argv.includes("--v030-only");
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
  if (favoritesOnly) {
    await assertFavoriteFlow(popup);
    await assertDetailFavoriteControl(popup);
  } else if (v030Only) {
    await assertV030WorkbenchFlow(popup, context, testPage, baseUrl, extensionId);
  } else {
    await assertUnselectedWorkspaceFillsContent(popup);
    await assertFavoriteFlow(popup);
    await assertDetailFavoriteControl(popup);
    await assertWorkspaceNavigation(popup);
    await assertTableActionsBelowList(popup);
    await assertEditorActions(popup);
    await assertValueTools(popup);
    await assertStressLayout(popup);
    await assertExportFlow(popup);
    await assertV030WorkbenchFlow(popup, context, testPage, baseUrl, extensionId);
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
    await assertExpirationEditFlow(popup, context, baseUrl);
    await assertImportFlow(popup, context, baseUrl);
    await popup.locator("#historyViewButton").click();
    await screenshot(popup, "milestone-4-popup-history.png");
    await assertDeleteFlow(popup, context, baseUrl);

    await popup.locator("#searchInput").fill("");
    await popup.waitForFunction(() => document.querySelectorAll("#cookieTableBody tr").length >= 7);
    await screenshot(popup, "milestone-4-popup-final.png");
    await assertHistoryPersistsWithSessionSnapshots(popup, context, baseUrl, runId);
    await assertSingleHistoryDetailLayout(popup, runId);
  }
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

  try {
    const [popup] = await Promise.all([
      context.waitForEvent("page", { timeout: 10000 }),
      worker.evaluate(() => chrome.action.openPopup())
    ]);
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

async function assertFavoriteFlow(popup) {
  const cases = [
    ["cookies", "plain"],
    ["localStorage", "local_plain"],
    ["sessionStorage", "session_plain"]
  ];

  for (const [view, name] of cases) {
    if (view !== "cookies") {
      await switchDataView(popup, view);
    }
    await popup.locator("#searchInput").fill(name);
    const firstRow = popup.locator("#cookieTableBody tr").first();
    assert.equal(await firstRow.locator(".favorite-indicator").count(), 0);
    assert.equal(await firstRow.locator(".favorite-button").count(), 0);
    await firstRow.click();
    assert.equal(await popup.locator("#editorFavoriteButton").getAttribute("aria-pressed"), "false");
    await popup.locator("#editorFavoriteButton").click();
    assert.equal(await popup.locator("#editorFavoriteButton").getAttribute("aria-pressed"), "true");
    assert.equal(await popup.locator("#cookieTableBody tr").first()
      .locator(".favorite-indicator").count(), 1);
    await popup.locator("#searchInput").fill("");
    assert.equal((await getTableNames(popup))[0], name);
  }

  await popup.reload({ waitUntil: "domcontentloaded" });
  await waitForPopupReady(popup, "127.0.0.1");
  assert.equal(await popup.evaluate(() => document.body.dataset.view), "sessionStorage");
  assert.equal(await popup.locator("#editorName").innerText(), "session_plain");

  await switchDataView(popup, "localStorage");
  assert.equal(await popup.locator("#editorName").innerText(), "local_plain");
  await switchDataView(popup, "cookies");
  assert.equal(await popup.locator("#editorName").innerText(), "plain");
  assert.equal((await getTableNames(popup))[0], "plain");
  assert.equal(await popup.locator("#cookieTableBody tr").first()
    .locator(".favorite-indicator").count(), 1);

  await switchDataView(popup, "localStorage");
  assert.equal((await getTableNames(popup))[0], "local_plain");
  assert.equal(await popup.locator("#editorName").innerText(), "local_plain");
  await switchDataView(popup, "sessionStorage");
  assert.equal((await getTableNames(popup))[0], "session_plain");
  assert.equal(await popup.locator("#editorName").innerText(), "session_plain");
  await switchDataView(popup, "cookies");
  await popup.locator(".table-wrap").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await screenshot(popup, "milestone-4-popup-favorites.png");
}

async function assertDetailFavoriteControl(popup) {
  await selectCookieBySearch(popup, "plain");
  await popup.locator(".table-wrap").evaluate((element) => {
    element.scrollLeft = 0;
  });
  assert.equal(await popup.locator("#editorFavoriteButton").getAttribute("aria-pressed"), "true");
  const layout = await popup.evaluate(() => {
    const header = document.querySelector(".editor-header").getBoundingClientRect();
    const title = document.querySelector(".editor-title-block").getBoundingClientRect();
    const button = document.querySelector("#editorFavoriteButton").getBoundingClientRect();
    const table = document.querySelector(".table-wrap");
    const selectWidth = document.querySelector(".select-column").getBoundingClientRect().width;
    const nameWidth = document.querySelector("th:nth-child(2)").getBoundingClientRect().width;
    const valueWidth = document.querySelector("th:nth-child(3)").getBoundingClientRect().width;
    const domain = document.querySelector("th:nth-child(4)").getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const thirdFieldVisibleWidth = Math.max(0, tableRect.right - domain.left);
    return {
      detailFavoriteAtTopRight: button.right <= header.right + 1 && title.right <= button.left,
      primaryColumnsUseViewport: selectWidth + nameWidth + valueWidth >= table.clientWidth,
      thirdFieldVisibleWidth
    };
  });
  assert.equal(layout.detailFavoriteAtTopRight, true, JSON.stringify(layout));
  assert.equal(layout.primaryColumnsUseViewport, true, JSON.stringify(layout));
  assert.ok(layout.thirdFieldVisibleWidth <= 2, JSON.stringify(layout));

  await popup.locator("#editorFavoriteButton").click();
  assert.equal(await popup.locator("#editorFavoriteButton").getAttribute("aria-pressed"), "false");
  assert.equal(await popup.locator("#cookieTableBody tr").first()
    .locator(".favorite-indicator").count(), 0);
  await popup.locator("#editorFavoriteButton").click();
  assert.equal(await popup.locator("#editorFavoriteButton").getAttribute("aria-pressed"), "true");
  await popup.locator("#searchInput").fill("");
  await popup.locator(".table-wrap").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await screenshot(popup, "milestone-4-popup-favorites.png");
}

async function assertUnselectedWorkspaceFillsContent(popup) {
  const layout = await popup.evaluate(() => {
    const app = document.querySelector(".app-shell");
    const content = document.querySelector(".content");
    const tablePane = document.querySelector(".table-pane");
    const detailPane = document.querySelector(".detail-pane");
    const appRect = app.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const contentStyle = getComputedStyle(content);
    const contentBottom = contentRect.bottom - Number.parseFloat(contentStyle.paddingBottom);

    return {
      contentBottomGap: appRect.bottom - contentRect.bottom,
      detailBottomGap: contentBottom - detailPane.getBoundingClientRect().bottom,
      editorHidden: document.querySelector("#cookieEditor").hidden,
      placeholderHidden: document.querySelector("#detailPlaceholder").hidden,
      tableBottomGap: contentBottom - tablePane.getBoundingClientRect().bottom
    };
  });

  assert.equal(layout.editorHidden, true, JSON.stringify(layout));
  assert.equal(layout.placeholderHidden, false, JSON.stringify(layout));
  assert.ok(Math.abs(layout.contentBottomGap) <= 1, JSON.stringify(layout));
  assert.ok(Math.abs(layout.tableBottomGap) <= 1, JSON.stringify(layout));
  assert.ok(Math.abs(layout.detailBottomGap) <= 1, JSON.stringify(layout));
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
      historyButton: "#historyViewButton"
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
        rects.historyButton.right <= rects.app.right + 1 &&
        rects.historyButton.left >= rects.app.left,
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

async function assertWorkspaceNavigation(popup) {
  assert.equal(await popup.locator("#detailsViewButton").count(), 0);
  assert.equal(await popup.locator(".side-card-nav").count(), 0);
  assert.equal(await popup.locator(".site-switch > span").count(), 0);

  const layout = await popup.evaluate(() => {
    const search = document.querySelector(".search-field").getBoundingClientRect();
    const history = document.querySelector("#historyViewButton").getBoundingClientRect();
    const refresh = document.querySelector("#refreshControl").getBoundingClientRect();
    const siteSelect = document.querySelector("#siteSelect");
    const siteSelectRect = siteSelect.getBoundingClientRect();
    const dataSwitchRect = document.querySelector(".data-switch").getBoundingClientRect();
    const siteSelectStyle = getComputedStyle(siteSelect);
    const detailPane = document.querySelector(".detail-pane").getBoundingClientRect();
    const detailContent = document.querySelector(".detail-content").getBoundingClientRect();
    return {
      historyBesideSearch: search.right <= history.left + 1 && Math.abs(search.top - history.top) <= 1,
      refreshAboveSearch: refresh.bottom <= search.top,
      siteAlignedWithControls:
        Math.abs(siteSelectRect.top - dataSwitchRect.top) <= 1 &&
        Math.abs(siteSelectRect.bottom - dataSwitchRect.bottom) <= 1,
      siteTextClearsArrow:
        siteSelectStyle.appearance === "none" &&
        Number.parseFloat(siteSelectStyle.paddingRight) >= 32 &&
        siteSelectStyle.textOverflow === "ellipsis",
      detailUsesFullPane: detailContent.left - detailPane.left <= 2
    };
  });
  assert.equal(layout.historyBesideSearch, true, JSON.stringify(layout));
  assert.equal(layout.refreshAboveSearch, true, JSON.stringify(layout));
  assert.equal(layout.siteAlignedWithControls, true, JSON.stringify(layout));
  assert.equal(layout.siteTextClearsArrow, true, JSON.stringify(layout));
  assert.equal(layout.detailUsesFullPane, true, JSON.stringify(layout));

  await popup.locator("#refreshMenuButton").click();
  assert.equal(await popup.locator("#refreshMenu").isHidden(), false);
  assert.equal(await popup.locator("#refreshMenuButton").getAttribute("aria-expanded"), "true");
  await popup.locator("#autoRefreshToggle").check();
  await popup.waitForFunction(() => document.querySelector("#refreshControl")?.classList.contains("is-auto"));
  await popup.locator("#autoRefreshToggle").uncheck();
  await popup.waitForFunction(() => !document.querySelector("#refreshControl")?.classList.contains("is-auto"));
  await popup.locator("#hostLabel").click();
  assert.equal(await popup.locator("#refreshMenu").isHidden(), true);

  await popup.locator("#historyViewButton").click();
  assert.equal(await popup.locator("#historyPanel").isHidden(), false);
  assert.equal(await popup.locator("#detailsView").isHidden(), true);
  assert.equal(await popup.locator("#historyViewButton").getAttribute("aria-pressed"), "true");
  await popup.locator("#historyViewButton").click();
  assert.equal(await popup.locator("#historyPanel").isHidden(), true);
  assert.equal(await popup.locator("#detailsView").isHidden(), false);
}

async function assertEditorActions(popup) {
  await selectCookieBySearch(popup, "plain");
  const actions = await popup.evaluate(() => {
    const valueInput = document.querySelector("#valueInput");
    return ["copyValueButton", "resetButton", "deleteButton", "saveButton"].map((id) => {
      const button = document.querySelector(`#${id}`);
      const defaultText = Array.from(button.childNodes)
        .filter((node) => !(node instanceof Element && node.matches(".copy-success-feedback")))
        .map((node) => node.textContent || "")
        .join("")
        .trim();
      return {
        beforeValue: Boolean(button.compareDocumentPosition(valueInput) & Node.DOCUMENT_POSITION_FOLLOWING),
        hasIcon: Boolean(button.querySelector("svg.icon")),
        label: button.getAttribute("aria-label"),
        text: defaultText,
        tooltip: button.dataset.tooltip
      };
    });
  });

  assert.deepEqual(actions, [
    { beforeValue: true, hasIcon: true, label: "Copy value", text: "", tooltip: "Copy value" },
    { beforeValue: true, hasIcon: true, label: "Reset", text: "", tooltip: "Reset" },
    { beforeValue: true, hasIcon: true, label: "Delete", text: "", tooltip: "Delete" },
    { beforeValue: true, hasIcon: true, label: "Save", text: "", tooltip: "Save" }
  ]);
  assert.equal(
    await popup.locator(".editor-actions > button").evaluateAll((buttons) => buttons.map((button) => button.id).join(",")),
    "copyValueButton,resetButton,deleteButton,saveButton"
  );
  assert.equal(await popup.locator(".copy-row > button").count(), 2);

  await popup.locator("#copyValueButton").hover();
  await popup.waitForFunction(() => {
    const button = document.querySelector("#copyValueButton");
    return getComputedStyle(button, "::after").opacity === "1";
  });
  const tooltipContent = await popup.locator("#copyValueButton").evaluate((button) => {
    return getComputedStyle(button, "::after").content;
  });
  assert.equal(tooltipContent, '"Copy value"');

  const contentBeforeCopy = await popup.locator(".content").evaluate((content) => {
    const rect = content.getBoundingClientRect();
    return { bottom: rect.bottom, top: rect.top };
  });
  await popup.locator("#copyValueButton").click();
  await popup.waitForFunction(() => document.querySelector("#copyValueButton")?.classList.contains("is-copied"));
  const copiedState = await popup.evaluate(() => {
    const button = document.querySelector("#copyValueButton");
    const contentRect = document.querySelector(".content").getBoundingClientRect();
    return {
      ariaLabel: button.getAttribute("aria-label"),
      contentBottom: contentRect.bottom,
      contentTop: contentRect.top,
      statusHidden: document.querySelector("#statusBar").hidden,
      tooltip: button.dataset.tooltip,
      tooltipContent: getComputedStyle(button, "::after").content
    };
  });
  assert.equal(copiedState.ariaLabel, "Copied");
  assert.equal(copiedState.tooltip, "Copied");
  assert.equal(copiedState.tooltipContent, '"Copied"');
  assert.equal(copiedState.statusHidden, true);
  assert.equal(copiedState.contentTop, contentBeforeCopy.top);
  assert.equal(copiedState.contentBottom, contentBeforeCopy.bottom);
  await popup.locator("#copyValueButton").click();
  await popup.waitForFunction(() => document.querySelector("#copyValueButton")?.getAttribute("aria-label") === "Copied");
  await screenshot(popup, "milestone-4-popup-copy-feedback.png");

  await popup.waitForFunction(() => !document.querySelector("#copyValueButton")?.classList.contains("is-copied"));
  assert.equal(await popup.locator("#copyValueButton").getAttribute("aria-label"), "Copy value");
  assert.equal(await popup.locator("#copyValueButton").getAttribute("data-tooltip"), "Copy value");

  await popup.locator("#copyPairButton").click();
  await popup.waitForFunction(() => document.querySelector("#copyPairButton")?.classList.contains("is-copied"));
  assert.equal((await popup.locator("#copyPairButton .copy-success-feedback").textContent()).trim(), "Copied");

  await popup.evaluate(() => {
    window.__copyFeedbackWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async () => {
      throw new Error("Clipboard denied.");
    };
  });
  await popup.locator("#copyJsonButton").click();
  await waitForStatus(popup, "Clipboard denied.");
  assert.equal(await popup.locator("#copyJsonButton").evaluate((button) => button.classList.contains("is-copied")), false);
  assert.equal(await popup.locator("#closeStatusButton").isHidden(), false);
  await popup.evaluate(() => {
    navigator.clipboard.writeText = window.__copyFeedbackWriteText;
    delete window.__copyFeedbackWriteText;
  });
  await popup.locator("#closeStatusButton").click();
  await popup.waitForFunction(() => document.querySelector("#statusBar")?.hidden === true);
  assert.equal(await popup.locator("#statusBar").isHidden(), true);
  await screenshot(popup, "milestone-4-popup-editor-actions.png");
}

async function assertTableActionsBelowList(popup) {
  const result = await popup.evaluate(() => {
    const tableWrapElement = document.querySelector(".table-wrap");
    const toolbarElement = document.querySelector(".table-toolbar");
    const emptyStateElement = document.querySelector("#emptyState");
    const wasHidden = emptyStateElement.hidden;
    emptyStateElement.hidden = false;

    const tableWrap = tableWrapElement.getBoundingClientRect();
    const toolbar = toolbarElement.getBoundingClientRect();
    const emptyState = emptyStateElement.getBoundingClientRect();
    emptyStateElement.hidden = wasHidden;

    return {
      actions: ["batchEditButton", "batchDeleteButton", "exportButton", "importButton", "profilesButton"].map((id) => {
        const button = document.querySelector(`#${id}`);
        return {
          hasIcon: Boolean(button.querySelector("svg.icon")),
          label: button.getAttribute("aria-label"),
          text: button.textContent.trim(),
          tooltip: button.dataset.tooltip
        };
      }),
      layout: {
        emptyState: { bottom: emptyState.bottom, top: emptyState.top },
        tableWrap: { bottom: tableWrap.bottom, top: tableWrap.top },
        toolbar: { bottom: toolbar.bottom, top: toolbar.top }
      }
    };
  });

  assert.deepEqual(result.actions, [
    { hasIcon: true, label: "Set value", text: "", tooltip: "Set value" },
    { hasIcon: true, label: "Delete selected", text: "", tooltip: "Delete selected" },
    { hasIcon: true, label: "Export", text: "", tooltip: "Export" },
    { hasIcon: true, label: "Import", text: "", tooltip: "Import" },
    { hasIcon: true, label: "Profiles", text: "", tooltip: "Profiles" }
  ]);
  assert.ok(result.layout.toolbar.top >= result.layout.tableWrap.bottom - 1, JSON.stringify(result.layout));
  assert.ok(result.layout.emptyState.top >= result.layout.tableWrap.top + 33, JSON.stringify(result.layout));
  assert.ok(result.layout.emptyState.bottom <= result.layout.tableWrap.bottom + 1, JSON.stringify(result.layout));

  for (const [id, label] of [
    ["batchEditButton", "Set value"],
    ["batchDeleteButton", "Delete selected"],
    ["exportButton", "Export"],
    ["importButton", "Import"],
    ["profilesButton", "Profiles"]
  ]) {
    await popup.locator(`#${id}`).hover();
    await popup.waitForFunction((buttonId) => {
      const button = document.querySelector(`#${buttonId}`);
      return getComputedStyle(button, "::after").opacity === "1";
    }, id);
    const tooltipContent = await popup.locator(`#${id}`).evaluate((button) => {
      return getComputedStyle(button, "::after").content;
    });
    assert.equal(tooltipContent, `"${label}"`);
  }
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
  await popup.locator("#workbenchDialog").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#workbenchTitle").innerText(), "Export");
  await popup.waitForFunction(() => document.querySelector("#packageExportPreview")?.value.includes('"schemaVersion"'));
  const exportPreview = await popup.locator("#packageExportPreview").inputValue();
  assert.match(exportPreview, /"url"/);
  assert.match(exportPreview, /"host"/);
  assert.match(exportPreview, /"type"/);
  assert.match(exportPreview, /"count"/);

  await popup.locator('input[name="exportScope"][value="selected"]').check();
  await popup.locator("#exportSelectionPanel").waitFor({ state: "visible" });
  await popup.locator("#exportSelectionBody").waitFor({ state: "hidden" });
  await popup.locator("#exportSelectionToggleButton").click();
  await popup.locator("#exportSelectionBody").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#selectedExportScope").isDisabled(), false);
  const exportSelectionItems = popup.locator("#exportSelectionList .export-selection-item");
  assert.ok(await exportSelectionItems.count() > 0, "Expected export selection items.");
  await popup.locator("#exportSelectAllCheckbox").check();
  await popup.locator("#exportSelectAllCheckbox").uncheck();
  await popup.locator("#exportSelectionList input[type=checkbox]").first().check();
  await popup.waitForFunction(() => /"count": 1/.test(document.querySelector("#packageExportPreview")?.value || ""));
  await popup.locator("#copyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageExportFeedback")?.textContent?.includes("Copied"));
  const selectedExport = JSON.parse(await popup.evaluate(() => window.__lastClipboardWrite));
  assert.equal(selectedExport.count, 1);

  await popup.locator('input[name="exportScope"][value="current"]').check();
  await popup.waitForFunction(() => document.querySelector("#packageExportPreview")?.value.includes('"schemaVersion"'));
  await popup.locator("#copyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageExportFeedback")?.textContent?.includes("Copied"));
  const exportedText = await popup.evaluate(() => window.__lastClipboardWrite);
  const exported = JSON.parse(exportedText);
  assert.ok(exported.data.cookies.some((cookie) => cookie.name === "plain"));
  assert.equal(exported.url, exported.source.url);
  assert.equal(exported.host, new URL(exported.url).host);
  assert.equal(exported.type, "cookies");
  assert.ok(exported.count >= 7);
  await screenshot(popup, "milestone-4-popup-toast.png");
  await popup.locator('input[name="exportScope"][value="selected"]').check();
  await popup.locator("#exportSelectionToggleButton").click();
  await popup.locator("#exportSelectionList input[type=checkbox]").first().uncheck();
  await popup.locator("#workbenchCloseButton").click();
}

async function assertV030WorkbenchFlow(popup, context, page, baseUrl, extensionId) {
  const cookieName = `v030_cookie_${runId}`;
  const netscapeCookieName = `v030_netscape_${runId}`;
  const localKey = `v030_local_${runId}`;
  const sessionKey = `v030_session_${runId}`;
  const bulkKeys = Array.from({ length: 100 }, (_, index) => `v030_bulk_${index}_${runId}`);

  await popup.evaluate(() => {
    window.__lastClipboardWrite = "";
    if (!window.__v030ClipboardCaptureInstalled) {
      const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        window.__lastClipboardWrite = text;
        return writeText(text);
      };
      window.__v030ClipboardCaptureInstalled = true;
    }
  });

  await popup.locator("#exportButton").click();
  await popup.locator("#workbenchDialog").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#workbenchTitle").innerText(), "Export");
  const workbenchHeadingLayout = await popup.locator(".workbench-header > div").evaluate((heading) => {
    const titleRect = heading.querySelector("#workbenchTitle").getBoundingClientRect();
    const targetRect = heading.querySelector("#workbenchTarget").getBoundingClientRect();
    return {
      titleTop: titleRect.top,
      titleBottom: titleRect.bottom,
      targetTop: targetRect.top,
      targetBottom: targetRect.bottom
    };
  });
  assert.ok(
    workbenchHeadingLayout.targetTop < workbenchHeadingLayout.titleBottom
      && workbenchHeadingLayout.targetBottom > workbenchHeadingLayout.titleTop,
    JSON.stringify(workbenchHeadingLayout)
  );
  const exportSpacing = await popup.locator("#packageExportView").evaluate((view) => {
    const titleRect = document.querySelector("#workbenchTitle").getBoundingClientRect();
    const format = view.querySelector("#packageExportFormatSwitch");
    const formatLegendRect = format.querySelector("legend").getBoundingClientRect();
    const formatRect = format.getBoundingClientRect();
    const scopeLegendRect = view.querySelector(".option-group legend").getBoundingClientRect();
    return {
      titleToFormat: formatLegendRect.top - titleRect.bottom,
      formatToScope: scopeLegendRect.top - formatRect.bottom
    };
  });
  assert.ok(
    Math.abs(exportSpacing.titleToFormat - exportSpacing.formatToScope) <= 6,
    JSON.stringify(exportSpacing)
  );
  const exportOptionLayout = await popup.locator("#packageExportView").evaluate((view) => {
    const formatGroup = view.querySelector("#packageExportFormatSwitch");
    const scopeGroup = view.querySelector(".option-group");
    const formatLabels = Array.from(formatGroup.querySelectorAll(":scope > label:not([hidden])"));
    const scopeLabels = Array.from(scopeGroup.querySelectorAll(":scope > label"));
    const formatRects = formatLabels.map((label) => label.getBoundingClientRect());
    const scopeRects = scopeLabels.map((label) => label.getBoundingClientRect());
    return {
      formatWidth: formatGroup.getBoundingClientRect().width,
      scopeWidth: scopeGroup.getBoundingClientRect().width,
      formatHeight: formatRects[0].height,
      scopeHeight: scopeRects[0].height,
      formatGap: formatRects[1].left - formatRects[0].right,
      scopeGap: scopeRects[1].left - scopeRects[0].right,
      formatRadii: formatLabels.map((label) => getComputedStyle(label).borderRadius),
      scopeRadii: scopeLabels.map((label) => getComputedStyle(label).borderRadius)
    };
  });
  assert.ok(Math.abs(exportOptionLayout.formatWidth - exportOptionLayout.scopeWidth) <= 1, JSON.stringify(exportOptionLayout));
  assert.ok(Math.abs(exportOptionLayout.formatHeight - exportOptionLayout.scopeHeight) <= 1, JSON.stringify(exportOptionLayout));
  assert.ok(Math.abs(exportOptionLayout.formatGap - exportOptionLayout.scopeGap) <= 1, JSON.stringify(exportOptionLayout));
  assert.deepEqual(exportOptionLayout.formatRadii, ["6px", "6px"]);
  assert.deepEqual(exportOptionLayout.scopeRadii, ["6px", "6px", "6px"]);
  const exportPreviewFill = await popup.locator("#packageExportView").evaluate((view) => {
    const viewRect = view.getBoundingClientRect();
    const previewRect = view.querySelector("#packageExportPreview").getBoundingClientRect();
    return {
      bottomGap: viewRect.bottom - previewRect.bottom,
      bottomPadding: Number.parseFloat(getComputedStyle(view).paddingBottom),
      previewHeight: previewRect.height
    };
  });
  assert.ok(
    Math.abs(exportPreviewFill.bottomGap - exportPreviewFill.bottomPadding) <= 2,
    JSON.stringify(exportPreviewFill)
  );
  assert.ok(exportPreviewFill.previewHeight > 160, JSON.stringify(exportPreviewFill));
  assert.equal(await popup.locator("#currentExportScopeLabel").innerText(), "Current view(Cookies)");
  await popup.locator('input[name="exportScope"][value="all"]').check();
  await popup.locator("#copyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageExportFeedback")?.textContent?.includes("Copied"));
  const packageText = await popup.evaluate(() => window.__lastClipboardWrite);
  const dataPackage = JSON.parse(packageText);
  const cookieTemplate = dataPackage.data.cookies.find((cookie) => cookie.name === "plain");
  assert.ok(cookieTemplate, "Expected the v0.3 export package to contain the plain cookie.");
  dataPackage.data.cookies.push({
    ...cookieTemplate,
    name: cookieName,
    value: "batch-cookie-value",
    session: true,
    expirationDate: undefined
  });
  dataPackage.data.localStorage.push({
    key: localKey,
    value: "batch-local-value",
    origin: dataPackage.source.origin
  });
  dataPackage.data.localStorage.push(...bulkKeys.map((key, index) => ({
    key,
    value: `bulk-value-${index}`,
    origin: dataPackage.source.origin
  })));
  dataPackage.data.sessionStorage.push({
    key: sessionKey,
    value: "batch-session-value",
    origin: dataPackage.source.origin
  });

  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#importButton").click();
  await popup.locator('input[name="packageImportFormat"][value="json"]').check();
  await popup.locator("#packageTextInput").fill(JSON.stringify(dataPackage));
  await popup.locator("#previewPackageButton").click();
  await popup.locator("#packagePreview").waitFor({ state: "visible" });
  assert.equal(await popup.locator(".preview-item .is-status-new").count(), 103);
  assert.equal(await popup.locator("#packageSelectionCount").innerText(), "103 selected");
  await assertWorkbenchLayout(popup);
  await screenshot(popup, "v030-package-preview.png");

  await popup.locator("#applyPackageButton").click();
  await popup.waitForFunction(() => Number(document.querySelector("#packageProgress")?.max) >= 100);
  await popup.waitForFunction(() => document.querySelector("#packageResultTitle")?.textContent === "Import complete");
  assert.match(await popup.locator("#packageResultSummary").innerText(), /103 succeeded/);
  assert.equal((await context.cookies(baseUrl)).some((cookie) => cookie.name === cookieName), true);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), localKey), "batch-local-value");
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey), "batch-session-value");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), bulkKeys.at(-1)), "bulk-value-99");
  await screenshot(popup, "v030-package-result.png");

  await popup.locator("#undoPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageResultTitle")?.textContent === "Import undone");
  assert.equal((await context.cookies(baseUrl)).some((cookie) => cookie.name === cookieName), false);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), localKey), null);
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey), null);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), bulkKeys.at(-1)), null);
  await popup.locator("#importAnotherButton").click();

  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#exportButton").click();
  await popup.locator('input[name="packageExportFormat"][value="netscape"]').check();
  await popup.waitForFunction(() => document.querySelector("#packageExportPreview")?.value.startsWith("# Netscape HTTP Cookie File"));
  assert.equal(await popup.locator("#allExportScopeLabel").innerText(), "All cookies");
  assert.equal(await popup.locator("#copyPackageButton").getAttribute("aria-label"), "Copy Netscape");
  assert.equal(await popup.locator("#copyPackageButton").getAttribute("data-tooltip"), "Copy Netscape");
  assert.equal(await popup.locator("#savePackageButton").getAttribute("aria-label"), "Save cookies.txt");
  await popup.locator("#copyPackageButton").hover();
  await popup.waitForFunction(() => getComputedStyle(document.querySelector("#copyPackageButton"), "::after").opacity === "1");
  assert.equal(
    await popup.locator("#copyPackageButton").evaluate((button) => getComputedStyle(button, "::after").content),
    '"Copy Netscape"'
  );
  assert.match(await popup.locator("#packageExportSummary").innerText(), /SameSite.*Partitioned\/CHIPS.*Cookie store/);
  await popup.locator("#copyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageExportFeedback")?.textContent?.includes("Copied"));
  const netscapeExport = await popup.evaluate(() => window.__lastClipboardWrite);
  assert.match(netscapeExport, /^# Netscape HTTP Cookie File/);
  assert.match(netscapeExport, /\tplain\t/);
  assert.doesNotMatch(netscapeExport, new RegExp(localKey));
  await screenshot(popup, "v030-netscape-export.png");

  const netscapeDownloadPromise = popup.waitForEvent("download");
  await popup.locator("#savePackageButton").click();
  const netscapeDownload = await netscapeDownloadPromise;
  assert.match(netscapeDownload.suggestedFilename(), /-cookies-\d{4}-\d{2}-\d{2}\.txt$/);
  assert.match(await readFile(await netscapeDownload.path(), "utf8"), /^# Netscape HTTP Cookie File/);

  const targetHost = new URL(baseUrl).hostname;
  const netscapeImport = [
    "# Netscape HTTP Cookie File",
    `${targetHost}\tFALSE\t/\tFALSE\t0\t${netscapeCookieName}\tnetscape-value`,
    ""
  ].join("\n");
  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#importButton").click();
  await popup.locator("#packageFileDropzone").evaluate((dropzone, content) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], "cookies.txt", { type: "text/plain" }));
    dropzone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
  }, netscapeImport);
  assert.equal(
    await popup.locator("#packageFileDropzone").evaluate((dropzone) => dropzone.classList.contains("is-dragging")),
    true
  );
  await popup.locator("#packageFileDropzone").evaluate((dropzone, content) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], "cookies.txt", { type: "text/plain" }));
    dropzone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  }, netscapeImport);
  await popup.waitForFunction(() => document.querySelector("#packageFileName")?.textContent === "cookies.txt");
  assert.equal(
    await popup.locator("#packageFileDropzone").evaluate((dropzone) => dropzone.classList.contains("is-dragging")),
    false
  );
  await popup.waitForFunction(() => document.querySelector(
    'input[name="packageImportFormat"][value="netscape"]'
  )?.checked);
  assert.equal(await popup.locator('input[name="packageImportFormat"][value="netscape"]').isChecked(), true);
  assert.equal(await popup.locator("#packageInputLabel").innerText(), "Netscape cookie jar");
  assert.match(await popup.locator("#packageImportFormatNote").innerText(), /Cookies only/);
  const netscapeSourceLayout = await popup.locator("#packageImportView").evaluate((view) => {
    const viewRect = view.getBoundingClientRect();
    const actionsRect = document.querySelector("#previewPackageButton").getBoundingClientRect();
    return {
      viewBottom: viewRect.bottom,
      actionsBottom: actionsRect.bottom,
      clientWidth: view.clientWidth,
      scrollWidth: view.scrollWidth
    };
  });
  assert.ok(netscapeSourceLayout.actionsBottom <= netscapeSourceLayout.viewBottom, JSON.stringify(netscapeSourceLayout));
  assert.ok(netscapeSourceLayout.scrollWidth <= netscapeSourceLayout.clientWidth + 1, JSON.stringify(netscapeSourceLayout));
  await screenshot(popup, "v030-netscape-import.png");
  await popup.locator("#previewPackageButton").click();
  await popup.locator("#packagePreview").waitFor({ state: "visible" });
  assert.equal(await popup.locator(".preview-item .is-status-new").count(), 1);
  assert.equal(await popup.locator("#packageSelectionCount").innerText(), "1 selected");
  assert.equal(await popup.locator("#packageMappingControl").isHidden(), true);
  await screenshot(popup, "v030-netscape-preview.png");
  await popup.locator("#applyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageResultTitle")?.textContent === "Import complete");
  assert.equal((await context.cookies(baseUrl)).find((cookie) => cookie.name === netscapeCookieName)?.value, "netscape-value");
  await popup.locator("#undoPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageResultTitle")?.textContent === "Import undone");
  assert.equal((await context.cookies(baseUrl)).some((cookie) => cookie.name === netscapeCookieName), false);

  const originalPlainValue = (await context.cookies(baseUrl)).find((cookie) => cookie.name === "plain")?.value;
  assert.ok(originalPlainValue);
  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#profilesButton").click();
  assert.equal(await popup.locator("#workbenchTitle").innerText(), "Profiles");
  await assertProfileHelp(popup, "v030-profile-help.png");
  await popup.locator("#newProfileButton").click();
  await assertProfileCreateLayout(popup);
  await screenshot(popup, "v030-profile-create-empty.png");
  await popup.locator("#profileNameInput").fill(`v030 profile ${runId}`);
  await popup.locator("#profileTagsInput").fill("uat, account");
  await popup.locator("#profileDescriptionInput").fill("Acceptance profile");
  await popup.locator("#profileScopeSelect").selectOption("all");
  await popup.locator("#profileVariablesInput").fill(`!profileValue=${originalPlainValue}`);
  await popup.locator("#profileForm button[type='submit']").click();
  await popup.waitForFunction((name) => Array.from(document.querySelectorAll(".profile-item strong"))
    .some((element) => element.textContent === name), `v030 profile ${runId}`);

  const storedProfile = await popup.evaluate(async () => {
    const result = await chrome.storage.local.get({ siteDataProfiles: [] });
    return result.siteDataProfiles[0];
  });
  assert.equal(storedProfile.variables[0].promptOnApply, true);
  assert.equal(Object.hasOwn(storedProfile.variables[0], "defaultValue"), false);
  assert.equal(
    storedProfile.dataPackage.data.cookies.find((cookie) => cookie.name === "plain")?.value,
    "${profileValue}"
  );
  assert.equal(JSON.stringify(storedProfile).includes(originalPlainValue), false);
  await screenshot(popup, "v030-profile-list.png");

  let profileItem = popup.locator(".profile-item", { hasText: `v030 profile ${runId}` });
  await profileItem.getByRole("button", { name: "Rename" }).click();
  await popup.locator("#textInputDialogInput").fill(`v030 renamed ${runId}`);
  await popup.locator("#textInputDialogSubmitButton").click();
  await popup.waitForFunction((name) => Array.from(document.querySelectorAll(".profile-item strong"))
    .some((element) => element.textContent === name), `v030 renamed ${runId}`);

  profileItem = popup.locator(".profile-item", { hasText: `v030 renamed ${runId}` });
  await profileItem.getByRole("button", { name: "Copy", exact: true }).click();
  await popup.waitForFunction(() => document.querySelectorAll(".profile-item").length === 2);
  const copiedProfile = popup.locator(".profile-item", { hasText: `v030 renamed ${runId} copy` });
  await copiedProfile.getByRole("button", { name: "Delete" }).click();
  await popup.locator("#confirmDialogDeleteButton").click();
  await popup.waitForFunction(() => document.querySelectorAll(".profile-item").length === 1);

  profileItem = popup.locator(".profile-item", { hasText: `v030 renamed ${runId}` });
  const downloadPromise = popup.waitForEvent("download");
  await profileItem.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /v030-renamed/);

  await context.addCookies([{ url: baseUrl, name: "plain", value: "profile-target-value" }]);
  await profileItem.getByRole("button", { name: "Apply" }).click();
  await popup.locator('#profileVariableInputs input[name="profileValue"]').fill(originalPlainValue);
  await popup.locator("#previewProfileButton").click();
  await popup.locator("#packagePreview").waitFor({ state: "visible" });
  const plainPreview = popup.locator(".preview-item", { hasText: "plain" });
  assert.equal(
    await plainPreview.locator(".is-status-modified, .is-status-conflict").count(),
    1
  );
  await popup.locator("#applyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageResultTitle")?.textContent === "Import complete");
  assert.equal((await context.cookies(baseUrl)).find((cookie) => cookie.name === "plain")?.value, originalPlainValue);

  await popup.locator("#undoPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageResultTitle")?.textContent === "Import undone");
  assert.equal((await context.cookies(baseUrl)).find((cookie) => cookie.name === "plain")?.value, "profile-target-value");

  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#profilesButton").click();
  profileItem = popup.locator(".profile-item", { hasText: `v030 renamed ${runId}` });
  await profileItem.getByRole("button", { name: "Delete" }).click();
  await popup.locator("#confirmDialogDeleteButton").click();
  await popup.waitForFunction(() => document.querySelectorAll(".profile-item").length === 0);
  await popup.locator("#workbenchCloseButton").click();

  await context.addCookies([{ url: baseUrl, name: "plain", value: originalPlainValue }]);
  await popup.waitForTimeout(250);
  await popup.locator("#refreshButton").click();
  await waitForPopupReady(popup, "127.0.0.1");
  await assertSidePanelWorkbench(context, page, extensionId);
}

async function assertWorkbenchLayout(popup) {
  const layout = await popup.locator("#workbenchDialog").evaluate((dialog) => {
    const dialogRect = dialog.getBoundingClientRect();
    const listRect = document.querySelector("#packagePreviewList").getBoundingClientRect();
    const footerRect = document.querySelector("#applyPackageButton").getBoundingClientRect();
    return {
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
      dialogTop: dialogRect.top,
      dialogBottom: dialogRect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      listBottom: listRect.bottom,
      footerTop: footerRect.top,
      footerBottom: footerRect.bottom
    };
  });
  assert.ok(layout.dialogLeft >= 0 && layout.dialogRight <= layout.viewportWidth, JSON.stringify(layout));
  assert.ok(layout.dialogTop >= 0 && layout.dialogBottom <= layout.viewportHeight, JSON.stringify(layout));
  assert.ok(layout.listBottom <= layout.footerTop, `Preview list overlaps actions: ${JSON.stringify(layout)}`);
  assert.ok(layout.footerBottom <= layout.dialogBottom, `Preview actions are clipped: ${JSON.stringify(layout)}`);
}

async function assertProfileCreateLayout(popup, { allowVerticalScroll = false } = {}) {
  const layout = await popup.locator("#profilesView").evaluate((view) => {
    const form = document.querySelector("#profileForm");
    const toolbar = document.querySelector(".profiles-toolbar");
    const variables = document.querySelector("#profileVariablesInput");
    const actions = form.querySelector(".workbench-footer-actions");
    const viewRect = view.getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const variablesRect = variables.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      emptyHidden: document.querySelector("#profileEmpty").hidden,
      listHidden: document.querySelector("#profileList").hidden,
      formHidden: form.hidden,
      viewHeight: viewRect.height,
      formHeight: formRect.height,
      formClientHeight: form.clientHeight,
      formClientWidth: form.clientWidth,
      formScrollHeight: form.scrollHeight,
      formScrollWidth: form.scrollWidth,
      formTop: formRect.top,
      formBottom: formRect.bottom,
      toolbarBottom: toolbarRect.bottom,
      variablesBottom: variablesRect.bottom,
      actionsTop: actionsRect.top,
      actionsBottom: actionsRect.bottom
    };
  });
  assert.equal(layout.emptyHidden, true, JSON.stringify(layout));
  assert.equal(layout.listHidden, true, JSON.stringify(layout));
  assert.equal(layout.formHidden, false, JSON.stringify(layout));
  assert.ok(layout.formHeight >= layout.viewHeight * 0.65, `Profile form is too short: ${JSON.stringify(layout)}`);
  assert.ok(layout.formTop >= layout.toolbarBottom, `Profile form overlaps toolbar: ${JSON.stringify(layout)}`);
  assert.ok(layout.variablesBottom <= layout.actionsTop, `Profile variables overlap actions: ${JSON.stringify(layout)}`);
  assert.ok(layout.formScrollWidth <= layout.formClientWidth + 1, `Profile form scrolls horizontally: ${JSON.stringify(layout)}`);
  if (allowVerticalScroll) {
    await popup.locator("#profileForm .workbench-footer-actions").scrollIntoViewIfNeeded();
    const actionsVisible = await popup.locator("#profileForm .workbench-footer-actions").evaluate((actions) => {
      const formRect = document.querySelector("#profileForm").getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      return actionsRect.top >= formRect.top && actionsRect.bottom <= formRect.bottom + 1;
    });
    assert.equal(actionsVisible, true, `Profile actions cannot be reached: ${JSON.stringify(layout)}`);
  } else {
    assert.ok(layout.actionsBottom <= layout.formBottom, `Profile actions are clipped: ${JSON.stringify(layout)}`);
  }
}

async function assertProfileHelp(popup, artifactName) {
  const helpButton = popup.locator("#profileHelpButton");
  assert.equal(await helpButton.getAttribute("aria-label"), "How site profiles work");
  assert.equal(await helpButton.getAttribute("data-tooltip"), "How profiles work");
  await helpButton.click();

  const helpDialog = popup.locator("#profileHelpDialog");
  await helpDialog.waitFor({ state: "visible" });
  const helpText = await helpDialog.innerText();
  assert.match(helpText, /Create a profile/);
  assert.match(helpText, /userId=42/);
  assert.match(helpText, /!userId=42/);
  assert.match(helpText, /does not store/);
  assert.match(helpText, /origin mapping/);
  assert.match(helpText, /Preview the changes/);

  const layout = await helpDialog.evaluate((dialog) => {
    const body = dialog.querySelector("#profileHelpBody");
    const actions = dialog.querySelector(".app-dialog-actions");
    const dialogRect = dialog.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
      dialogTop: dialogRect.top,
      dialogBottom: dialogRect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      bodyBottom: bodyRect.bottom,
      actionsTop: actionsRect.top,
      actionsBottom: actionsRect.bottom,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth
    };
  });
  assert.ok(layout.dialogLeft >= 0 && layout.dialogRight <= layout.viewportWidth, JSON.stringify(layout));
  assert.ok(layout.dialogTop >= 0 && layout.dialogBottom <= layout.viewportHeight, JSON.stringify(layout));
  assert.ok(layout.bodyBottom <= layout.actionsTop + 1, `Profile help overlaps actions: ${JSON.stringify(layout)}`);
  assert.ok(layout.actionsBottom <= layout.dialogBottom + 1, `Profile help actions are clipped: ${JSON.stringify(layout)}`);
  assert.ok(layout.bodyScrollWidth <= layout.bodyClientWidth + 1, `Profile help scrolls horizontally: ${JSON.stringify(layout)}`);
  await screenshot(popup, artifactName);

  await popup.locator("#profileHelpCloseButton").click();
  await helpDialog.waitFor({ state: "hidden" });
  assert.equal(await popup.evaluate(() => document.activeElement?.id), "profileHelpButton");
}

async function assertSidePanelWorkbench(context, activePage, extensionId) {
  const sidePanel = await context.newPage();
  await sidePanel.goto(`chrome-extension://${extensionId}/src/popup/popup.html?surface=sidepanel`);
  await activePage.bringToFront();
  await sidePanel.reload({ waitUntil: "domcontentloaded" });
  await waitForPopupReady(sidePanel, "127.0.0.1");
  assert.equal(await sidePanel.evaluate(() => document.body.dataset.surface), "sidepanel");
  await sidePanel.locator("#importButton").click();
  await sidePanel.setViewportSize({ width: 420, height: 800 });
  const initialCookieImportLayout = await sidePanel.locator("#workbenchDialog").evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const addRect = document.querySelector("#quickEntryAddButton").getBoundingClientRect();
    const firstRowRect = document.querySelector(".cookie-import-row").getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, addTop: addRect.top, firstRowTop: firstRowRect.top };
  });
  for (let index = 0; index < 7; index += 1) {
    await sidePanel.locator(".cookie-import-add").click();
  }
  const cookieImportLayout = await sidePanel.locator("#workbenchDialog").evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const rows = document.querySelector("#quickEntryRows");
    rows.scrollTop = 0;
    const addButton = document.querySelector("#quickEntryAddButton");
    const firstRow = rows.querySelector(".cookie-import-row");
    const valueRect = firstRow.querySelector(".cookie-import-value").getBoundingClientRect();
    const removeRect = firstRow.querySelector(".cookie-import-remove").getBoundingClientRect();
    const addRect = addButton.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      rowCount: rows.querySelectorAll(".cookie-import-row").length,
      clientHeight: rows.clientHeight,
      scrollHeight: rows.scrollHeight,
      clientWidth: rows.clientWidth,
      scrollWidth: rows.scrollWidth,
      addText: addButton.textContent.trim(),
      addIconCount: addButton.querySelectorAll("svg, img").length,
      addTop: addRect.top,
      firstRowTop: firstRow.getBoundingClientRect().top,
      removeGap: removeRect.left - valueRect.right
    };
  });
  assert.ok(cookieImportLayout.left >= 0 && cookieImportLayout.right <= cookieImportLayout.viewportWidth, JSON.stringify(cookieImportLayout));
  assert.ok(cookieImportLayout.top >= 0 && cookieImportLayout.bottom <= cookieImportLayout.viewportHeight, JSON.stringify(cookieImportLayout));
  assert.equal(cookieImportLayout.rowCount, 8);
  assert.ok(cookieImportLayout.scrollWidth <= cookieImportLayout.clientWidth + 1, JSON.stringify(cookieImportLayout));
  assert.ok(cookieImportLayout.scrollHeight > cookieImportLayout.clientHeight, JSON.stringify(cookieImportLayout));
  assert.equal(cookieImportLayout.addText, "Add");
  assert.equal(cookieImportLayout.addIconCount, 0);
  assert.ok(cookieImportLayout.addTop < cookieImportLayout.firstRowTop, JSON.stringify(cookieImportLayout));
  assert.ok(cookieImportLayout.removeGap <= 6, JSON.stringify(cookieImportLayout));
  assert.ok(initialCookieImportLayout.height <= 520, JSON.stringify(initialCookieImportLayout));
  assert.equal(cookieImportLayout.height, initialCookieImportLayout.height);
  assert.ok(Math.abs(cookieImportLayout.top - initialCookieImportLayout.top) <= 1, JSON.stringify(cookieImportLayout));
  assert.ok(Math.abs(cookieImportLayout.bottom - initialCookieImportLayout.bottom) <= 1, JSON.stringify(cookieImportLayout));
  assert.ok(Math.abs(cookieImportLayout.addTop - initialCookieImportLayout.addTop) <= 1, JSON.stringify(cookieImportLayout));
  assert.ok(Math.abs(cookieImportLayout.firstRowTop - initialCookieImportLayout.firstRowTop) <= 1, JSON.stringify(cookieImportLayout));
  await screenshot(sidePanel, "v030-sidepanel-cookie-import.png");
  await sidePanel.keyboard.press("Escape");
  await sidePanel.locator("#workbenchDialog").waitFor({ state: "hidden" });
  await sidePanel.setViewportSize({ width: 1100, height: 800 });
  await sidePanel.locator("#exportButton").click();
  await sidePanel.locator("#workbenchDialog").waitFor({ state: "visible" });
  await sidePanel.setViewportSize({ width: 420, height: 800 });
  const layout = await sidePanel.locator("#workbenchDialog").evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight
    };
  });
  assert.ok(layout.left >= 0 && layout.right <= layout.width, JSON.stringify(layout));
  assert.ok(layout.top >= 0 && layout.bottom <= layout.height, JSON.stringify(layout));
  await screenshot(sidePanel, "v030-sidepanel-workbench.png");
  await sidePanel.locator('input[name="packageExportFormat"][value="netscape"]').check();
  const netscapeLayout = await sidePanel.locator("#packageExportView").evaluate((view) => ({
    clientWidth: view.clientWidth,
    scrollWidth: view.scrollWidth,
    formatWidth: document.querySelector(".export-format-switch").getBoundingClientRect().width,
    viewWidth: view.getBoundingClientRect().width
  }));
  assert.ok(netscapeLayout.scrollWidth <= netscapeLayout.clientWidth + 1, JSON.stringify(netscapeLayout));
  assert.ok(netscapeLayout.formatWidth <= netscapeLayout.viewWidth, JSON.stringify(netscapeLayout));
  await sidePanel.locator("#savePackageButton").scrollIntoViewIfNeeded();
  const netscapeActionsVisible = await sidePanel.locator("#savePackageButton").evaluate((button) => {
    const viewRect = document.querySelector("#packageExportView").getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return buttonRect.top >= viewRect.top && buttonRect.bottom <= viewRect.bottom + 1;
  });
  assert.equal(netscapeActionsVisible, true);
  await screenshot(sidePanel, "v030-sidepanel-netscape-export.png");
  await sidePanel.locator("#workbenchCloseButton").click();
  await sidePanel.locator("#workbenchDialog").waitFor({ state: "hidden" });
  await sidePanel.setViewportSize({ width: 1100, height: 800 });
  await sidePanel.locator("#profilesButton").click();
  await sidePanel.setViewportSize({ width: 420, height: 800 });
  await assertProfileHelp(sidePanel, "v030-sidepanel-profile-help.png");
  await sidePanel.locator("#newProfileButton").click();
  await assertProfileCreateLayout(sidePanel, { allowVerticalScroll: true });
  await screenshot(sidePanel, "v030-sidepanel-profile-create-empty.png");
  await sidePanel.close();
  await activePage.bringToFront();
}

async function assertTemplateFlow(popup) {
  await selectCookieBySearch(popup, "plain");
  await popup.locator("#saveTemplateButton").click();
  const saveTemplateDialogLayout = await getDialogLayout(popup, "#textInputDialog");
  assert.ok(saveTemplateDialogLayout.width <= 440, JSON.stringify(saveTemplateDialogLayout));
  assert.ok(saveTemplateDialogLayout.height <= 240, JSON.stringify(saveTemplateDialogLayout));
  assert.equal(await popup.locator("#textInputDialogTitle").textContent(), "Save template");
  assert.equal(await popup.locator("#textInputDialogInput").inputValue(), "plain");
  await screenshot(popup, "milestone-4-popup-save-template-dialog.png");
  await popup.locator("#textInputDialogInput").fill("   ");
  await popup.locator("#textInputDialogSubmitButton").click();
  assert.equal(await popup.locator("#textInputDialogError").isHidden(), false);
  await popup.locator("#textInputDialogInput").fill(`Plain template ${runId}`);
  await popup.locator("#textInputDialogSubmitButton").click();
  await waitForStatus(popup, "Saved template");

  await popup.locator("#saveTemplateButton").click();
  await submitTextInput(popup, `Temporary template ${runId}`);
  await waitForStatus(popup, "Saved template");

  await selectCookieBySearch(popup, "editable");
  await popup.locator("#applyTemplateButton").click();
  const templateDialogLayout = await getDialogLayout(popup, "#templateDialog");
  assert.ok(templateDialogLayout.width <= 460, JSON.stringify(templateDialogLayout));
  assert.ok(templateDialogLayout.height <= 420, JSON.stringify(templateDialogLayout));
  assert.equal(await popup.locator(".template-option").count(), 2);
  assert.equal(await popup.locator(".template-option-delete").count(), 2);
  assert.match(await popup.locator(".template-option").first().innerText(), new RegExp(`Temporary template ${runId}`));
  await screenshot(popup, "milestone-4-popup-template-dialog.png");

  await popup.locator(".template-option-delete").first().click();
  assert.equal(await popup.locator("#confirmDialogTitle").textContent(), "Delete template?");
  assert.match(await popup.locator("#confirmDialogMessage").textContent(), new RegExp(`Temporary template ${runId}`));
  await popup.keyboard.press("Escape");
  await popup.locator("#confirmDialog").waitFor({ state: "hidden" });
  assert.equal(await popup.locator(".template-option").count(), 2);

  await popup.locator(".template-option-delete").first().click();
  await acceptDeleteConfirmation(popup);
  await popup.waitForFunction(() => document.querySelectorAll(".template-option").length === 1);
  assert.match(await popup.locator("#templateDialogFeedback").textContent(), /Deleted template/);
  const storedTemplates = await popup.evaluate(async () => {
    const result = await chrome.storage.local.get({ cookieTemplates: [] });
    return result.cookieTemplates;
  });
  assert.equal(storedTemplates.length, 1);
  assert.doesNotMatch(storedTemplates[0].label, /Temporary template/);

  await popup.locator("#templateDialogApplyButton").click();
  await popup.locator("#confirmDialog").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#confirmDialogTitle").textContent(), "Apply to a different cookie?");
  assert.match(await popup.locator("#confirmDialogMessage").textContent(), /plain.*editable/);
  assert.equal(await popup.locator("#confirmDialogDeleteButton").textContent(), "Apply value");
  await popup.locator("#confirmDialogDeleteButton").click();
  await waitForStatus(popup, "Applied template");
  const value = await popup.locator("#valueInput").inputValue();
  assert.match(value, new RegExp(`hello-world-${runId}`));
  await popup.locator("#resetButton").click();

  await popup.locator("#applyTemplateButton").click();
  await popup.locator(".template-option-delete").click();
  await acceptDeleteConfirmation(popup);
  await popup.locator("#templateDialog").waitFor({ state: "hidden" });
  await waitForStatus(popup, "Deleted template");
  assert.equal(await popup.locator("#applyTemplateButton").isDisabled(), true);
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

  await popup.locator("#batchEditButton").click();
  const setValueDialogLayout = await getDialogLayout(popup, "#textInputDialog");
  assert.ok(setValueDialogLayout.width <= 440, JSON.stringify(setValueDialogLayout));
  assert.ok(setValueDialogLayout.height <= 240, JSON.stringify(setValueDialogLayout));
  assert.equal(await popup.locator("#textInputDialogTitle").textContent(), "Set value");
  await screenshot(popup, "milestone-4-popup-set-value-dialog.png");
  await submitTextInput(popup, `batch-updated-${runId}`);
  await waitForStatus(popup, "Updated 2 selected cookies.");

  let cookies = await context.cookies(baseUrl);
  assert.equal(cookies.find((cookie) => cookie.name === `batch_one_${runId}`)?.value, `batch-updated-${runId}`);
  assert.equal(cookies.find((cookie) => cookie.name === `batch_two_${runId}`)?.value, `batch-updated-${runId}`);

  await popup.locator("#selectAllCheckbox").check();
  await popup.locator("#batchDeleteButton").click();
  await acceptDeleteConfirmation(popup);
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
  assert.equal(await popup.locator("#closeStatusButton").isHidden(), true);
  await popup.waitForFunction(() => document.querySelector("#statusBar")?.hidden === true);
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

  await showDetailsView(popup);
  await popup.waitForFunction(() => {
    return document.querySelector("#detailsView")?.hidden === false &&
      document.querySelector("#historyPanel")?.hidden === true;
  });
}

async function assertExpirationEditFlow(popup, context, baseUrl) {
  await showDetailsView(popup);
  let cookies = await context.cookies(baseUrl);
  const originalPersistent = cookies.find((cookie) => cookie.name === "expires_cookie");
  assert.ok(originalPersistent?.expires > 0, "Expected a persistent cookie fixture.");
  const originalValue = originalPersistent.value;

  await selectCookieBySearch(popup, "expires_cookie");
  assert.equal(await popup.locator("#expirationInput").isEnabled(), true);
  assert.notEqual(await popup.locator("#expirationInput").inputValue(), "");

  const changeOnlyExpiration = Math.floor(Date.now() / 1000) + 12 * 24 * 60 * 60;
  await popup.locator("#expirationInput").evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, await toPopupDateTimeLocal(popup, changeOnlyExpiration));
  assert.equal(await popup.locator("#saveButton").isEnabled(), true);
  await popup.locator("#resetButton").click();
  assert.equal(await popup.locator("#saveButton").isDisabled(), true);

  const nextExpiration = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
  await popup.locator("#expirationInput").fill(await toPopupDateTimeLocal(popup, nextExpiration));
  assert.equal(await popup.locator("#saveButton").isEnabled(), true);
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved expires_cookie.");

  cookies = await context.cookies(baseUrl);
  let updated = cookies.find((cookie) => cookie.name === "expires_cookie");
  assert.equal(updated?.value, originalValue);
  assert.ok(Math.abs(updated.expires - nextExpiration) <= 1, JSON.stringify(updated));

  await popup.locator("#historyViewButton").click();
  const expirationHistoryItem = popup.locator("#historyList li").first();
  assert.match(await expirationHistoryItem.innerText(), /expires_cookie/);
  await expirationHistoryItem.locator(".history-detail-button").click();
  const expirationHistoryText = await popup.locator("#historyDetailGrid").innerText();
  assert.match(expirationHistoryText, /Before expiration/i);
  assert.match(expirationHistoryText, /After expiration/i);
  await expirationHistoryItem.locator(".history-undo-button").click();
  await waitForStatus(popup, "Undid the selected change.");

  cookies = await context.cookies(baseUrl);
  const restored = cookies.find((cookie) => cookie.name === "expires_cookie");
  assert.equal(restored?.value, originalValue);
  assert.ok(Math.abs(restored.expires - originalPersistent.expires) <= 1, JSON.stringify(restored));

  await showDetailsView(popup);
  await selectCookieBySearch(popup, "plain");
  const sessionValue = (await context.cookies(baseUrl)).find((cookie) => cookie.name === "plain")?.value;
  assert.equal(await popup.locator("#expirationInput").inputValue(), "");

  const persistentExpiration = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;
  await popup.locator("#expirationInput").fill(await toPopupDateTimeLocal(popup, persistentExpiration));
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved plain.");

  cookies = await context.cookies(baseUrl);
  updated = cookies.find((cookie) => cookie.name === "plain");
  assert.equal(updated?.value, sessionValue);
  assert.ok(Math.abs(updated.expires - persistentExpiration) <= 1, JSON.stringify(updated));

  await selectCookieBySearch(popup, "plain");
  await popup.locator("#expirationInput").fill("");
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved plain.");

  cookies = await context.cookies(baseUrl);
  updated = cookies.find((cookie) => cookie.name === "plain");
  assert.equal(updated?.value, sessionValue);
  assert.equal(updated?.expires, -1);

  await selectCookieBySearch(popup, "expires_cookie");
  await screenshot(popup, "milestone-4-popup-expiration.png");
}

async function toPopupDateTimeLocal(popup, timestamp) {
  return popup.evaluate((seconds) => {
    const date = new Date(seconds * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }, timestamp);
}

async function assertImportFlow(popup, context, baseUrl) {
  const name = `imported_${runId}`;
  const value = `from-input-${runId}`;
  const secondName = `imported_extra_${runId}`;
  const secondValue = `from-second-input-${runId}`;

  await popup.evaluate(() => {
    window.__clipboardReadAttempted = false;
    navigator.clipboard.readText = async () => {
      window.__clipboardReadAttempted = true;
      throw new Error("Clipboard reads are disabled for import.");
    };
  });
  await popup.locator("#importButton").click();
  const importDialogLayout = await getDialogLayout(popup, "#workbenchDialog");
  assert.ok(importDialogLayout.width <= 740, JSON.stringify(importDialogLayout));
  assert.ok(importDialogLayout.height <= 540, JSON.stringify(importDialogLayout));
  assert.equal(await popup.locator("#workbenchTitle").innerText(), "Import");
  assert.equal(await popup.locator('input[name="packageImportFormat"][value="quick"]').isChecked(), true);
  assert.equal(await popup.locator(".cookie-import-row").count(), 1);
  assert.equal(await popup.locator(".cookie-import-add").isVisible(), true);
  assert.equal(await popup.locator("#quickEntryAddButton").innerText(), "Add");
  assert.equal(await popup.locator("#quickEntryAddButton svg, #quickEntryAddButton img").count(), 0);
  await popup.locator(".cookie-import-name").fill("invalid name");
  await popup.locator("#quickImportButton").click();
  assert.equal(await popup.locator("#workbenchDialog").getAttribute("open"), "");
  assert.equal(await popup.locator("#quickImportError").isHidden(), false);
  await popup.locator(".cookie-import-name").fill(name);
  await popup.locator(".cookie-import-value").fill(value);
  await popup.locator(".cookie-import-add").click();
  assert.equal(await popup.locator(".cookie-import-row").count(), 2);
  assert.equal(await popup.locator(".cookie-import-remove:visible").count(), 2);
  assert.equal(await popup.locator(".cookie-import-add:visible").count(), 1);
  await popup.locator(".cookie-import-name").nth(1).fill(secondName);
  await popup.locator(".cookie-import-value").nth(1).fill(secondValue);
  await screenshot(popup, "milestone-4-popup-import-dialog.png");
  await popup.locator("#quickImportButton").click();
  await waitForStatus(popup, "Imported 2 cookies.");
  assert.equal(await popup.evaluate(() => window.__clipboardReadAttempted), false);

  const cookies = await context.cookies(baseUrl);
  const imported = cookies.find((cookie) => cookie.name === name);
  const secondImported = cookies.find((cookie) => cookie.name === secondName);
  assert.equal(imported?.value, value);
  assert.equal(secondImported?.value, secondValue);

  assert.equal(await popup.locator("#historyCountBadge").isHidden(), false);
  await popup.locator("#historyViewButton").click();
  assert.equal(await popup.locator("#historyCountBadge").isHidden(), true);
  await popup.locator(".history-detail-button").first().click();
  const detailText = await popup.locator("#historyDetail").innerText();
  assert.match(detailText, /Import create/);
  assert.match(detailText, new RegExp(secondName));
  assert.match(detailText, new RegExp(secondValue));

  await popup.locator(".history-undo-button").first().click();
  await waitForStatus(popup, "Undid the selected change.");

  const afterUndo = await context.cookies(baseUrl);
  assert.equal(afterUndo.some((cookie) => cookie.name === secondName), false);
  assert.equal(afterUndo.some((cookie) => cookie.name === name), true);
}

async function assertDeleteFlow(popup, context, baseUrl) {
  await selectCookieBySearch(popup, "delete_me");
  await popup.locator("#deleteButton").click();

  const dialogLayout = await popup.locator("#confirmDialog").evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      open: dialog.open,
      width: rect.width,
      height: rect.height,
      title: document.querySelector("#confirmDialogTitle")?.textContent,
      message: document.querySelector("#confirmDialogMessage")?.textContent
    };
  });
  assert.equal(dialogLayout.open, true);
  assert.ok(dialogLayout.width <= 400, JSON.stringify(dialogLayout));
  assert.ok(dialogLayout.height <= 240, JSON.stringify(dialogLayout));
  assert.equal(dialogLayout.title, "Delete cookie?");
  assert.match(dialogLayout.message, /delete_me/);
  await screenshot(popup, "milestone-4-popup-delete-dialog.png");

  await popup.keyboard.press("Escape");
  await popup.locator("#confirmDialog").waitFor({ state: "hidden" });
  let cookies = await context.cookies(baseUrl);
  assert.equal(cookies.some((cookie) => cookie.name === "delete_me"), true);
  assert.equal(await popup.locator("#deleteButton").evaluate((button) => button === document.activeElement), true);

  await popup.locator("#deleteButton").click();
  await acceptDeleteConfirmation(popup);
  await waitForStatus(popup, "Deleted delete_me.");

  cookies = await context.cookies(baseUrl);
  assert.equal(cookies.some((cookie) => cookie.name === "delete_me"), false);
}

async function assertHistoryPersistsWithSessionSnapshots(popup, context, baseUrl, seed) {
  await showDetailsView(popup);
  await selectCookieBySearch(popup, "editable");
  const cookiesBeforeEdit = await context.cookies(baseUrl);
  const valueBeforeEdit = cookiesBeforeEdit.find((cookie) => cookie.name === "editable")?.value;
  assert.ok(valueBeforeEdit, "Expected editable cookie before the persisted history check.");
  const valueAfterEdit = `persisted-history-${seed}`;
  await popup.locator("#valueInput").fill(valueAfterEdit);
  await popup.locator("#saveButton").click();
  await waitForStatus(popup, "Saved editable.");

  const storedHistory = await popup.evaluate(async () => {
    const [changeResult, snapshotResult] = await Promise.all([
      chrome.storage.local.get({ recentCookieChanges: [] }),
      chrome.storage.session.get({ recentChangeSnapshots: {} })
    ]);
    return {
      changes: changeResult.recentCookieChanges,
      snapshots: snapshotResult.recentChangeSnapshots
    };
  });
  const persistedChange = storedHistory.changes.find((change) => {
    return (change.itemKind || "cookie") === "cookie" && change.name === "editable";
  });
  assert.ok(persistedChange, "Expected persisted cookie history before reloading the popup.");
  assert.equal(storedHistory.snapshots[persistedChange.id]?.beforeValue, valueBeforeEdit);
  assert.equal(storedHistory.snapshots[persistedChange.id]?.afterValue, valueAfterEdit);

  await popup.reload({ waitUntil: "domcontentloaded" });
  await waitForPopupReady(popup, "127.0.0.1");
  await popup.locator("#historyViewButton").click();

  const persistedItem = popup.locator(`#historyList li[data-change-id="${persistedChange.id}"]`);
  assert.equal(await persistedItem.count(), 1);
  assert.equal(await popup.locator("#historyList").isHidden(), false);
  assert.equal(await popup.locator("#historyEmpty").isHidden(), true);
  assert.equal(await popup.locator("#historyCountBadge").isHidden(), true);
  assert.equal(await popup.locator("#clearHistoryButton").isDisabled(), false);
  const persistedDetailButton = persistedItem.locator(".history-detail-button");
  const persistedUndoButton = persistedItem.locator(".history-undo-button");
  assert.equal(await persistedDetailButton.count(), 1);
  assert.equal(await persistedUndoButton.count(), 1);
  await persistedDetailButton.click();
  assert.match(await popup.locator("#historyBeforeValue").innerText(), new RegExp(valueBeforeEdit));
  assert.match(await popup.locator("#historyAfterValue").innerText(), new RegExp(valueAfterEdit));
  assert.equal(await popup.locator("#historyBeforeValue .diff-removed").count(), 1);
  assert.equal(await popup.locator("#historyAfterValue .diff-added").count(), 1);
  assert.equal(await popup.locator("#historyDetailNote").isHidden(), true);

  await persistedUndoButton.click();
  await waitForStatus(popup, "Undid the selected change.");
  const cookiesAfterUndo = await context.cookies(baseUrl);
  assert.equal(cookiesAfterUndo.find((cookie) => cookie.name === "editable")?.value, valueBeforeEdit);

  const snapshotAfterUndo = await popup.evaluate(async (changeId) => {
    const result = await chrome.storage.session.get({ recentChangeSnapshots: {} });
    return result.recentChangeSnapshots[changeId];
  }, persistedChange.id);
  assert.equal(snapshotAfterUndo, undefined);
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
  await showDetailsView(popup);
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
  await assertCurrentExportScopeLabel(popup, "Current view(Local Storage)");
  assert.equal(await popup.locator("#importButton").getAttribute("aria-label"), "Import");
  assert.equal(await popup.locator("#importButton").getAttribute("data-tooltip"), "Import");
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

  await showDetailsView(popup);
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
  await popup.locator("#copyPackageButton").click();
  await popup.waitForFunction(() => document.querySelector("#packageExportFeedback")?.textContent?.includes("Copied"));
  const exportedText = await popup.evaluate(() => window.__lastClipboardWrite);
  const exported = JSON.parse(exportedText);
  assert.equal(exported.type, "localStorage");
  assert.equal(exported.count, exported.data.localStorage.length);
  assert.ok(exported.data.localStorage.some((item) => item.key === "local_plain"));
  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#workbenchDialog").waitFor({ state: "hidden" });

  const importName = `local_imported_${seed}`;
  const secondImportName = `local_imported_second_${seed}`;
  await popup.locator("#importButton").click();
  await popup.locator("#workbenchDialog").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#quickEntryFields").isVisible(), true);
  assert.equal(await popup.locator("#quickEntryTitle").innerText(), "Local Storage");
  assert.equal(await popup.locator("#quickEntryNameColumn").innerText(), "Key");
  assert.equal(await popup.locator(".cookie-import-name").getAttribute("placeholder"), "Storage key");
  assert.equal(await popup.locator(".cookie-import-value").getAttribute("placeholder"), "Storage value");
  assert.equal(await popup.locator("#netscapeImportFormatLabel").isHidden(), true);
  await popup.locator(".cookie-import-name").fill(importName);
  await popup.locator(".cookie-import-value").fill("local-import-value");
  await popup.locator("#quickEntryAddButton").click();
  await popup.locator(".cookie-import-name").nth(1).fill(importName);
  await popup.locator(".cookie-import-value").nth(1).fill("local-second-value");
  await popup.locator("#quickImportButton").click();
  assert.match(await popup.locator("#quickImportError").innerText(), /Storage key.*duplicated/);
  assert.equal(await popup.locator("#workbenchDialog").getAttribute("open"), "");
  await popup.locator(".cookie-import-name").nth(1).fill(secondImportName);
  await popup.locator("#quickImportButton").click();
  await waitForStatus(popup, "Imported 2 local storage items.");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), importName), "local-import-value");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), secondImportName), "local-second-value");

  await selectItemBySearch(popup, "local_delete_me");
  await popup.locator("#deleteButton").click();
  await acceptDeleteConfirmation(popup);
  await waitForStatus(popup, "Deleted local_delete_me.");
  assert.equal(await page.evaluate(() => localStorage.getItem("local_delete_me")), null);
}

async function assertSessionStorageFlow(popup, page, seed) {
  await switchDataView(popup, "sessionStorage");
  await waitForPopupReady(popup, "127.0.0.1");
  await assertCurrentExportScopeLabel(popup, "Current view(Session Storage)");
  await popup.locator("#importButton").click();
  await popup.locator("#workbenchDialog").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#netscapeImportFormatLabel").isHidden(), true);
  assert.equal(await popup.locator("#quickEntryTitle").innerText(), "Session Storage");
  assert.equal(await popup.locator("#quickEntryNameColumn").innerText(), "Key");
  const importName = `session_imported_${seed}`;
  await popup.locator(".cookie-import-name").fill(importName);
  await popup.locator(".cookie-import-value").fill("session-import-value");
  await popup.locator("#quickImportButton").click();
  await waitForStatus(popup, `Imported ${importName}.`);
  assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), importName), "session-import-value");
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
  await popup.locator("#deleteButton").click();
  await acceptDeleteConfirmation(popup);
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

async function showDetailsView(popup) {
  const historyIsVisible = await popup.locator("#historyPanel").evaluate((panel) => !panel.hidden);
  if (historyIsVisible) {
    await popup.locator("#historyViewButton").click();
  }
  await popup.waitForFunction(() => {
    return document.querySelector("#detailsView")?.hidden === false &&
      document.querySelector("#historyPanel")?.hidden === true;
  });
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
  assert.equal(widths[0], 162);
  assert.equal(await readStorageValue(popup, "columnWidthsVersion"), 2);
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

async function acceptDeleteConfirmation(popup) {
  await popup.locator("#confirmDialog").waitFor({ state: "visible" });
  await popup.locator("#confirmDialogDeleteButton").click();
}

async function submitTextInput(popup, text) {
  await popup.locator("#textInputDialog").waitFor({ state: "visible" });
  await popup.locator("#textInputDialogInput").fill(text);
  await popup.locator("#textInputDialogSubmitButton").click();
}

async function assertCurrentExportScopeLabel(popup, expectedLabel) {
  await popup.locator("#exportButton").click();
  await popup.locator("#workbenchDialog").waitFor({ state: "visible" });
  assert.equal(await popup.locator('input[name="packageExportFormat"][value="json"]').isChecked(), true);
  assert.equal(await popup.locator('input[name="exportScope"][value="current"]').isChecked(), true);
  const storageView = /Local Storage|Session Storage/.test(expectedLabel);
  assert.equal(await popup.locator("#netscapeExportFormatLabel").isHidden(), storageView);
  assert.equal(await popup.locator("#currentExportScopeLabel").innerText(), expectedLabel);
  await popup.locator("#workbenchCloseButton").click();
  await popup.locator("#workbenchDialog").waitFor({ state: "hidden" });
}

async function getDialogLayout(popup, selector) {
  return popup.locator(selector).evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      open: dialog.open,
      width: rect.width,
      height: rect.height
    };
  });
}

async function screenshot(page, name) {
  const screenshotPath = path.join(artifactDir, name);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`popup screenshot: ${screenshotPath}`);
}
