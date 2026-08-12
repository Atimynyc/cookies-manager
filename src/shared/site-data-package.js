import { getSiteDataItemId } from "./item-identity.js";

export const SITE_DATA_SCHEMA_VERSION = 1;

const COOKIE_FIELDS = [
  "name",
  "value",
  "domain",
  "path",
  "expirationDate",
  "session",
  "secure",
  "httpOnly",
  "sameSite",
  "storeId",
  "hostOnly",
  "partitionKey"
];

export class SiteDataPackageError extends Error {
  constructor(message, { code = "INVALID_SITE_DATA_PACKAGE", path = "" } = {}) {
    super(message);
    this.name = "SiteDataPackageError";
    this.code = code;
    this.path = path;
  }
}

export function createSiteDataPackage({
  url,
  origin,
  cookies = [],
  localStorage = [],
  sessionStorage = [],
  exportedAt = new Date().toISOString()
} = {}) {
  const source = normalizeSource({ url, origin });
  const dataPackage = {
    schemaVersion: SITE_DATA_SCHEMA_VERSION,
    exportedAt: normalizeExportedAt(exportedAt),
    source,
    data: {
      cookies: cookies.map(serializeCookie),
      localStorage: localStorage.map((item) => serializeStorageItem({
        ...(item?.raw || item),
        origin: item?.origin || item?.raw?.origin || source.origin
      })),
      sessionStorage: sessionStorage.map((item) => serializeStorageItem({
        ...(item?.raw || item),
        origin: item?.origin || item?.raw?.origin || source.origin
      }))
    }
  };

  return validateSiteDataPackageV1(dataPackage);
}

export function parseSiteDataPackage(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new SiteDataPackageError(`Site data package is not valid JSON: ${error.message}`, {
        code: "INVALID_JSON"
      });
    }
  }

  if (!isPlainObject(value)) {
    throw new SiteDataPackageError("Site data package must be a JSON object.");
  }

  if (value.schemaVersion !== SITE_DATA_SCHEMA_VERSION) {
    throw new SiteDataPackageError(`Unsupported site data schema version: ${String(value.schemaVersion)}`, {
      code: "UNSUPPORTED_SCHEMA_VERSION",
      path: "schemaVersion"
    });
  }

  return validateSiteDataPackageV1(value);
}

export function tryParseSiteDataPackage(input) {
  try {
    return { success: true, data: parseSiteDataPackage(input), error: null };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error instanceof SiteDataPackageError
        ? error
        : new SiteDataPackageError(error?.message || "Failed to parse site data package.")
    };
  }
}

export function serializeCookie(cookieOrRow) {
  const cookie = cookieOrRow?.raw || cookieOrRow;
  if (!isPlainObject(cookie)) {
    throw new SiteDataPackageError("Cookie must be an object.", { path: "data.cookies" });
  }

  const serialized = {};
  for (const field of COOKIE_FIELDS) {
    if (cookie[field] !== undefined) {
      serialized[field] = cloneJsonValue(cookie[field]);
    }
  }

  assertNonEmptyString(serialized.name, "Cookie name", "data.cookies[].name");
  assertString(serialized.value, "Cookie value", "data.cookies[].value");
  assertNonEmptyString(serialized.domain, "Cookie domain", "data.cookies[].domain");
  serialized.path = typeof serialized.path === "string" && serialized.path ? serialized.path : "/";
  serialized.storeId = typeof serialized.storeId === "string" ? serialized.storeId : "";
  return serialized;
}

export function serializeStorageItem(itemOrRow) {
  const item = itemOrRow?.raw || itemOrRow;
  if (!isPlainObject(item)) {
    throw new SiteDataPackageError("Storage item must be an object.", { path: "data.storage" });
  }

  const key = item.key ?? item.name;
  assertString(key, "Storage key", "data.storage[].key");
  assertString(item.value, "Storage value", "data.storage[].value");
  const serialized = {
    key: String(key),
    value: String(item.value)
  };
  if (typeof item.origin === "string" && item.origin) {
    serialized.origin = normalizeOrigin(item.origin, "data.storage[].origin");
  }
  return serialized;
}

export function classifySiteDataItem(incoming, current, kind) {
  if (!current) {
    return "new";
  }

  const incomingId = getSiteDataItemId(kind, incoming);
  const currentId = getSiteDataItemId(kind, current);
  if (incomingId !== currentId) {
    return "new";
  }

  return areSiteDataItemsEqual(incoming, current, kind) ? "same" : "conflict";
}

export function areSiteDataItemsEqual(left, right, kind) {
  if (kind === "cookie" || kind === "cookies") {
    return JSON.stringify(serializeCookie(left)) === JSON.stringify(serializeCookie(right));
  }
  return JSON.stringify(serializeStorageItem(left)) === JSON.stringify(serializeStorageItem(right));
}

function validateSiteDataPackageV1(value) {
  const exportedAt = normalizeExportedAt(value.exportedAt);
  const source = normalizeSource(value.source);
  if (!isPlainObject(value.data)) {
    throw new SiteDataPackageError("Site data package data must be an object.", { path: "data" });
  }

  const cookies = requireArray(value.data.cookies, "data.cookies").map(serializeCookie);
  const localStorage = requireArray(value.data.localStorage, "data.localStorage")
    .map((item) => serializeStorageItem({ ...item, origin: item?.origin || source.origin }));
  const sessionStorage = requireArray(value.data.sessionStorage, "data.sessionStorage")
    .map((item) => serializeStorageItem({ ...item, origin: item?.origin || source.origin }));

  return {
    schemaVersion: SITE_DATA_SCHEMA_VERSION,
    exportedAt,
    source,
    data: { cookies, localStorage, sessionStorage }
  };
}

function normalizeSource(source = {}) {
  if (!isPlainObject(source)) {
    throw new SiteDataPackageError("Site data package source must be an object.", { path: "source" });
  }

  assertNonEmptyString(source.url, "Source URL", "source.url");
  let parsedUrl;
  try {
    parsedUrl = new URL(source.url);
  } catch {
    throw new SiteDataPackageError("Source URL is invalid.", { path: "source.url" });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new SiteDataPackageError("Source URL must use http or https.", { path: "source.url" });
  }

  const origin = source.origin || parsedUrl.origin;
  if (origin !== parsedUrl.origin) {
    throw new SiteDataPackageError("Source origin does not match the source URL.", { path: "source.origin" });
  }

  return { url: parsedUrl.href, origin };
}

function normalizeExportedAt(value) {
  assertNonEmptyString(value, "Export time", "exportedAt");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new SiteDataPackageError("Export time is invalid.", { path: "exportedAt" });
  }
  return date.toISOString();
}

function normalizeOrigin(value, path) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new SiteDataPackageError("Storage origin is invalid.", { path });
  }
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    throw new SiteDataPackageError(`${path} must be an array.`, { path });
  }
  return value;
}

function assertString(value, label, path) {
  if (typeof value !== "string") {
    throw new SiteDataPackageError(`${label} must be a string.`, { path });
  }
}

function assertNonEmptyString(value, label, path) {
  assertString(value, label, path);
  if (!value) {
    throw new SiteDataPackageError(`${label} cannot be empty.`, { path });
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}
