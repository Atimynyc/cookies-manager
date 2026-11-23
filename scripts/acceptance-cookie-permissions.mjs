import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createAcceptanceExtension } from "./acceptance-extension-fixture.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(projectRoot, "output", "playwright", "cookie-permissions");
const targetUrl = "https://tools.example.test/app";
const completeScope = [
  "http://tools.example.test/*", "https://tools.example.test/*", "http://example.test/*", "https://example.test/*"
];
const expectedNames = ["host_plain", "host_secure", "parent_http_only", "parent_plain", "parent_secure"].sort();
const report = { scenarios: [], nativePermissionPromptTested: false };
await mkdir(artifactDir, { recursive: true });

for (const mode of ["legacy", "complete"]) {
  const extension = await createAcceptanceExtension(projectRoot, {
    hostPermissions: mode === "legacy" ? ["https://tools.example.test/*"] : completeScope
  });
  const profile = await mkdtemp(path.join(tmpdir(), "cookie-permissions-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: process.env.HEADED !== "1", locale: "en-US",
      viewport: { width: 760, height: 820 },
      args: [`--disable-extensions-except=${extension.extensionRoot}`, `--load-extension=${extension.extensionRoot}`]
    });
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    await context.route("https://tools.example.test/**", (route) => route.fulfill({
      contentType: "text/html", body: "<!doctype html><title>Cookie permission regression</title><h1>Synthetic cookie target</h1>"
    }));
    await context.addCookies([
      { name: "host_secure", domain: "tools.example.test", secure: true },
      { name: "host_plain", domain: "tools.example.test", secure: false },
      { name: "parent_secure", domain: ".example.test", secure: true },
      { name: "parent_plain", domain: ".example.test", secure: false },
      { name: "parent_http_only", domain: ".example.test", secure: true, httpOnly: true },
      { name: "other_path", domain: ".example.test", secure: true, path: "/private" },
      { name: "sibling", domain: "other.example.test", secure: true },
      { name: "unrelated", domain: "unrelated.test", secure: true }
    ].map((cookie) => ({ value: "synthetic", path: "/", ...cookie })));
    await context.addCookies([{ name: "parent_host_only", value: "synthetic", url: "https://example.test/" }]);
    const target = await context.newPage();
    await target.goto(targetUrl);
    const cookieReader = await context.newCDPSession(target);
    const browserNames = (await cookieReader.send("Network.getCookies", { urls: [targetUrl] })).cookies.map(({ name }) => name).sort();
    await cookieReader.detach();
    assert.deepEqual(browserNames, expectedNames);
    const popup = await context.newPage();
    await popup.addInitScript(() => {
      globalThis.cookieReadCount = 0;
      const getAll = chrome.cookies.getAll.bind(chrome.cookies);
      chrome.cookies.getAll = (...args) => { globalThis.cookieReadCount += 1; return getAll(...args); };
    });
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await target.bringToFront();
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector("#loadingState").hidden && document.querySelector("#siteAccessDialog").open);
    assert.equal(await popup.evaluate(() => globalThis.cookieReadCount), 0);
    const before = await popup.evaluate(async (url) => {
      const { hasSitePermission, getCookiesForUrl } = await import(chrome.runtime.getURL("src/shared/cookie-api.js"));
      return {
        permissionComplete: await hasSitePermission(url),
        names: (await getCookiesForUrl(url)).map(({ name }) => name).sort(),
        unrelatedPermission: await chrome.permissions.contains({ origins: ["https://other.example.test/*"] })
      };
    }, targetUrl);
    assert.equal(before.unrelatedPermission, false);
    if (mode === "legacy") {
      assert.equal(before.permissionComplete, false, "Old HTTPS-only subdomain grants must trigger a permission upgrade");
      assert.deepEqual(before.names, ["host_secure"], "Reproduce Chrome silently omitting plain and parent-domain cookies");
      await context.clearCookies({ name: "host_secure" });
      const remaining = await popup.evaluate(async (url) => {
        const { getCookiesForUrl } = await import(chrome.runtime.getURL("src/shared/cookie-api.js"));
        return (await getCookiesForUrl(url)).map(({ name }) => name);
      }, targetUrl);
      assert.deepEqual(remaining, [], "Old grants read zero cookies when all cookies are plain or parent-domain");
      report.scenarios.push({ mode, browserNames, extensionNames: before.names, afterRemovingHostSecure: remaining, permissionUpgradeRequired: true });
      console.log("ok: old HTTPS-only subdomain permission reads 1 of 5 cookies, or zero without the host Secure cookie, and requires an upgrade");
      continue;
    }
    assert.equal(before.permissionComplete, true);
    assert.deepEqual(before.names, browserNames);
    await popup.evaluate(() => {
      const request = chrome.permissions.request.bind(chrome.permissions);
      chrome.permissions.request = (options, callback) => {
        globalThis.requestedCookieOrigins = options.origins;
        return request(options, callback);
      };
    });
    await popup.locator("#siteAccessDialogAllowButton").click();
    await popup.waitForFunction(() => !document.querySelector("#siteAccessDialog").open && document.querySelector("#loadingState").hidden);
    await popup.locator("#cookieTableBody .name-cell-text").first().waitFor();
    const visibleNames = (await popup.locator("#cookieTableBody .name-cell-text").allTextContents()).sort();
    assert.deepEqual(visibleNames, browserNames, "After one Allow, the list must match the browser's applicable cookies");
    assert.deepEqual(await popup.evaluate(() => globalThis.requestedCookieOrigins), completeScope);
    assert.equal(await popup.locator("#cookieCount").textContent(), "5 cookies");
    assert.equal(await popup.locator("#statusBar.is-error").count(), 0);
    await popup.screenshot({ path: path.join(artifactDir, "cookies-after-allow.png") });
    await target.bringToFront();
    await popup.reload();
    await popup.locator("#cookieTableBody .name-cell-text").first().waitFor();
    assert.equal(await popup.locator("#siteAccessDialog").isVisible(), false);
    assert.deepEqual((await popup.locator("#cookieTableBody .name-cell-text").allTextContents()).sort(), browserNames);
    report.scenarios.push({ mode, browserNames, extensionNames: visibleNames, origins: completeScope });
    assert.deepEqual(errors, []);
    console.log("ok: narrow parent-domain and HTTP/HTTPS permissions show all 5 applicable cookies after Allow and reopening");
  } finally {
    await context?.close();
    await extension.cleanup();
    await rm(profile, { recursive: true, force: true });
  }
}
report.passed = true;
await writeFile(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
console.log("cookie permission acceptance ok; native permission dialog was not automated");
