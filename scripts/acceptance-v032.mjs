import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "playwright/test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(projectRoot, ".tmp", "v032-acceptance");
const pageErrors = [];
const servers = [];
let context;
let profileDir;
let popup;

try {
  console.log("v0.3.2 acceptance mode: extension page (not native action popup lifecycle)");
  await mkdir(artifactDir, { recursive: true });
  const fixture = await readFile(path.join(projectRoot, "tests", "fixtures", "cookie-test-page.html"));
  const originA = await startServer(fixture);
  const originB = await startServer(fixture);
  profileDir = await mkdtemp(path.join(tmpdir(), "cookie-controller-v032-"));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: process.env.HEADED !== "1",
    viewport: { width: 760, height: 800 },
    args: [`--disable-extensions-except=${projectRoot}`, `--load-extension=${projectRoot}`]
  });
  context.on("page", watchPage);
  context.pages().forEach(watchPage);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const pageA = await context.newPage();
  await pageA.goto(`${originA}/?seed=v032`);
  const expires = Math.floor(Date.now() / 1000) + 86400;
  await context.addCookies([
    { url: originA, name: "draft_cookie", value: "baseline", expires },
    { url: originA, name: "other_cookie", value: "other", expires }
  ]);
  popup = await openExtensionPage(extensionId, pageA);
  await assertDraftFlow(pageA, originA, originB, expires);
  await popup.screenshot({ path: path.join(artifactDir, "v032-popup-draft.png"), fullPage: true });
  console.log("ok: draft retention, conflicts and Reset");
  await assertStaleOrigin(pageA, originA, originB);
  console.log("ok: stale origin read, write and delete rejected");
  await pageA.goto(`${originA}/?seed=v032`);
  await refreshTarget(pageA);
  await assertLocalHistory(pageA, originA, originB);
  console.log("ok: Local Storage history origin isolation");
  await assertSessionHistory(pageA, originA);
  console.log("ok: Session Storage history target isolation");
  const sidePanel = await openExtensionPage(extensionId, pageA, "sidepanel");
  await sidePanel.setViewportSize({ width: 420, height: 800 });
  await assertSavedStateLimit(sidePanel, originA);
  await sidePanel.screenshot({ path: path.join(artifactDir, "v032-sidepanel-state-limit.png"), fullPage: true });
  console.log("ok: Saved States limit and 420px error layout");
  assert.equal(pageErrors.length, 0, pageErrors.join("\n\n"));
  console.log("v0.3.2 extension acceptance ok");
} catch (error) {
  if (popup && !popup.isClosed()) {
    await popup.screenshot({ path: path.join(artifactDir, "v032-failure.png"), fullPage: true }).catch(() => {});
  }
  throw new Error(`${error.stack || error.message}${pageErrors.length ? `\nPage errors:\n${pageErrors.join("\n\n")}` : ""}`);
} finally {
  if (context) await context.close();
  for (const server of servers) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}

async function startServer(fixture) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

function watchPage(page) {
  page.on("pageerror", (error) => pageErrors.push(`${page.url()}\n${error.stack || error.message}`));
}

async function openExtensionPage(extensionId, activePage, surface = "popup") {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/src/popup/popup.html?surface=${surface}`);
  await activePage.bringToFront();
  await extensionPage.reload();
  await expect(extensionPage.locator("#loadingState")).toBeHidden();
  await expect(extensionPage.locator("#hostLabel")).toContainText(new URL(activePage.url()).host);
  return extensionPage;
}

async function refreshTarget(page) {
  await page.bringToFront();
  await popup.locator("#refreshButton").click();
  await expect(popup.locator("#loadingState")).toBeHidden();
  await expect(popup.locator("#hostLabel")).toContainText(new URL(page.url()).host);
}

async function selectItem(name) {
  if (await popup.locator("#historyPanel").isVisible()) {
    await popup.locator("#historyViewButton").click();
  }
  await popup.locator("#searchInput").fill(name);
  const row = popup.locator("#cookieTableBody tr").filter({ has: popup.locator("td:nth-child(2)", { hasText: name }) }).first();
  await row.click();
  await expect(popup.locator("#editorName")).toHaveText(name);
  return row;
}

async function switchView(view) {
  await popup.locator(`.data-switch button[data-view="${view}"]`).click();
  await expect(popup.locator("body")).toHaveAttribute("data-view", view);
  await expect(popup.locator("#loadingState")).toBeHidden();
}

async function assertDraftFlow(pageA, originA, originB, expires) {
  const row = await selectItem("draft_cookie");
  const value = popup.locator("#valueInput");
  const expiration = popup.locator("#expirationInput");
  const originalExpiration = await expiration.inputValue();
  await value.fill("retained-draft");
  await row.click();
  await expect(value).toHaveValue("retained-draft");
  await selectItem("other_cookie");
  await selectItem("draft_cookie");
  await expect(value).toHaveValue("retained-draft");
  await refreshTarget(pageA);
  await expect(value).toHaveValue("retained-draft");
  await expect(popup.locator("#editorFavoriteButton")).toBeEnabled();
  const otherSite = await context.newPage();
  await otherSite.goto(`${originB}/?seed=other-site`);
  await refreshTarget(otherSite);
  await selectItem("draft_cookie");
  await expect(value).toHaveValue("baseline");
  await refreshTarget(pageA);
  await selectItem("draft_cookie");
  await expect(value).toHaveValue("retained-draft");
  await otherSite.close();
  await switchView("localStorage");
  await switchView("cookies");
  await selectItem("draft_cookie");
  await expect(value).toHaveValue("retained-draft");
  await context.addCookies([{ url: originA, name: "draft_cookie", value: "external-change", expires }]);
  await refreshTarget(pageA);
  await expect(value).toHaveValue("retained-draft");
  await popup.locator("#saveButton").click();
  await expect(popup.locator("#confirmDialogTitle")).toHaveText("Overwrite changed item?");
  await popup.locator("#confirmDialogCancelButton").click();
  assert.equal((await context.cookies(originA)).find((cookie) => cookie.name === "draft_cookie").value, "external-change");
  await expect(value).toHaveValue("retained-draft");
  await popup.locator("#saveButton").click();
  await popup.locator("#confirmDialogDeleteButton").click();
  await expect(popup.locator("#statusMessage")).toHaveText("Saved draft_cookie.");
  assert.equal((await context.cookies(originA)).find((cookie) => cookie.name === "draft_cookie").value, "retained-draft");
  await value.fill("discard-me");
  await expiration.fill("");
  await popup.locator("#resetButton").click();
  await expect(value).toHaveValue("retained-draft");
  await expect(expiration).toHaveValue(originalExpiration);
  await expect(popup.locator("#saveButton")).toBeDisabled();
}

async function assertStaleOrigin(pageA, originA, originB) {
  const tabId = await popup.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id, pageA.url());
  await pageA.goto(`${originB}/?seed=other-origin`);
  await pageA.evaluate(() => localStorage.setItem("origin_guard", "keep-B"));
  const results = await popup.evaluate(async ({ tabId, originA }) => {
    const api = await import(chrome.runtime.getURL("src/shared/storage-api.js"));
    const operations = [
      () => api.getStorageItems(tabId, originA, "local"),
      () => api.setStorageValue(tabId, originA, "local", "origin_guard", "wrong-A"),
      () => api.removeStorageItem(tabId, originA, "local", "origin_guard")
    ];
    const results = [];
    for (const operation of operations) {
      try { await operation(); results.push("unexpected success"); }
      catch (error) { results.push(error.message); }
    }
    return results;
  }, { tabId, originA });
  for (const result of results) assert.match(result, /changed sites/);
  assert.equal(await pageA.evaluate(() => localStorage.getItem("origin_guard")), "keep-B");
}

async function assertSessionHistory(pageA, originA) {
  await switchView("sessionStorage");
  await selectItem("session_plain");
  await popup.locator("#valueInput").fill("session-edited-v032");
  await popup.locator("#saveButton").click();
  await expect(popup.locator("#statusMessage")).toHaveText("Saved session_plain.");
  const otherTab = await context.newPage();
  await otherTab.goto(`${originA}/?seed=other-tab`);
  await refreshTarget(otherTab);
  await popup.locator("#historyViewButton").click();
  const historyItem = popup.locator("#historyList li").filter({ hasText: "session_plain" }).first();
  const undo = historyItem.locator(".history-undo-button");
  await expect(undo).toBeDisabled();
  await expect(undo).toHaveAttribute("title", /original tab/);
  assert.equal(await otherTab.evaluate(() => sessionStorage.getItem("session_plain")), "session-before-other-tab");
  await refreshTarget(pageA);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(popup.locator("#statusMessage")).toHaveText("Undid the selected change.");
  assert.equal(await pageA.evaluate(() => sessionStorage.getItem("session_plain")), "session-before-v032");
}

async function assertLocalHistory(pageA, originA, originB) {
  await switchView("localStorage");
  await selectItem("local_plain");
  await popup.locator("#valueInput").fill("local-edited-v032");
  await popup.locator("#saveButton").click();
  await expect(popup.locator("#statusMessage")).toHaveText("Saved local_plain.");
  const otherSite = await context.newPage();
  await otherSite.goto(`${originB}/?seed=local-other`);
  await refreshTarget(otherSite);
  await switchView("localStorage");
  await popup.locator("#historyViewButton").click();
  const undo = popup.locator("#historyList li").filter({ hasText: "local_plain" }).first().locator(".history-undo-button");
  await expect(undo).toBeDisabled();
  await expect(undo).toHaveAttribute("title", `Undo is only available for ${originA}.`);
  assert.equal(await otherSite.evaluate(() => localStorage.getItem("local_plain")), "local-before-local-other");
  await refreshTarget(pageA);
  if (await popup.locator("#historyPanel").isHidden()) await popup.locator("#historyViewButton").click();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(popup.locator("#statusMessage")).toHaveText("Undid the selected change.");
  assert.equal(await pageA.evaluate(() => localStorage.getItem("local_plain")), "local-before-v032");
  await otherSite.close();
}

async function assertSavedStateLimit(sidePanel, originA) {
  const before = await sidePanel.evaluate(async (url) => {
    const { createSiteProfile } = await import(chrome.runtime.getURL("src/shared/site-profiles.js"));
    const { createSiteDataPackage } = await import(chrome.runtime.getURL("src/shared/site-data-package.js"));
    const dataPackage = createSiteDataPackage({ url, cookies: [], localStorage: [], sessionStorage: [] });
    const profiles = Array.from({ length: 50 }, (_, index) => createSiteProfile({
      id: `v032-profile-${index}`, name: `Saved state ${index + 1}`, dataPackage
    }));
    await chrome.storage.local.set({ siteDataProfiles: profiles });
    return profiles;
  }, originA);
  await sidePanel.locator("#profilesButton").click();
  await expect(sidePanel.locator("#profileCount")).toHaveText("50 saved");
  await sidePanel.locator(".profile-item").first().getByRole("button", { name: "Copy", exact: true }).click();
  await expect(sidePanel.locator("#profileListError")).toContainText("limited to 50 states");
  await expect(sidePanel.locator("#profileListError")).toBeVisible();
  const after = await sidePanel.evaluate(async () => (await chrome.storage.local.get("siteDataProfiles")).siteDataProfiles);
  assert.deepEqual(after, before);
  const layout = await sidePanel.locator("#profileListError").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, viewport: innerWidth };
  });
  assert.ok(layout.height > 30, JSON.stringify(layout));
  assert.ok(layout.left >= 0 && layout.right <= layout.viewport + 1, JSON.stringify(layout));
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
}
