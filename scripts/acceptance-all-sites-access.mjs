import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createAcceptanceExtension } from "./acceptance-extension-fixture.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(projectRoot, "output", "playwright", "all-sites-access");
const allOrigins = ["http://*/*", "https://*/*"];
const urls = ["https://first.example.test/app", "https://second.unrelated.test/app", "http://third.another.test/app", "https://fourth.new.test/app"];
const report = {
  scenarios: [], nativePermissionPromptTested: false,
  nativeRequestDenialSimulated: true, optionalWildcardGrantSeededViaManifestMigration: true,
  narrowPermissionRequestsCoveredBy: "test:cookie-permissions"
};
await mkdir(artifactDir, { recursive: true });

// Seed real optional grants by migrating an installed fixture from required to optional
// hosts. Requests can then exercise Chrome's API without automating its native prompt,
// while disabling access still removes genuine optional browser permissions.
async function launchFixture() {
  const extension = await createAcceptanceExtension(projectRoot);
  const profile = await mkdtemp(path.join(tmpdir(), "all-sites-access-"));
  const options = {
    channel: "chromium", headless: process.env.HEADED !== "1", locale: "en-US",
    viewport: { width: 760, height: 820 },
    args: [`--disable-extensions-except=${extension.extensionRoot}`, `--load-extension=${extension.extensionRoot}`]
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, options);
    await getWorker(context);
    await context.close();
    context = null;
    const manifestPath = path.join(extension.extensionRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.optional_host_permissions = manifest.host_permissions;
    delete manifest.host_permissions;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    context = await chromium.launchPersistentContext(profile, options);
    const worker = await getWorker(context);
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: "en" }));
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    for (const url of urls) {
      await context.route(`${new URL(url).origin}/**`, route => route.fulfill({
        contentType: "text/html", body: "<!doctype html><title>All sites acceptance</title><h1>Synthetic site data</h1>"
      }));
    }
    assert.equal(await worker.evaluate(origins => chrome.permissions.contains({ origins }), allOrigins), true);
    const target = await context.newPage();
    await visitTarget(target, urls[0]);
    return {
      context, extensionId, errors, target,
      async cleanup() {
        await context.close();
        await extension.cleanup();
        await rm(profile, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await context?.close();
    await extension.cleanup();
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

async function captureFailure(fixture, label) {
  for (const [index, page] of fixture.context.pages().entries()) {
    if (!page.url().startsWith("chrome-extension://")) continue;
    await page.screenshot({ path: path.join(artifactDir, `${label}-${index}.png`) }).catch(() => {});
    console.error(await page.evaluate(async () => ({
      url: location.href, activeOrigin: document.querySelector("#hostLabel")?.textContent,
      dialogOpen: document.querySelector("#siteAccessDialog")?.open,
      dialogError: document.querySelector("#siteAccessDialogError")?.textContent,
      allSitesDialogOpen: document.querySelector("#allSitesAccessDialog")?.open,
      allSitesDialogError: document.querySelector("#allSitesAccessDialogError")?.textContent,
      settingsError: document.querySelector("#settingsError")?.textContent,
      reads: globalThis.siteAccessReads, requests: globalThis.siteAccessRequests,
      requestResults: globalThis.siteAccessRequestResults,
      granted: await chrome.permissions.getAll()
    })).catch(() => null));
  }
}

async function getWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent("serviceworker");
}

async function visitTarget(target, url) {
  await target.goto(url);
  await target.evaluate(() => {
    document.cookie = "synthetic_cookie=cookie-value; path=/";
    localStorage.setItem("synthetic_local", "local-value");
    sessionStorage.setItem("synthetic_session", "session-value");
  });
  await target.bringToFront();
}

async function openSurface(fixture, surface = "popup", width = 760) {
  const page = await fixture.context.newPage();
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript(() => {
    globalThis.siteAccessReads = { cookies: 0, scripting: 0 };
    globalThis.siteAccessRequests = [];
    globalThis.siteAccessRequestResults = [];
    globalThis.siteAccessRequestGestures = [];
    globalThis.siteAccessDialogShows = [];
    globalThis.denySiteAccessRequest = false;
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function(...args) {
      if (["siteAccessDialog", "allSitesAccessDialog"].includes(this.id)) globalThis.siteAccessDialogShows.push(this.id);
      return showModal.apply(this, args);
    };
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type !== "click" || this.id !== "allSitesAccessDialogConfirmButton") {
        return addEventListener.call(this, type, listener, options);
      }
      return addEventListener.call(this, type, function(event) {
        globalThis.allSitesConfirmClickStack = true;
        try { return listener.call(this, event); }
        finally { globalThis.allSitesConfirmClickStack = false; }
      }, options);
    };
    const getAll = chrome.cookies.getAll.bind(chrome.cookies);
    const executeScript = chrome.scripting.executeScript.bind(chrome.scripting);
    const request = chrome.permissions.request.bind(chrome.permissions);
    chrome.cookies.getAll = (...args) => { globalThis.siteAccessReads.cookies += 1; return getAll(...args); };
    chrome.scripting.executeScript = (...args) => { globalThis.siteAccessReads.scripting += 1; return executeScript(...args); };
    chrome.permissions.request = (options, callback) => {
      globalThis.siteAccessRequests.push(options.origins);
      globalThis.siteAccessRequestGestures.push(globalThis.allSitesConfirmClickStack === true);
      if (globalThis.denySiteAccessRequest) { queueMicrotask(() => callback(false)); return; }
      return request(options, granted => {
        globalThis.siteAccessRequestResults.push({ granted, error: chrome.runtime.lastError?.message });
        callback(granted);
      });
    };
  });
  await page.goto(`chrome-extension://${fixture.extensionId}/src/popup/popup.html?surface=${surface}`);
  await fixture.target.bringToFront();
  await page.reload();
  await waitReady(page);
  return page;
}

async function waitReady(page) {
  await page.waitForFunction(() => document.querySelector("#loadingState").hidden);
}

async function waitDialog(page, open) {
  await page.waitForFunction(expected => document.querySelector("#siteAccessDialog").open === expected
    && document.querySelector("#loadingState").hidden, open);
}

async function waitAllSitesDialog(page, open) {
  await page.waitForFunction(expected => document.querySelector("#allSitesAccessDialog").open === expected, open);
}

async function openAllSitesConfirmation(page) {
  await page.locator("#siteAccessDialogAllSitesButton").click();
  await waitAllSitesDialog(page, true);
}

async function waitSwitch(page, enabled) {
  await page.waitForFunction(expected => {
    const toggle = document.querySelector("#allSitesAccessToggle");
    return !toggle.disabled && toggle.getAttribute("aria-checked") === String(expected);
  }, enabled);
}

async function openSettings(page) {
  if (await page.locator("#settingsMenu").isHidden()) await page.locator("#settingsButton").click();
}

async function assertCompactSettings(page) {
  await openSettings(page);
  assert.equal((await page.locator("#autoRefreshTitle").innerText()).trim(), "Reload after changes");
  assert.equal((await page.locator("#allSitesAccessTitle").innerText()).trim(), "Allow access all sites");
  assert.equal(await page.locator("#settingsMenu .refresh-setting-note:visible").count(), 0,
    "Settings descriptions belong in hover tooltips, without visible lines below the labels");
  assert.equal(await page.locator("#autoRefreshNote, #allSitesAccessNote, #allSitesAccessOffNote").evaluateAll(notes => notes.every(note => {
    const bounds = note.getBoundingClientRect();
    return bounds.width <= 1 && bounds.height <= 1;
  })), true, "Accessible descriptions must not occupy visible description rows");
  assert.equal(await page.locator(".settings-refresh-row").getAttribute("title"), "Reload the active page after editing data");
  const accessTooltip = await page.locator(".settings-access-row").getAttribute("title");
  assert.ok(accessTooltip?.includes("cookies, localStorage, and sessionStorage"), "The whole-row tooltip must explain all supported data types");
  assert.ok(accessTooltip?.includes("Turn off to ask for access on new sites."), "The tooltip must explain how to restore per-site authorization");
}

async function assertNoReads(page) {
  assert.deepEqual(await page.evaluate(() => globalThis.siteAccessReads), { cookies: 0, scripting: 0 });
}

async function getAllSitesPreference(page) {
  return page.evaluate(async () => {
    const { getPreferences, ALL_SITES_ACCESS_KEY } = await import(chrome.runtime.getURL("src/shared/settings-store.js"));
    return (await getPreferences())[ALL_SITES_ACCESS_KEY];
  });
}

async function assertNoAuthorization(page) {
  await assertNoReads(page);
  assert.equal(await getAllSitesPreference(page), false);
  assert.deepEqual(await page.evaluate(() => globalThis.siteAccessRequests), []);
}

async function resetAccessObservations(page) {
  await page.evaluate(() => {
    globalThis.siteAccessReads = { cookies: 0, scripting: 0 };
    globalThis.siteAccessDialogShows = [];
  });
}

async function assertDisabledWithoutPrompt(page) {
  await waitSwitch(page, false);
  await waitReady(page);
  await waitDialog(page, false);
  await waitAllSitesDialog(page, false);
  await assertNoReads(page);
  assert.deepEqual(await page.evaluate(() => globalThis.siteAccessDialogShows), [],
    "Turning all-sites access off must not open either authorization dialog, including queued removal events");
  assert.equal(await page.locator("#cookieTableBody .name-cell-text").count(), 0);
}

async function capturePermissionDialogs(page, surface) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => globalThis.cookieControllerTheme.setPreference(value), theme);
    await page.screenshot({ path: path.join(artifactDir, `${surface}-site-access-${theme}.png`), animations: "disabled" });
    if (surface === "popup" && theme === "light") {
      await page.locator("#siteAccessDialog").screenshot({ path: path.join(artifactDir, "site-access-yellow-button.png") });
    }
    await openAllSitesConfirmation(page);
    await assertNoAuthorization(page);
    await page.screenshot({ path: path.join(artifactDir, `${surface}-all-sites-confirm-${theme}.png`), animations: "disabled" });
    if (surface === "popup" && theme === "light") {
      await page.locator("#allSitesAccessDialog").screenshot({ path: path.join(artifactDir, "all-sites-confirmation.png") });
    }
    await page.locator("#allSitesAccessDialogCancelButton").click();
    await waitAllSitesDialog(page, false);
    await waitDialog(page, true);
  }
  await page.evaluate(() => globalThis.cookieControllerTheme.setPreference("light"));
}

async function assertRows(page, selector, name) {
  await page.locator(selector).click();
  await waitReady(page);
  await page.getByText(name, { exact: true }).first().waitFor();
  assert.equal(await page.locator("#siteAccessDialog").isVisible(), false);
}

async function assertAllData(page) {
  await assertRows(page, "#cookiesViewButton", "synthetic_cookie");
  await assertRows(page, "#localStorageViewButton", "synthetic_local");
  await assertRows(page, "#sessionStorageViewButton", "synthetic_session");
}

async function reloadForTarget(fixture, page, url) {
  await visitTarget(fixture.target, url);
  await page.reload();
  await waitReady(page);
}

async function testDialogAndDisable() {
  const fixture = await launchFixture();
  try {
    let popup = await openSurface(fixture);
    await waitDialog(popup, true);
    await assertNoAuthorization(popup);
    assert.equal(await popup.locator("#siteAccessDialogAllSitesToggle").count(), 0);
    await capturePermissionDialogs(popup, "popup");
    await openAllSitesConfirmation(popup);
    await popup.keyboard.press("Escape");
    await waitAllSitesDialog(popup, false);
    await waitDialog(popup, true);
    await assertNoAuthorization(popup);
    await openAllSitesConfirmation(popup);
    await popup.mouse.click(5, 5);
    await waitAllSitesDialog(popup, false);
    await waitDialog(popup, true);
    await assertNoAuthorization(popup);
    const previewSidebar = await openSurface(fixture, "sidepanel", 380);
    await waitDialog(previewSidebar, true);
    await capturePermissionDialogs(previewSidebar, "sidepanel");
    await assertNoAuthorization(previewSidebar);
    await previewSidebar.close();
    await popup.locator("#siteAccessDialogCancelButton").click();
    // Seed an existing per-site confirmation; its native request is covered by
    // acceptance-cookie-permissions. Chrome can still show a native dialog when
    // requesting narrow optional hosts from this migrated wildcard fixture.
    await popup.evaluate(async url => {
      const { grantSiteAccessConsent } = await import(chrome.runtime.getURL("src/shared/settings-store.js"));
      await grantSiteAccessConsent(url);
    }, urls[0]);
    await popup.reload();
    await waitDialog(popup, false);
    await assertAllData(popup);

    await reloadForTarget(fixture, popup, urls[1]);
    await waitDialog(popup, true);
    await assertNoReads(popup);
    await openAllSitesConfirmation(popup);
    await assertNoAuthorization(popup);
    await popup.evaluate(() => { globalThis.denySiteAccessRequest = true; });
    await popup.locator("#allSitesAccessDialogConfirmButton").click();
    await popup.locator("#allSitesAccessDialogError").waitFor();
    await waitAllSitesDialog(popup, true);
    await assertNoReads(popup);
    assert.equal(await getAllSitesPreference(popup), false);
    assert.deepEqual(await popup.evaluate(() => globalThis.siteAccessRequests.at(-1)), allOrigins);
    assert.equal(await popup.evaluate(() => globalThis.siteAccessRequestGestures.at(-1)), true,
      "Native request must begin in the secondary confirmation click's synchronous call stack");
    await popup.evaluate(() => { globalThis.denySiteAccessRequest = false; });
    await popup.locator("#allSitesAccessDialogConfirmButton").click();
    await waitAllSitesDialog(popup, false);
    await waitDialog(popup, false);
    assert.deepEqual(await popup.evaluate(() => globalThis.siteAccessRequests.at(-1)), allOrigins);
    assert.equal(await popup.evaluate(() => globalThis.siteAccessRequestGestures.at(-1)), true);
    await reloadForTarget(fixture, popup, urls[2]);
    await waitDialog(popup, false);
    await assertAllData(popup);
    await popup.close();
    popup = await openSurface(fixture);
    await waitDialog(popup, false);
    await openSettings(popup);
    await waitSwitch(popup, true);
    await popup.screenshot({ path: path.join(artifactDir, "popup-settings-all-sites.png") });
    const sidebar = await openSurface(fixture, "sidepanel", 380);
    await waitDialog(sidebar, false);
    await openSettings(sidebar);
    await waitSwitch(sidebar, true);
    await sidebar.screenshot({ path: path.join(artifactDir, "sidepanel-settings-all-sites.png") });
    await Promise.all([resetAccessObservations(sidebar), resetAccessObservations(popup)]);
    await sidebar.locator("#allSitesAccessToggle").click();
    await waitSwitch(sidebar, false);
    await waitSwitch(popup, false);
    assert.equal(await sidebar.evaluate(origins => chrome.permissions.contains({ origins }), allOrigins), false);
    // Allow native removal and storage listeners to deliver their queued refreshes.
    await sidebar.waitForTimeout(150);
    await Promise.all([assertDisabledWithoutPrompt(sidebar), assertDisabledWithoutPrompt(popup)]);
    await sidebar.screenshot({ path: path.join(artifactDir, "sidepanel-all-sites-disabled-no-dialog.png") });
    assert.equal(await sidebar.evaluate(async url => {
      const { hasSiteAccessConsent } = await import(chrome.runtime.getURL("src/shared/settings-store.js"));
      return hasSiteAccessConsent(url);
    }, urls[0]), true, "Explicit per-site confirmation survives disabling all-sites access");
    if (await popup.locator("#settingsMenu").isVisible()) await popup.locator("#settingsButton").click();
    const requestCount = await popup.evaluate(() => globalThis.siteAccessRequests.length);
    await popup.locator("#requestPermissionButton").click();
    await waitDialog(popup, true);
    assert.equal(await popup.evaluate(() => globalThis.siteAccessRequests.length), requestCount,
      "Manually reopening the site dialog does not authorize access");
    await popup.locator("#siteAccessDialogCancelButton").click();
    await waitDialog(popup, false);
    await reloadForTarget(fixture, sidebar, urls[3]);
    await waitDialog(sidebar, true);
    await assertNoReads(sidebar);
    await sidebar.screenshot({ path: path.join(artifactDir, "sidepanel-new-site-after-disable.png") });
    assert.deepEqual(fixture.errors, []);
    report.scenarios.push({ name: "dialog-enable-and-settings-disable", passed: true,
      checks: ["default-off", "separate-confirmation", "first-button-no-authorization", "cancel-escape-backdrop", "secondary-denial-and-retry", "synchronous-native-confirm-click", "existing-per-site-confirmation", "all-three-data-types", "new-http-site", "reopen", "cross-surface-sync", "disable-without-dialog-or-reads", "manual-dialog-still-available", "native-wildcard-revocation", "new-site-blocked", "popup-and-380px-light-dark-layout"] });
    console.log("ok: dialog global access, Cookie/Local/Session on new sites, persistence, cross-surface settings and native permission removal");
  } catch (error) {
    await captureFailure(fixture, "dialog-failure");
    throw error;
  } finally { await fixture.cleanup(); }
}

async function testSettingsAndExternalRevocation() {
  const fixture = await launchFixture();
  try {
    const popup = await openSurface(fixture);
    await waitDialog(popup, true);
    await popup.locator("#siteAccessDialogCancelButton").click();
    await openSettings(popup);
    await waitSwitch(popup, false);
    await assertCompactSettings(popup);
    await popup.screenshot({ path: path.join(artifactDir, "compact-settings-popup.png"), animations: "disabled" });
    await popup.locator("#settingsMenu").screenshot({ path: path.join(artifactDir, "settings-compact.png") });
    await popup.locator("#allSitesAccessToggle").click();
    await waitAllSitesDialog(popup, true);
    await assertNoAuthorization(popup);
    assert.equal(await popup.locator("#allSitesAccessToggle").getAttribute("aria-checked"), "false");
    await popup.locator("#allSitesAccessDialogCancelButton").click();
    await waitAllSitesDialog(popup, false);
    await waitDialog(popup, false);
    await waitSwitch(popup, false);
    await assertNoAuthorization(popup);
    await openSettings(popup);
    await popup.locator("#allSitesAccessToggle").click();
    await waitAllSitesDialog(popup, true);
    await popup.keyboard.press("Escape");
    await waitAllSitesDialog(popup, false);
    await waitDialog(popup, false);
    await waitSwitch(popup, false);
    await assertNoAuthorization(popup);

    // Global settings authorization is independent of the active site's support.
    await fixture.target.goto("chrome://version/");
    await fixture.target.bringToFront();
    await popup.reload();
    await waitReady(popup);
    await waitDialog(popup, false);
    await openSettings(popup);
    await popup.locator("#allSitesAccessToggle").click();
    await waitAllSitesDialog(popup, true);
    await assertNoAuthorization(popup);
    await popup.locator("#allSitesAccessDialog").screenshot({ path: path.join(artifactDir, "settings-all-sites-confirmation.png") });
    await popup.evaluate(() => { globalThis.denySiteAccessRequest = true; });
    await popup.locator("#allSitesAccessDialogConfirmButton").click();
    await popup.locator("#allSitesAccessDialogError").waitFor();
    await waitAllSitesDialog(popup, true);
    await assertNoReads(popup);
    assert.equal(await getAllSitesPreference(popup), false);
    assert.equal(await popup.evaluate(() => globalThis.siteAccessRequestGestures.at(-1)), true);
    await popup.evaluate(() => { globalThis.denySiteAccessRequest = false; });
    await popup.locator("#allSitesAccessDialogConfirmButton").click();
    await waitAllSitesDialog(popup, false);
    await waitSwitch(popup, true);
    await waitDialog(popup, false);
    await assertNoReads(popup);
    assert.deepEqual(await popup.evaluate(() => globalThis.siteAccessRequests.at(-1)), allOrigins);
    assert.equal(await popup.evaluate(() => globalThis.siteAccessRequestGestures.at(-1)), true,
      "Settings authorization must request native access directly from the second confirmation click");
    await reloadForTarget(fixture, popup, urls[1]);
    await waitDialog(popup, false);
    await assertAllData(popup);
    const sidebar = await openSurface(fixture, "sidepanel", 380);
    await waitSwitch(sidebar, true);
    await assertCompactSettings(sidebar);
    await sidebar.screenshot({ path: path.join(artifactDir, "compact-settings-sidepanel.png"), animations: "disabled" });
    const requestCount = await popup.evaluate(() => globalThis.siteAccessRequests.length);
    assert.equal(await sidebar.evaluate(origins => chrome.permissions.remove({ origins }), allOrigins), true);
    await waitDialog(popup, true);
    await waitDialog(sidebar, true);
    await waitSwitch(popup, false);
    await waitSwitch(sidebar, false);
    assert.equal(await popup.evaluate(() => globalThis.siteAccessRequests.length), requestCount, "Externally revoked permissions must require a fresh user action");
    assert.equal(await popup.locator("#cookieTableBody .name-cell-text").count(), 0);
    assert.deepEqual(fixture.errors, []);
    report.scenarios.push({ name: "settings-enable-and-external-revocation", passed: true,
      checks: ["compact-settings-labels", "whole-row-hover-tooltips", "no-visible-setting-descriptions", "settings-secondary-confirmation", "settings-cancel-and-escape-without-authorization", "settings-denial-rollback", "settings-enable-from-unsupported-page", "settings-direct-native-confirm-click", "settings-global-enable", "all-three-data-types", "external-revocation", "effective-switch-off", "no-automatic-native-request"] });
    console.log("ok: settings opt-in/denial and externally revoked browser grants restore site authorization across surfaces");
  } catch (error) {
    await captureFailure(fixture, "settings-failure");
    throw error;
  } finally { await fixture.cleanup(); }
}

try {
  await testDialogAndDisable();
  await testSettingsAndExternalRevocation();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || error.message;
  throw error;
} finally {
  await writeFile(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
}
console.log("all-sites access acceptance ok; native browser permission prompt was not automated");
