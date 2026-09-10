import { callChrome } from "./chrome-call.js";
import { setCookieData, removeCookie } from "./cookie-api.js";
import { getSiteDataItemId } from "./item-identity.js";
import { assertOperationContext, createOperationContext } from "./operation-context.js";
import { compareAndSetStorageItem, getStorageItems } from "./storage-api.js";
import { getCookieScopedUrl, parseHttpUrl } from "./url.js";

export const OPERATION_KINDS = new Set(["cookies", "localStorage", "sessionStorage"]);

export function normalizeOperationTarget(value) {
  if (!value || typeof value.incognito !== "boolean" || typeof value.cookieStoreId !== "string") {
    throw new Error("The operation requires a complete verified target.");
  }
  const target = createOperationContext({ id: value.tabId, url: value.url, incognito: value.incognito }, value.cookieStoreId);
  if (target.origin !== value.origin) {
    throw new Error("The operation target origin is invalid.");
  }
  return target;
}

export function normalizeOperationItem(value, target, index = 0) {
  if (!value || !OPERATION_KINDS.has(value.kind)) {
    throw new Error("The operation item type is not supported.");
  }
  if (value.before === undefined || value.after === undefined || (!value.before && !value.after)) {
    throw new Error("An operation item requires its before and after states.");
  }
  const before = normalizeValue(value.kind, value.before, target);
  const after = normalizeValue(value.kind, value.after, target);
  if (before && after && getSiteDataItemId(value.kind, before) !== getSiteDataItemId(value.kind, after)) {
    throw new Error("An operation cannot change an item's identity. Delete and create separate items instead.");
  }
  const item = {
    id: String(value.id || `${index}-${getSiteDataItemId(value.kind, after || before)}`),
    kind: value.kind,
    name: value.kind === "cookies" ? (after || before).name : (after || before).key,
    before,
    after,
    state: "pending"
  };
  return item;
}

export function sameOperationValue(kind, left, right) {
  if (left === null || right === null) return left === right;
  if (kind === "cookies") {
    return JSON.stringify(comparableCookie(left)) === JSON.stringify(comparableCookie(right));
  }
  return left.key === right.key && left.value === right.value && left.origin === right.origin;
}

export function validateUndoTarget(original, next, items) {
  const target = normalizeOperationTarget(next || original);
  if (target.origin !== original.origin || target.cookieStoreId !== original.cookieStoreId || target.incognito !== original.incognito) {
    throw new Error("Undo requires the original site, cookie store, and browsing mode.");
  }
  if (target.tabId !== original.tabId && items.some((item) => item.kind === "sessionStorage")) {
    throw new Error("Session Storage undo requires the original tab.");
  }
  return target;
}

export function createOperationDataAdapter() {
  async function read(item, target) {
    await assertOperationContext(target);
    assertItemScope(item, target);
    const identity = item.after || item.before;
    if (item.kind === "cookies") {
      const details = { domain: identity.domain.replace(/^\./, ""), name: identity.name, storeId: target.cookieStoreId };
      if (identity.partitionKey) details.partitionKey = identity.partitionKey;
      const cookies = await callChrome("cookies.getAll", details);
      return cookies.find((cookie) => getSiteDataItemId("cookies", cookie) === getSiteDataItemId("cookies", identity)) || null;
    }
    const values = await getStorageItems(target.tabId, target.url, storageType(item.kind));
    return values.find((value) => value.key === identity.key) || null;
  }

  async function compareAndWrite(item, target, expected, desired) {
    await assertOperationContext(target);
    assertItemScope(item, target);
    if (item.kind !== "cookies") {
      const result = await compareAndSetStorageItem(
        target.tabId, target.url, storageType(item.kind), (desired || expected).key,
        expected?.value ?? null, desired?.value ?? null
      );
      if (!result.changed) throw conflictError();
      return result.current;
    }
    const current = await read(item, target);
    if (!sameOperationValue(item.kind, current, expected)) throw conflictError();
    // Chrome cookies has no atomic CAS. Serialize extension writes and verify both sides.
    await assertOperationContext(target);
    if (desired) {
      const saved = await setCookieData(getCookieScopedUrl(desired, target.url), desired);
      const actual = await read(item, target);
      if (sameOperationValue(item.kind, actual, desired)) return actual;
      if (saved && actual && sameOperationValue(item.kind, actual, saved) &&
        canAcceptCookieExpiration(desired, actual)) {
        return actual;
      }
      throw conflictError("The cookie changed during writing or Chrome normalized unsupported attributes. Review its current state before retrying.");
    } else {
      const details = {
        url: getCookieScopedUrl(expected, target.url),
        name: expected.name,
        storeId: target.cookieStoreId
      };
      if (expected.partitionKey) details.partitionKey = expected.partitionKey;
      const candidate = await callChrome("cookies.get", details);
      if (!candidate || getSiteDataItemId("cookies", candidate) !== getSiteDataItemId("cookies", expected)) {
        throw conflictError("Chrome would remove a different same-name cookie. Its data was preserved.");
      }
      await removeCookie(target.url, expected);
    }
    const actual = await read(item, target);
    if (!sameOperationValue(item.kind, actual, desired)) {
      throw conflictError("The cookie changed during writing or Chrome normalized its attributes. Review its current state before retrying.");
    }
    return actual;
  }

  return { read, compareAndWrite, verifyTarget: assertOperationContext };
}

export function conflictError(message = "This item changed after the operation was prepared. Its current data was preserved.") {
  const error = new Error(message);
  error.code = "OPERATION_CONFLICT";
  return error;
}

function normalizeValue(kind, value, target) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Operation item states must be objects or null.");
  }
  if (kind !== "cookies") {
    const key = value.key ?? value.name;
    if (typeof key !== "string" || !key || typeof value.value !== "string") {
      throw new Error("Storage operations require a key and a string value.");
    }
    if (value.origin && value.origin !== target.origin) {
      throw new Error("The storage item belongs to a different origin.");
    }
    return { type: storageType(kind), key, value: value.value, origin: target.origin };
  }
  if (typeof value.name !== "string" || typeof value.value !== "string" || typeof value.domain !== "string") {
    throw new Error("Cookie operations require a name, value, and domain.");
  }
  return comparableCookie({ ...value, storeId: value.storeId || target.cookieStoreId });
}

function canAcceptCookieExpiration(requested, actual) {
  return !requested.session && !actual.session &&
    Number.isFinite(actual.expirationDate) && Number.isFinite(requested.expirationDate) &&
    actual.expirationDate <= requested.expirationDate &&
    sameOperationValue("cookies", requested, { ...actual, expirationDate: requested.expirationDate });
}

function assertItemScope(item, target) {
  for (const cookie of [item.before, item.after].filter(Boolean)) {
    if (item.kind !== "cookies") {
      if (cookie.origin !== target.origin) throw new Error("The storage item belongs to a different origin.");
      continue;
    }
    if (!target.cookieStoreId || cookie.storeId !== target.cookieStoreId) {
      throw new Error("The cookie store does not match the target browsing context.");
    }
    const host = parseHttpUrl(target.url).hostname;
    const domain = cookie.domain.replace(/^\./, "");
    if (!domain || (host !== domain && (cookie.hostOnly || !host.endsWith(`.${domain}`)))) {
      throw new Error("The cookie domain is outside the target site.");
    }
    if (!cookie.path.startsWith("/") || (cookie.secure && !target.url.startsWith("https:"))) {
      throw new Error("The cookie scope is not supported by the target site.");
    }
  }
}

function comparableCookie(value) {
  const session = typeof value.session === "boolean" ? value.session : !Number.isFinite(value.expirationDate);
  const result = {
    name: value.name,
    value: value.value,
    domain: String(value.domain || "").toLowerCase(),
    path: value.path || "/",
    session,
    secure: Boolean(value.secure),
    httpOnly: Boolean(value.httpOnly),
    sameSite: value.sameSite || "unspecified",
    storeId: value.storeId || "",
    hostOnly: typeof value.hostOnly === "boolean" ? value.hostOnly : !String(value.domain || "").startsWith(".")
  };
  if (!session) result.expirationDate = value.expirationDate;
  if (value.partitionKey) {
    result.partitionKey = {
      topLevelSite: value.partitionKey.topLevelSite,
      hasCrossSiteAncestor: Boolean(value.partitionKey.hasCrossSiteAncestor)
    };
  }
  return result;
}

function storageType(kind) {
  return kind === "sessionStorage" ? "session" : "local";
}
