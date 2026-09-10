import assert from "node:assert/strict";
import test from "node:test";
import { installOperationBrowser } from "../helpers/operation-browser.mjs";
import { compareAndSetStorageItem } from "../../src/shared/storage-api.js";
import {
  createOperationDataAdapter,
  normalizeOperationItem,
  sameOperationValue
} from "../../src/shared/operation-data.js";

const TARGET = { tabId: 1, url: "https://example.com/app", origin: "https://example.com", cookieStoreId: "0", incognito: false };

function cookie(overrides = {}) {
  return {
    name: "token", value: "before", domain: "example.com", path: "/", session: true,
    secure: false, httpOnly: false, sameSite: "lax", storeId: "0", hostOnly: true,
    ...overrides
  };
}

function item(before = cookie(), after = cookie({ value: "after" })) {
  return normalizeOperationItem({ id: "cookie", kind: "cookies", before, after }, TARGET);
}

test("Storage CAS compares and writes in one page injection and distinguishes absent from empty values", async (t) => {
  const browser = installOperationBrowser(t);
  const added = await compareAndSetStorageItem(1, TARGET.url, "local", "flag", null, "");
  assert.equal(added.changed, true);
  assert.equal(added.current.value, "");
  const conflict = await compareAndSetStorageItem(1, TARGET.url, "local", "flag", null, "overwrite");
  assert.equal(conflict.changed, false);
  assert.equal(conflict.current.value, "");
  const deleted = await compareAndSetStorageItem(1, TARGET.url, "local", "flag", "", null);
  assert.equal(deleted.changed, true);
  assert.equal(deleted.current, null);
  assert.equal(browser.writes.length, 2);
});

test("Storage CAS preserves a change made after preparation but before page injection", async (t) => {
  const browser = installOperationBrowser(t);
  const storage = browser.getStorage(1, "local");
  storage.setItem("flag", "before");
  browser.beforeStorageScript = () => storage.setItem("flag", "external");
  const result = await compareAndSetStorageItem(1, TARGET.url, "local", "flag", "before", "after");
  assert.equal(result.changed, false);
  assert.equal(storage.getItem("flag"), "external");
  assert.equal(browser.writes.length, 0);
});

test("Storage CAS checks the actual document origin synchronously with the mutation", async (t) => {
  const browser = installOperationBrowser(t);
  browser.beforeStorageScript = () => browser.origins.set(1, "https://other.example");
  await assert.rejects(compareAndSetStorageItem(1, TARGET.url, "session", "flag", null, "after"), /changed sites/);
  assert.equal(browser.getStorage(1, "session").getItem("flag"), null);
  assert.equal(browser.writes.length, 0);
});

test("Storage CAS rejects unverified browser changes and preserves actionable failures", async (t) => {
  const browser = installOperationBrowser(t);
  const storage = browser.getStorage(1, "local");
  storage.setItem = () => {};
  await assert.rejects(compareAndSetStorageItem(1, TARGET.url, "local", "flag", null, "after"), /verified after writing/);
  await assert.rejects(compareAndSetStorageItem(1, TARGET.url, "local", "flag", undefined, "after"), /strings or null/);
  storage.setItem = () => { throw new Error("Site storage quota exceeded"); };
  await assert.rejects(compareAndSetStorageItem(1, TARGET.url, "local", "flag", null, "after"), /Site storage quota exceeded/);
});

test("the Storage operation adapter surfaces CAS conflicts without writing", async (t) => {
  const browser = installOperationBrowser(t);
  browser.getStorage(1, "local").setItem("flag", "external");
  const operation = normalizeOperationItem({
    kind: "localStorage", before: { key: "flag", value: "before" }, after: { key: "flag", value: "after" }
  }, TARGET);
  await assert.rejects(createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, operation.after), { code: "OPERATION_CONFLICT" });
  assert.equal(browser.writes.length, 0);
});

test("Cookie reads select complete domain, path, store, and partition identity", async (t) => {
  const browser = installOperationBrowser(t);
  const partitionKey = { topLevelSite: "https://example.com", hasCrossSiteAncestor: false };
  const expected = cookie({ path: "/account", partitionKey });
  browser.cookies.push(cookie(), cookie({ path: "/account", storeId: "1" }), cookie({ path: "/account" }), expected);
  const operation = item(expected, { ...expected, value: "after" });
  const read = await createOperationDataAdapter().read(operation, TARGET);
  assert.deepEqual(read, expected);
});

test("Cookie comparison includes every mutable attribute and normalizes field ordering", () => {
  const base = cookie({ session: false, expirationDate: 2000000000, partitionKey: { topLevelSite: "https://example.com", hasCrossSiteAncestor: false } });
  assert.equal(sameOperationValue("cookies", base, Object.fromEntries(Object.entries(base).reverse())), true);
  for (const changed of [
    { value: "external" }, { secure: true }, { httpOnly: true }, { sameSite: "strict" },
    { session: true }, { expirationDate: 1999999999 }, { hostOnly: false }, { path: "/other" },
    { domain: ".example.com" }, { storeId: "1" },
    { partitionKey: { topLevelSite: "https://elsewhere.example", hasCrossSiteAncestor: false } },
    { partitionKey: { topLevelSite: "https://example.com", hasCrossSiteAncestor: true } }
  ]) {
    assert.equal(sameOperationValue("cookies", base, { ...base, ...changed }), false, JSON.stringify(changed));
  }
});

test("Cookie mutations reject another store and unrelated or host-only parent domains", async (t) => {
  const browser = installOperationBrowser(t);
  const adapter = createOperationDataAdapter();
  for (const invalid of [
    cookie({ storeId: "1" }), cookie({ domain: "other.example" }), cookie({ domain: "com", hostOnly: true })
  ]) {
    const operation = item(null, invalid);
    await assert.rejects(adapter.compareAndWrite(operation, TARGET, null, operation.after), /store|domain/);
  }
  assert.equal(browser.writes.length, 0);
});

test("Cookie adapter preserves third-party changes detected before writing", async (t) => {
  const browser = installOperationBrowser(t);
  browser.cookies.push(cookie({ value: "external" }));
  const operation = item();
  await assert.rejects(createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, operation.after), { code: "OPERATION_CONFLICT" });
  assert.equal(browser.writes.length, 0);
  assert.equal(browser.cookies[0].value, "external");
});

test("Cookie adapter flags changes detected by the post-write read", async (t) => {
  const browser = installOperationBrowser(t);
  browser.cookies.push(cookie());
  browser.afterWrite = () => { browser.cookies[0].value = "external"; };
  const operation = item();
  await assert.rejects(createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, operation.after), { code: "OPERATION_CONFLICT" });
  assert.equal(browser.cookies[0].value, "external");
});

test("Cookie edits preserve empty names and deleting verifies the exact cookie is gone", async (t) => {
  const browser = installOperationBrowser(t);
  const before = cookie({ name: "" });
  browser.cookies.push(before);
  const operation = item(before, { ...before, value: "after" });
  const adapter = createOperationDataAdapter();
  const written = await adapter.compareAndWrite(operation, TARGET, operation.before, operation.after);
  assert.equal(written.name, "");
  assert.equal(written.value, "after");
  const deletion = item(written, null);
  assert.equal(await adapter.compareAndWrite(deletion, TARGET, deletion.before, null), null);
  assert.equal(browser.cookies.length, 0);
});

test("Cookie deletion rejects a same-name browser candidate with another domain before removal", async (t) => {
  const browser = installOperationBrowser(t);
  const expected = cookie();
  browser.cookies.push(cookie({ domain: ".example.com", hostOnly: false }), expected);
  const operation = item(expected, null);
  await assert.rejects(createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, null), /different same-name cookie/);
  assert.equal(browser.cookies.length, 2);
  assert.equal(browser.writes.length, 0);
});

test("Cookie deletion rejects a missing browser candidate instead of assuming removal succeeded", async (t) => {
  const browser = installOperationBrowser(t);
  browser.cookies.push(cookie());
  chrome.cookies.get = (_details, callback) => callback(null);
  const operation = item(cookie(), null);
  await assert.rejects(createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, null), /different same-name cookie/);
  assert.equal(browser.writes.length, 0);
});

test("Cookie expiration clamping is accepted only when the API result and observed cookie agree", async (t) => {
  const browser = installOperationBrowser(t);
  const before = cookie({ session: false, expirationDate: 1900000000 });
  browser.cookies.push(before);
  const operation = item(before, { ...before, expirationDate: 2200000000 });
  const setCookie = chrome.cookies.set;
  chrome.cookies.set = (details, callback) => setCookie({ ...details, expirationDate: 2000000000 }, callback);
  const actual = await createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, operation.after);
  assert.equal(actual.expirationDate, 2000000000);
  assert.equal(operation.after.expirationDate, 2200000000);
});

test("Cookie normalization never accepts an unrelated attribute change as expiration clamping", async (t) => {
  const browser = installOperationBrowser(t);
  const before = cookie({ session: false, expirationDate: 1900000000 });
  browser.cookies.push(before);
  const operation = item(before, { ...before, expirationDate: 2200000000 });
  const setCookie = chrome.cookies.set;
  chrome.cookies.set = (details, callback) => setCookie({ ...details, expirationDate: 2000000000, httpOnly: true }, callback);
  await assert.rejects(createOperationDataAdapter().compareAndWrite(operation, TARGET, operation.before, operation.after), { code: "OPERATION_CONFLICT" });
});
