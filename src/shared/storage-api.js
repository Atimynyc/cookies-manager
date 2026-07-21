import { isSupportedPageUrl } from "./url.js";

const STORAGE_TYPES = new Set(["local", "session"]);

function callChrome(path, ...args) {
  return new Promise((resolve, reject) => {
    const keys = Array.isArray(path) ? path : path.split(".");
    const method = keys.at(-1);
    const target = keys.slice(0, -1).reduce((current, key) => current[key], chrome);

    target[method](...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

export async function getStorageItems(tabId, url, type) {
  assertStorageRequest(tabId, url, type);

  const [injection] = await callChrome("scripting.executeScript", {
    target: { tabId },
    func: readStorageItemsInPage,
    args: [type]
  });

  return Array.isArray(injection?.result) ? injection.result : [];
}

export async function setStorageValue(tabId, url, type, key, value) {
  assertStorageRequest(tabId, url, type);
  assertStorageKey(key);

  await callChrome("scripting.executeScript", {
    target: { tabId },
    func: setStorageValueInPage,
    args: [type, key, String(value)]
  });

  return {
    type,
    key,
    value: String(value),
    origin: new URL(url).origin
  };
}

export async function setStoragePair(tabId, url, type, key, value) {
  return setStorageValue(tabId, url, type, key, value);
}

export async function removeStorageItem(tabId, url, type, key) {
  assertStorageRequest(tabId, url, type);
  assertStorageKey(key);

  await callChrome("scripting.executeScript", {
    target: { tabId },
    func: removeStorageItemInPage,
    args: [type, key]
  });
}

function assertStorageRequest(tabId, url, type) {
  if (!tabId) {
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

function readStorageItemsInPage(type) {
  const storage = type === "session" ? sessionStorage : localStorage;
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return {
      type,
      key,
      value: storage.getItem(key) || "",
      origin: location.origin
    };
  });
}

function setStorageValueInPage(type, key, value) {
  const storage = type === "session" ? sessionStorage : localStorage;
  storage.setItem(key, value);
}

function removeStorageItemInPage(type, key) {
  const storage = type === "session" ? sessionStorage : localStorage;
  storage.removeItem(key);
}
