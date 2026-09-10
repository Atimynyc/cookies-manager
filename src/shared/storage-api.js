import { isSupportedPageUrl } from "./url.js";
import { callChrome } from "./chrome-call.js";

const STORAGE_TYPES = new Set(["local", "session"]);

export async function getStorageItems(tabId, url, type) {
  const result = await executeStorageOperation(tabId, url, type, "read");
  return result.items;
}

export async function setStorageValue(tabId, url, type, key, value) {
  assertStorageKey(key);
  const result = await executeStorageOperation(tabId, url, type, "set", key, String(value));
  return {
    type,
    key,
    value: result.value,
    origin: result.origin
  };
}

export async function setStoragePair(tabId, url, type, key, value) {
  return setStorageValue(tabId, url, type, key, value);
}

export async function removeStorageItem(tabId, url, type, key) {
  assertStorageKey(key);
  return executeStorageOperation(tabId, url, type, "remove", key);
}

export async function compareAndSetStorageItem(tabId, url, type, key, expected, desired) {
  assertStorageKey(key);
  for (const value of [expected, desired]) {
    if (value !== null && typeof value !== "string") {
      throw new TypeError("Conditional storage values must be strings or null.");
    }
  }
  const result = await executeStorageOperation(tabId, url, type, "compare-set", key, desired, expected);
  return {
    changed: result.changed,
    current: result.value === null ? null : { type, key, value: result.value, origin: result.origin }
  };
}

async function executeStorageOperation(tabId, url, type, action, key = "", value = "", expected = null) {
  assertStorageRequest(tabId, url, type);
  const expectedOrigin = new URL(url).origin;
  const injections = await callChrome("scripting.executeScript", {
    target: { tabId },
    func: operateStorageInPage,
    args: [type, expectedOrigin, action, key, value, expected]
  });
  const result = injections?.[0]?.result;
  if (!result?.ok || result.origin !== expectedOrigin) {
    throw new Error(result?.error || "Storage operation did not return a verified result. Refresh and try again.");
  }
  return result;
}

function assertStorageRequest(tabId, url, type) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("No active tab is available.");
  }

  if (!isSupportedPageUrl(url)) {
    throw new Error("Only http:// and https:// pages support storage operations.");
  }

  if (!STORAGE_TYPES.has(type)) {
    throw new Error("Storage type is not supported.");
  }
}

function assertStorageKey(key) {
  if (!String(key || "")) {
    throw new Error("Storage key is required.");
  }
}

function operateStorageInPage(type, expectedOrigin, action, key, value, expected) {
  // This check must run synchronously with the mutation in the actual document.
  if (location.origin !== expectedOrigin) {
    return { ok: false, error: "The target tab changed sites. Refresh and try again." };
  }
  try {
    const storage = type === "session" ? sessionStorage : localStorage;
    const origin = location.origin;
    if (action === "read") {
      const items = Array.from({ length: storage.length }, (_, index) => {
        const itemKey = storage.key(index);
        return { type, key: itemKey, value: storage.getItem(itemKey) || "", origin };
      });
      return { ok: true, origin, items };
    }
    if (action === "compare-set") {
      const current = storage.getItem(key);
      if (current !== expected) {
        return { ok: true, origin, changed: false, value: current };
      }
      if (value === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, value);
      }
      const saved = storage.getItem(key);
      if (saved !== value) {
        return { ok: false, error: "The storage change could not be verified after writing." };
      }
      return { ok: true, origin, changed: true, value: saved };
    }
    if (action === "set") {
      storage.setItem(key, value);
      const savedValue = storage.getItem(key);
      if (savedValue !== value) {
        return { ok: false, error: "The storage value could not be verified after saving." };
      }
      return { ok: true, origin, value: savedValue };
    }
    storage.removeItem(key);
    if (storage.getItem(key) !== null) {
      return { ok: false, error: "The storage item could not be verified as deleted." };
    }
    return { ok: true, origin, removed: true };
  } catch (error) {
    return { ok: false, error: error?.message || "Storage is unavailable in the target page." };
  }
}
