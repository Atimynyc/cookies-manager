import assert from "node:assert/strict";
import test from "node:test";

import { makeCookieId, makeStorageId } from "../../src/shared/item-identity.js";
import { executeBatchOperation, skipBatchOperation } from "../../src/shared/batch-operations.js";
import {
  addOperationFailure,
  addOperationSkip,
  addOperationSuccess,
  createBatchOperationResult,
  getBatchOperationCounts
} from "../../src/shared/operation-result.js";
import { parseNameValuePair } from "../../src/shared/pair-parser.js";
import { normalizeCookieTemplates } from "../../src/shared/settings-store.js";
import {
  COLUMN_WIDTHS_VERSION,
  DEFAULT_COLUMN_WIDTHS,
  migrateColumnWidths
} from "../../src/popup/popup-config.js";
import {
  makeFavoriteItemId,
  normalizeFavoriteItemIds,
  sortFavoriteRowsFirst
} from "../../src/shared/favorites.js";
import {
  classifySiteDataItem,
  createSiteDataPackage,
  parseSiteDataPackage,
  serializeCookie,
  serializeStorageItem,
  tryParseSiteDataPackage
} from "../../src/shared/site-data-package.js";

test("parses cookie and storage name=value pairs without truncating values", () => {
  assert.deepEqual(parseNameValuePair("Cookie: token=a=b=c; Path=/"), { name: "token", value: "a=b=c" });
  assert.deepEqual(parseNameValuePair("feature = enabled=true", { kind: "storage" }), {
    name: "feature",
    value: " enabled=true"
  });
  assert.throws(() => parseNameValuePair("bad name=value"), /Cookie name is invalid/);
});

test("creates stable cookie and storage item identities", () => {
  assert.equal(makeCookieId({
    storeId: "0",
    partitionKey: { topLevelSite: "https://top.example", hasCrossSiteAncestor: false },
    domain: ".example.com",
    path: "/app",
    name: "session"
  }), encodeURIComponent(JSON.stringify(["0", "https://top.example", "false", ".example.com", "/app", "session"])));
  assert.equal(makeStorageId({ type: "local", origin: "https://example.com", key: "theme" }),
    encodeURIComponent(JSON.stringify(["local", "https://example.com", "theme"])));
  assert.notEqual(
    makeStorageId({ type: "local", origin: "https://example.com", key: "a|b" }),
    makeStorageId({ type: "local", origin: "https://example.com|a", key: "b" })
  );
});

test("serializes cookies and storage using protocol-safe fields", () => {
  assert.deepEqual(serializeCookie({
    name: "token",
    value: "secret",
    domain: "example.com",
    path: "/",
    storeId: "0",
    ignored: "not exported"
  }), {
    name: "token",
    value: "secret",
    domain: "example.com",
    path: "/",
    storeId: "0"
  });
  assert.deepEqual(serializeStorageItem({ key: "flag", value: "1", origin: "https://example.com" }), {
    key: "flag",
    value: "1",
    origin: "https://example.com"
  });
});

test("creates and parses a normalized v1 site data package", () => {
  const dataPackage = createSiteDataPackage({
    url: "https://example.com/path",
    exportedAt: "2026-08-11T10:00:00.000Z",
    cookies: [{ name: "token", value: "abc", domain: "example.com", path: "/", storeId: "0" }],
    localStorage: [{ key: "theme", value: "dark" }],
    sessionStorage: [{ key: "step", value: "2" }]
  });

  assert.equal(dataPackage.schemaVersion, 1);
  assert.deepEqual(dataPackage.source, {
    url: "https://example.com/path",
    origin: "https://example.com"
  });
  assert.equal(dataPackage.data.localStorage[0].origin, "https://example.com");
  assert.deepEqual(parseSiteDataPackage(JSON.stringify(dataPackage)), dataPackage);
});

test("rejects invalid or unsupported packages without returning partial data", () => {
  const invalidJson = tryParseSiteDataPackage("{oops");
  assert.equal(invalidJson.success, false);
  assert.equal(invalidJson.data, null);
  assert.equal(invalidJson.error.code, "INVALID_JSON");

  const unsupported = tryParseSiteDataPackage({ schemaVersion: 2 });
  assert.equal(unsupported.success, false);
  assert.equal(unsupported.error.code, "UNSUPPORTED_SCHEMA_VERSION");
});

test("classifies matching site data items for conflict previews", () => {
  const current = { type: "local", origin: "https://example.com", key: "flag", value: "off" };
  assert.equal(classifySiteDataItem({ ...current, value: "off" }, current, "local"), "same");
  assert.equal(classifySiteDataItem({ ...current, value: "on" }, current, "local"), "conflict");
  assert.equal(classifySiteDataItem({ ...current, key: "other" }, current, "local"), "new");
});

test("aggregates success, failure and skipped batch operation results", () => {
  const result = createBatchOperationResult();
  addOperationSuccess(result, { id: "one" });
  const chromeError = Object.assign(new Error("Chrome rejected the write"), { code: "COOKIE_WRITE_FAILED" });
  const failure = addOperationFailure(result, { id: "two" }, chromeError);
  addOperationSkip(result, { id: "three" }, "Conflict strategy");

  assert.equal(failure.rawError, chromeError);
  assert.deepEqual(failure.error, {
    name: "Error",
    message: "Chrome rejected the write",
    code: "COOKIE_WRITE_FAILED"
  });
  assert.deepEqual(getBatchOperationCounts(result), { success: 1, failed: 1, skipped: 1, total: 3 });
});

test("normalizes locally stored cookie templates", () => {
  assert.deepEqual(normalizeCookieTemplates([
    null,
    { label: "Valid", value: "one" },
    { label: "Missing value" }
  ]), [{ label: "Valid", value: "one" }]);
});

test("normalizes favorite site data identities", () => {
  const cookieId = makeFavoriteItemId("cookies", "cookie-id");
  const localId = makeFavoriteItemId("localStorage", "storage-id");

  assert.equal(cookieId, "cookies:cookie-id");
  assert.equal(localId, "localStorage:storage-id");
  assert.deepEqual(normalizeFavoriteItemIds([cookieId, null, cookieId, "", localId]), [cookieId, localId]);
  assert.throws(() => makeFavoriteItemId("unknown", "item-id"), /supported data view/);
});

test("puts favorites first while preserving the existing order within each group", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const favorites = new Set([
    makeFavoriteItemId("localStorage", "b"),
    makeFavoriteItemId("localStorage", "d")
  ]);

  assert.deepEqual(
    sortFavoriteRowsFirst(rows, favorites, "localStorage").map((row) => row.id),
    ["b", "d", "a", "c"]
  );
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d"]);
});

test("migrates legacy table widths to a two-field viewport layout", () => {
  const legacyWidths = [127, 150, 130, 84, 116, 92, 58];
  assert.deepEqual(migrateColumnWidths(legacyWidths, 0), DEFAULT_COLUMN_WIDTHS);

  const customizedWidths = [120, 150, 150, 84, 116, 92, 58];
  assert.deepEqual(
    migrateColumnWidths(customizedWidths, COLUMN_WIDTHS_VERSION),
    customizedWidths
  );
});

test("executes every item in a batch and preserves partial failures", async () => {
  const result = await executeBatchOperation([
    { id: "success" },
    { id: "failure" },
    { id: "skipped" }
  ], async (item) => {
    if (item.id === "failure") {
      throw new Error("write failed");
    }
    if (item.id === "skipped") {
      return skipBatchOperation("conflict");
    }
    return "saved";
  });

  assert.equal(result.success[0].value, "saved");
  assert.equal(result.failed[0].error.message, "write failed");
  assert.equal(result.skipped[0].reason, "conflict");
});
