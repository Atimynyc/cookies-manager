import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { messageKey } from "../src/shared/i18n.js";
import { UI_LANGUAGES } from "../src/shared/ui-preferences.js";
import { createAcceptanceExtension } from "./acceptance-extension-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "output", "playwright", "locales");
const selected = process.argv.find(value => value.startsWith("--locales="))?.slice(10).split(",");
const cases = [["en-US", "en"], ["zh-CN", "zh_CN"], ["zh-TW", "zh_TW"], ["es", "es"],
  ["pt-BR", "pt_BR"], ["de", "de"], ["fr", "fr"], ["ja", "ja"], ["ro-RO", "ro"], ["it-IT", "en"]]
  .filter(([language]) => !selected || selected.includes(language));
const fixture = '<!doctype html><title>Localization fixture</title><body>Local test data<script>localStorage.setItem("Name", "Save changes");sessionStorage.setItem("Value", "Delete");</script></body>';
const server = createServer((request, response) => { response.setHeader("Content-Type", "text/html"); response.end(fixture); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = [];
const extensionFixture = await createAcceptanceExtension(root);
await mkdir(artifacts, { recursive: true });

try {
  for (const [language, locale] of cases) {
    const profile = await mkdtemp(path.join(tmpdir(), "cookie-controller-locales-"));
    let context;
    const errors = [];
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium", headless: true, locale: language,
        viewport: { width: 760, height: 800 },
        args: [`--lang=${language}`, `--disable-extensions-except=${extensionFixture.extensionRoot}`, `--load-extension=${extensionFixture.extensionRoot}`]
      });
      context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
      const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
      const extensionId = new URL(worker.url()).host;
      const site = await context.newPage();
      await site.goto(origin);
      const original = '$1 <script> & "Save changes"';
      await context.addCookies([{ url: origin, name: "Delete", value: original }]);
      const popup = await context.newPage();
      const url = `chrome-extension://${extensionId}/src/popup/popup.html`;
      await popup.goto(url);
      await site.bringToFront();
      await popup.reload();
      await waitForSiteAccess(popup);
      assert.equal(await popup.locator("html").getAttribute("lang"), locale.replaceAll("_", "-"));
      assert.equal(await popup.locator("#languageSelect").inputValue(), locale, "First install selects the matching concrete language");
      assert.equal(await popup.locator('#languageSelect option[value="auto"]').count(), 0);
      assert.equal(await popup.locator("#languageSelect option").count(), UI_LANGUAGES.length);
      assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get("uiLanguage")).uiLanguage), locale);
      const catalog = JSON.parse(await readFile(path.join(root, "_locales", locale, "messages.json"), "utf8"));
      const translated = source => catalog[messageKey(source)]?.message || source;
      const label = (await popup.locator("#nameSortLabel").textContent()).trim();
      assert.equal(label, translated("Name"));
      assert.equal(await popup.locator("#importButton").innerText(), translated("Import"));
      assert.equal(await popup.locator("#copyButton").getAttribute("aria-label"), translated("Copy value"));
      assert.equal(await popup.locator(".name-cell-text").innerText(), "Delete");
      assert.equal(await popup.locator(".value-cell-text").innerText(), original);
      assert.equal(await popup.locator("#cookieTableBody script").count(), 0);
      await popup.locator("#cookieTableBody tr").click();
      assert.equal(await popup.locator("#valueInput").inputValue(), original);
      await popup.locator("#valueInput").fill("Name");
      await popup.locator("#saveButton").click();
      await popup.waitForFunction(() => document.querySelector("#statusMessage").textContent.includes("Delete"));
      assert.equal((await context.cookies(origin)).find(cookie => cookie.name === "Delete").value, "Name");
      await popup.screenshot({ path: path.join(artifacts, `${language}-overview.png`) });

      await popup.locator("#importButton").click();
      await popup.locator(".cookie-import-name").first().fill("locale_import");
      await popup.locator(".cookie-import-value").first().fill("Value");
      const quickSubmit = popup.locator("#quickImportButton");
      await quickSubmit.click();
      await popup.waitForFunction(() => document.querySelector("#statusBar").classList.contains("is-success"));
      assert.equal((await context.cookies(origin)).find(cookie => cookie.name === "locale_import")?.value, "Value");
      await popup.locator("#exportButton").click();
      await popup.locator("#allExportScope").check();
      await popup.waitForFunction(() => {
        try { return JSON.parse(document.querySelector("#packageExportPreview").value).data.localStorage.length > 0; } catch { return false; }
      });
      const data = JSON.parse(await popup.locator("#packageExportPreview").inputValue());
      assert.deepEqual(Object.keys(data.data).sort(), ["cookies", "localStorage", "sessionStorage"]);
      assert.equal(data.data.cookies.find(cookie => cookie.name === "Delete").value, "Name");
      assert.equal(data.data.localStorage.find(item => item.key === "Name").value, "Save changes");
      assert.equal(data.data.sessionStorage.find(item => item.key === "Value").value, "Delete");
      const nativeValues = await popup.evaluate(async () => {
        const { t } = await import(chrome.runtime.getURL("src/shared/i18n.js"));
        return t`Delete ${'$1 <b>data</b>'}?`;
      });
      assert.ok(nativeValues.includes('$1 <b>data</b>'), "Native substitution must preserve the exact data");
      assert.ok(!nativeValues.includes("$slot_"), "Native placeholders must be resolved");
      await popup.screenshot({ path: path.join(artifacts, `${language}-export.png`) });
      await popup.locator('input[name="packageExportFormat"][value="netscape"]').check();
      await popup.waitForFunction(() => document.querySelector("#packageExportPreview").value.startsWith("# Netscape HTTP Cookie File"));
      assert.ok((await popup.locator("#packageExportPreview").inputValue()).includes("\tDelete\tName"));

      await popup.locator("#workbenchCloseButton").click();
      for (const [view, key, value] of [["localStorage", "Name", "Save changes"], ["sessionStorage", "Value", "Delete"]]) {
        await popup.locator(`button[data-view="${view}"]`).click();
        await popup.waitForFunction(expected => document.querySelector(".name-cell-text")?.textContent === expected, key);
        assert.equal(await popup.locator(".value-cell-text").innerText(), value);
        await popup.locator("#cookieTableBody tr").click();
        assert.equal(await popup.locator("#valueInput").inputValue(), value);
        await popup.locator("#exportButton").click();
        assert.equal(await popup.locator("#netscapeExportFormatLabel").isHidden(), true);
        await popup.locator("#workbenchCloseButton").click();
      }
      await popup.setViewportSize({ width: 380, height: 800 });
      await site.bringToFront();
      await popup.goto(`${url}?surface=sidepanel`);
      await waitForSiteAccess(popup);
      await popup.locator("#cookiesViewButton").click();
      await popup.waitForFunction(() => document.querySelector("#cookiesViewButton").getAttribute("aria-pressed") === "true"
        && [...document.querySelectorAll(".name-cell-text")].some(element => element.textContent === "Delete"));
      const layout = await popup.evaluate(() => {
        const root = document.documentElement;
        const topbar = document.querySelector(".topbar");
        return { width: root.clientWidth, scroll: root.scrollWidth, topbarWidth: topbar.clientWidth, topbarScroll: topbar.scrollWidth };
      });
      assert.ok(layout.scroll <= layout.width + 1, `${language}: side panel overflows: ${JSON.stringify(layout)}`);
      assert.ok(layout.topbarScroll <= layout.topbarWidth + 1, `${language}: navigation overflows`);
      const actionsFit = await popup.locator(".table-global-toolbar").evaluate(toolbar => {
        const bounds = toolbar.getBoundingClientRect();
        return [...toolbar.querySelectorAll("button")].every(button => {
          const box = button.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right
            && button.scrollWidth <= button.clientWidth + 1;
        });
      });
      assert.ok(actionsFit, `${language}: site action buttons are clipped`);
      await popup.screenshot({ path: path.join(artifacts, `${language}-sidepanel.png`) });
      await popup.locator("#profilesButton").click();
      await popup.locator("#profileHelpButton").click();
      assert.equal(await popup.locator("#profileHelpDialog code").first().innerText(), "userId=42");
      await popup.screenshot({ path: path.join(artifacts, `${language}-sidepanel-help.png`) });
      if (language === "en-US") {
        await popup.locator("#profileHelpCloseButton").click();
        await popup.locator("#workbenchCloseButton").click();
        try { await verifySettings(context, popup, site, url); }
        catch (error) {
          await popup.screenshot({ path: path.join(artifacts, "settings-failure.png") });
          throw error;
        }
      }
      assert.deepEqual(errors, []);
      report.push({ language, locale, label, layout, passed: true });
      console.log(`${language}: localized UI, literal data, edit/import/export, and narrow side panel passed`);
    } finally {
      await context?.close();
      assert.ok(profile.startsWith(path.join(tmpdir(), "cookie-controller-locales-")));
      await rm(profile, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await extensionFixture.cleanup();
  await writeFile(path.join(artifacts, selected ? `report-${selected.join("-")}.json` : "report.json"), JSON.stringify(report, null, 2));
}

async function verifySettings(context, popup, site, url) {
  assert.equal(await popup.locator(".column-resizer").count(), 7);
  await popup.locator("#cookieTableBody tr").filter({ hasText: "locale_import" }).click();
  const draft = '$1 <b>unsaved</b> & "Save"';
  await popup.locator("#valueInput").fill(draft);
  await popup.evaluate(() => { window.__languageSwitchSentinel = "unchanged"; });
  await popup.locator("#settingsButton").click();
  assert.equal(await popup.locator("#settingsButton").getAttribute("aria-expanded"), "true");
  for (const locale of [...UI_LANGUAGES.filter(language => language.value !== "en").map(language => language.value), "en"]) {
    await popup.locator("#languageSelect").selectOption(locale);
    await popup.waitForFunction(language => document.documentElement.lang === language.replaceAll("_", "-"), locale);
    const catalog = JSON.parse(await readFile(path.join(root, "_locales", locale, "messages.json"), "utf8"));
    const text = source => catalog[messageKey(source)].message;
    assert.equal(await popup.locator("#settingsTitle").textContent(), text("Settings"));
    assert.equal(await popup.locator("#importButton").innerText(), text("Import"));
    assert.equal((await popup.locator("#nameSortLabel").textContent()).trim(), text("Name"));
    assert.equal(await popup.locator("#copyButton").getAttribute("aria-label"), text("Copy value"));
    assert.equal(await popup.locator("#valueInput").inputValue(), draft);
    assert.equal(await popup.evaluate(() => window.__languageSwitchSentinel), "unchanged");
    assert.equal(await popup.locator(".column-resizer").count(), 7, "Language switching preserves column resize controls");
    const substituted = await popup.evaluate(async () => {
      const { t } = await import(chrome.runtime.getURL("src/shared/i18n.js"));
      return t`Delete ${'$1 <b>data</b>'}?`;
    });
    assert.ok(substituted.includes('$1 <b>data</b>'));
  }
  assert.equal(await popup.locator("#themeSelect").count(), 0);
  assert.equal(await popup.locator("#themeToggle").getAttribute("aria-checked"), "false");
  await popup.locator("#themeToggle").click();
  await popup.waitForFunction(() => document.documentElement.dataset.theme === "incognito");
  await popup.locator("#languageSelect").selectOption("zh_CN");
  await popup.waitForFunction(() => document.documentElement.lang === "zh-CN");
  const bounds = await popup.locator("#settingsMenu").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 381, "Settings fit the narrow side panel");
  await popup.screenshot({ path: path.join(artifacts, "settings-zh-CN-dark.png") });
  await popup.keyboard.press("Escape");
  assert.equal(await popup.locator("#settingsMenu").isHidden(), true);
  assert.equal(await popup.locator("#settingsButton").evaluate(button => button === document.activeElement), true);
  assert.equal((await context.cookies(origin)).find(cookie => cookie.name === "locale_import").value, "Value");

  const second = await context.newPage();
  await site.bringToFront();
  await second.goto(url);
  await waitForSiteAccess(second);
  assert.equal(await second.locator("html").getAttribute("lang"), "zh-CN");
  assert.equal(await second.locator("html").getAttribute("data-theme"), "incognito");
  await second.locator("#settingsButton").click();
  assert.equal(await second.locator("#languageSelect").inputValue(), "zh_CN");
  assert.equal(await second.locator("#themeToggle").getAttribute("aria-checked"), "true");
  await second.locator("#themeToggle").click();
  await popup.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await second.screenshot({ path: path.join(artifacts, "settings-zh-CN-light-popup.png") });
  await second.emulateMedia({ colorScheme: "dark" });
  assert.equal(await second.locator("html").getAttribute("data-theme"), "light");
  await second.emulateMedia({ colorScheme: "light" });
  assert.equal(await second.locator("html").getAttribute("data-theme"), "light");
  await second.locator("#languageSelect").selectOption("de");
  await popup.waitForFunction(() => document.documentElement.lang === "de");
  assert.equal(await popup.locator("#valueInput").inputValue(), draft);
  await second.locator("#settingsButton").click();
  await second.locator("#profilesButton").click();
  await second.locator("#profileHelpButton").click();
  assert.equal(await second.locator("#profileHelpDialog code").first().innerText(), "userId=42");
  await popup.locator("#settingsButton").click();
  await popup.locator("#languageSelect").selectOption("ja");
  await second.waitForFunction(() => document.documentElement.lang === "ja");
  assert.equal(await second.locator("#profileHelpDialog code").first().innerText(), "userId=42");
  assert.equal(await second.locator("#profileHelpDialog strong").first().innerText(), JSON.parse(await readFile(path.join(root, "_locales/ja/messages.json"), "utf8"))[messageKey("Save current state")].message);
  await second.locator("#profileHelpCloseButton").click();
  await second.locator("#workbenchCloseButton").click();
  await second.locator("#historyViewButton").click();
  await second.locator(".history-detail-button").first().click();
  const historyTitle = await second.locator("#historyDetailTitle").textContent();
  await popup.locator("#languageSelect").selectOption("en");
  await second.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(await second.locator("#historyDetail").isVisible(), true);
  assert.equal(await second.locator("#historyDetailGrid dt").first().textContent(), "Action");
  assert.notEqual(await second.locator("#historyDetailTitle").textContent(), historyTitle);
  await popup.locator("#settingsButton").click();
  const resize = popup.locator('th[data-column-index="1"] .column-resizer');
  const previousWidth = await popup.evaluate(() => document.documentElement.style.getPropertyValue("--cookie-col-value"));
  await resize.focus();
  await popup.keyboard.press("ArrowRight");
  assert.notEqual(await popup.evaluate(() => document.documentElement.style.getPropertyValue("--cookie-col-value")), previousWidth,
    "Column resize handlers still work after live language changes");
  await popup.locator("#settingsButton").focus();
  await popup.keyboard.press("ArrowDown");
  assert.equal(await popup.locator("#languageSelect").evaluate(element => element === document.activeElement), true);
  await popup.keyboard.press("Escape");
  await second.close();
  console.log("settings: all manual languages, live drafts, cross-surface preferences, themes, keyboard and nested help passed");
}

async function waitForSiteAccess(page) {
  await page.waitForFunction(() => {
    const loading = document.querySelector("#loadingState");
    const permission = document.querySelector("#siteAccessDialog");
    const hasRows = document.querySelectorAll("#cookieTableBody tr").length > 0;
    return loading?.hidden && (hasRows || permission?.open);
  });
  if (await page.locator("#siteAccessDialog").isVisible()) {
    await page.locator("#siteAccessDialogAllowButton").click();
    await page.waitForFunction(() => document.querySelector("#siteAccessDialog")?.open === false);
  }
  await page.waitForSelector("#cookieTableBody tr");
}
