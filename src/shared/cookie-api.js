import { getCookieScopedUrl, getOriginPermissionPattern, isSupportedPageUrl } from "./url.js";

const RECENT_CHANGES_KEY = "recentCookieChanges";
const COOKIE_TEMPLATES_KEY = "cookieTemplates";
const DEFAULT_PREFERENCES = {
  autoRefreshPage: false,
  valueToolMode: "none",
  columnWidths: null
};

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

export async function getActiveTab() {
  const tabs = await callChrome("tabs.query", {
    active: true,
    currentWindow: true
  });
  return tabs[0] || null;
}

export async function getWindowHttpTabs() {
  const tabs = await callChrome("tabs.query", {
    currentWindow: true
  });

  return tabs.filter((tab) => isSupportedPageUrl(tab.url));
}

export async function getCookieStoreIdForTab(tabId) {
  if (!Number.isInteger(tabId)) {
    return "";
  }

  const stores = await callChrome("cookies.getAllCookieStores");
  const store = stores.find((item) => Array.isArray(item.tabIds) && item.tabIds.includes(tabId));
  return store?.id || "";
}

export async function activateTab(tabId) {
  if (!tabId) {
    return null;
  }

  const tab = await callChrome("tabs.update", tabId, {
    active: true
  });
  await callChrome("windows.update", tab.windowId, {
    focused: true
  });
  return tab;
}

export async function getCookiesForUrl(url, storeId = "") {
  if (!isSupportedPageUrl(url)) {
    throw new Error("Only http:// and https:// pages support cookie operations.");
  }

  const details = { url };
  if (storeId) {
    details.storeId = storeId;
  }

  return callChrome("cookies.getAll", details);
}

export async function setCookieValue(url, cookie, value) {
  const details = {
    url,
    name: cookie.name,
    value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId
  };

  if (!cookie.hostOnly) {
    details.domain = cookie.domain;
  }

  if (!cookie.session && cookie.expirationDate) {
    details.expirationDate = cookie.expirationDate;
  }

  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  return callChrome("cookies.set", details);
}

export async function setCookiePair(url, name, value, storeId = "") {
  if (!isSupportedPageUrl(url)) {
    throw new Error("Only http:// and https:// pages support cookie operations.");
  }

  const details = {
    url,
    name,
    value,
    path: "/"
  };

  if (storeId) {
    details.storeId = storeId;
  }

  return callChrome("cookies.set", details);
}

export async function removeCookie(url, cookie) {
  const details = {
    url: getCookieScopedUrl(cookie, url),
    name: cookie.name,
    storeId: cookie.storeId
  };

  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  return callChrome("cookies.remove", details);
}

export async function reloadTab(tabId) {
  if (!tabId) {
    return;
  }
  await callChrome("tabs.reload", tabId);
}

export async function getPreferences() {
  const result = await callChrome("storage.local.get", DEFAULT_PREFERENCES);
  return result;
}

export async function savePreferences(nextPreferences) {
  await callChrome("storage.local.set", nextPreferences);
}

export async function getRecentCookieChanges() {
  const result = await callChrome("storage.local.get", {
    [RECENT_CHANGES_KEY]: []
  });

  return Array.isArray(result[RECENT_CHANGES_KEY]) ? result[RECENT_CHANGES_KEY] : [];
}

export async function saveRecentCookieChanges(changes) {
  await callChrome("storage.local.set", {
    [RECENT_CHANGES_KEY]: changes
  });
}

export async function clearRecentCookieChanges() {
  await callChrome("storage.local.remove", RECENT_CHANGES_KEY);
}

export async function getCookieTemplates() {
  const result = await callChrome("storage.local.get", {
    [COOKIE_TEMPLATES_KEY]: []
  });

  return Array.isArray(result[COOKIE_TEMPLATES_KEY]) ? result[COOKIE_TEMPLATES_KEY] : [];
}

export async function saveCookieTemplates(templates) {
  await callChrome("storage.local.set", {
    [COOKIE_TEMPLATES_KEY]: templates
  });
}

export async function openSidePanel(tabId) {
  if (!chrome.sidePanel?.open || !tabId) {
    throw new Error("Side panel is not available in this browser.");
  }

  const tab = await callChrome("tabs.get", tabId);
  await Promise.resolve(chrome.sidePanel.open({
    windowId: tab.windowId
  }));
}

export function watchCookieChanges(callback) {
  if (!chrome.cookies?.onChanged) {
    return () => {};
  }

  chrome.cookies.onChanged.addListener(callback);
  return () => chrome.cookies.onChanged.removeListener(callback);
}

export async function hasSitePermission(url) {
  const origin = getOriginPermissionPattern(url);
  if (!origin) {
    return false;
  }

  return callChrome("permissions.contains", {
    origins: [origin]
  });
}
