import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "output/playwright/themes");
const profile = await mkdtemp(path.join(tmpdir(), "cookie-controller-theme-"));
let context;
let cdp;
let privatePopup;
const errors = [];
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Theme test</title><body>Theme test fixture</body>");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(artifacts, { recursive: true });
try {
  // CDP loads Windows paths without command-line escaping during permission reloads.
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, locale: "en-US", viewport: { width: 760, height: 560 },
    ignoreDefaultArgs: ["--disable-extensions"], args: ["--lang=en-US", "--enable-unsafe-extension-debugging"]
  });
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
  const url = `chrome-extension://${id}/src/popup/popup.html`;
  const management = await context.newPage();
  await management.goto(`chrome://extensions/?id=${id}`);
  await management.evaluate(id => new Promise((resolve, reject) => {
    chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, incognitoAccess: true }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
    });
  }), id);
  await management.waitForFunction(id => new Promise(resolve => {
    chrome.developerPrivate.getExtensionInfo(id, info => resolve(info.state === "ENABLED" && !info.disableReasons.reloading));
  }), id);
  await management.close();
  const site = await context.newPage();
  await site.goto(origin);
  await context.addCookies([{ url: origin, name: "theme_test", value: "draft stays local" }]);

  const regular = await context.newPage();
  for (let attempt = 0; ; attempt += 1) {
    try { await regular.goto(url); break; }
    catch (error) {
      if (attempt >= 30 || !error.message.includes("ERR_BLOCKED_BY_CLIENT")) throw error;
      await regular.waitForTimeout(100);
    }
  }
  await site.bringToFront();
  await regular.reload();
  await regular.locator("#settingsButton").click();
  await regular.waitForFunction(() => !document.querySelector("#themeToggle").disabled);
  assert.equal(await regular.evaluate(() => cookieControllerTheme.getScope()), "regular");
  await regular.emulateMedia({ colorScheme: "dark" });
  await assertTheme(regular, "light");
  await regular.screenshot({ path: path.join(artifacts, "regular-default-sun.png") });
  await regular.locator("#themeToggle").focus();
  await regular.keyboard.press("Space");
  await assertTheme(regular, "dark");
  await regular.waitForFunction(async () => (await chrome.storage.local.get("uiThemeRegular")).uiThemeRegular === "dark");
  assert.equal(await regular.evaluate(async () => (await chrome.storage.local.get("uiThemeIncognito")).uiThemeIncognito), undefined);

  await regular.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (patch, callback) => {
      if ("uiThemeRegular" in patch) throw new Error("Synthetic settings save failure");
      return original(patch, callback);
    };
    window.__restoreThemeStorage = () => { chrome.storage.local.set = original; };
  });
  await regular.locator("#themeToggle").click();
  await regular.locator("#settingsError").waitFor({ state: "visible" });
  await assertTheme(regular, "dark");
  await regular.evaluate(() => window.__restoreThemeStorage());

  const second = await context.newPage();
  await second.goto(url);
  await site.bringToFront();
  await second.reload();
  await second.locator("#settingsButton").click();
  await assertTheme(second, "dark");
  await second.setViewportSize({ width: 380, height: 800 });
  await second.evaluate(() => {
    document.documentElement.dataset.surface = "sidepanel";
    document.body.dataset.surface = "sidepanel";
  });
  await second.screenshot({ path: path.join(artifacts, "regular-dark-moon-sidepanel.png") });

  const { id: privateWindowId } = await regular.evaluate(url => chrome.windows.create({ incognito: true, url, width: 1200, height: 900 }), origin);
  privatePopup = await openPrivatePopup(regular, privateWindowId, url);
  const privateEvidence = await privatePopup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { incognitoTab: tab.incognito, scope: cookieControllerTheme.getScope(), nativePopup: chrome.extension.getViews({ type: "popup" }).includes(window) };
  });
  assert.deepEqual(privateEvidence, { incognitoTab: true, scope: "incognito", nativePopup: true });
  await assertTheme(privatePopup, "dark");
  await privatePopup.screenshot(path.join(artifacts, "incognito-default-moon.png"));
  await privatePopup.evaluate(() => document.querySelector("#themeToggle").click());
  await assertTheme(privatePopup, "light");
  await waitFor(privatePopup, async () => (await chrome.storage.local.get("uiThemeIncognito")).uiThemeIncognito === "light");
  await privatePopup.screenshot(path.join(artifacts, "incognito-saved-sun.png"));
  assert.equal(await regular.locator("html").getAttribute("data-theme"), "incognito", "Private preference must not change regular surfaces");
  await privatePopup.close();
  privatePopup = await openPrivatePopup(regular, privateWindowId, url);
  await assertTheme(privatePopup, "light");
  await privatePopup.close();
  privatePopup = null;
  await regular.evaluate(id => chrome.windows.remove(id), privateWindowId);

  await second.locator("#themeToggle").click();
  await regular.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await regular.locator("#themeToggle").focus();
  await regular.keyboard.press("Enter");
  await assertTheme(regular, "dark");
  await second.waitForFunction(() => document.documentElement.dataset.theme === "incognito");
  await regular.reload();
  await regular.locator("#settingsButton").click();
  await assertTheme(regular, "dark");

  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, privateEvidence,
    scenarios: ["regular defaults light despite dark OS", "sun/moon and keyboard", "save failure rollback", "same-mode synchronization",
      "native incognito popup defaults dark", "independent mode preferences", "reopened incognito popup remembers light", "regular preference survives reload"] }, null, 2));
  console.log("theme acceptance passed: sun/moon, separate mode defaults and persistence, native incognito popup, synchronization, keyboard and save failure rollback");
} finally {
  await privatePopup?.close().catch(() => {});
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  assert.ok(profile.startsWith(path.join(tmpdir(), "cookie-controller-theme-")));
  await rm(profile, { recursive: true, force: true });
}

async function assertTheme(surface, theme) {
  await waitFor(surface, expected => {
    const button = document.querySelector("#themeToggle");
    return button && !button.disabled && document.documentElement.dataset.theme === (expected === "dark" ? "incognito" : "light")
      && button.getAttribute("aria-checked") === String(expected === "dark");
  }, theme);
  const visibility = await surface.evaluate(() => ({
    sun: getComputedStyle(document.querySelector(".theme-sun")).visibility,
    moon: getComputedStyle(document.querySelector(".theme-moon")).visibility,
    colorScheme: getComputedStyle(document.documentElement).colorScheme
  }));
  assert.deepEqual(visibility, { sun: theme === "light" ? "visible" : "hidden", moon: theme === "dark" ? "visible" : "hidden", colorScheme: theme });
}

async function waitFor(surface, predicate, arg) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await surface.evaluate(predicate, arg)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Theme check timed out: ${predicate}`);
}

async function openPrivatePopup(inspector, windowId, url) {
  await inspector.evaluate(id => chrome.windows.update(id, { focused: true }), windowId);
  await inspector.waitForTimeout(150);
  const worker = context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${new URL(url).host}/`));
  if (!worker) throw new Error("Extension worker unavailable");
  await worker.evaluate(id => chrome.action.openPopup({ windowId: id }), windowId);
  const targets = (await cdp.send("Target.getTargets")).targetInfos;
  for (const target of targets.filter(target => target.url === url)) {
    const surface = await attachTarget(target.targetId);
    if (await surface.evaluate(() => chrome.extension.getViews({ type: "popup" }).includes(window))) {
      await waitFor(surface, () => Boolean(document.querySelector("#themeToggle") && !document.querySelector("#themeToggle").disabled));
      await surface.evaluate(() => document.querySelector("#settingsButton").click());
      return surface;
    }
    await surface.detach();
  }
  throw new Error("Native incognito action popup was not exposed");
}

async function attachTarget(targetId) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false });
  let commandId = 0;
  const pending = new Map();
  const onMessage = event => {
    if (event.sessionId !== sessionId) return;
    const result = JSON.parse(event.message);
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    clearTimeout(request.timer);
    if (result.error) request.reject(new Error(result.error.message)); else request.resolve(result.result);
  };
  cdp.on("Target.receivedMessageFromTarget", onMessage);
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
      clearTimeout(timer); pending.delete(id); reject(error);
    });
  });
  const detach = async () => {
    cdp.off("Target.receivedMessageFromTarget", onMessage);
    await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  };
  return {
    async evaluate(fn, arg) {
      const result = await send("Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg) ?? "undefined"})`, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async screenshot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(file, Buffer.from(data, "base64"));
    },
    detach,
    async close() {
      await cdp.send("Target.sendMessageToTarget", { sessionId,
        message: JSON.stringify({ id: ++commandId, method: "Runtime.evaluate", params: { expression: "window.close()" } }) }).catch(() => {});
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (!(await cdp.send("Target.getTargets")).targetInfos.some(target => target.targetId === targetId)) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      await detach();
    }
  };
}
