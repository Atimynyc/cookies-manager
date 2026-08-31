import { getCookieScopedUrl, getOriginPermissionPattern, isSupportedPageUrl } from "./url.js";
import { callChrome } from "./chrome-call.js";

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

export async function setCookieValue(url, cookie, value, overrides = {}) {
  const session = Object.hasOwn(overrides, "session") ? overrides.session : cookie.session;
  const expirationDate = Object.hasOwn(overrides, "expirationDate")
    ? overrides.expirationDate
    : cookie.expirationDate;
  return setCookieData(url, {
    ...cookie,
    ...overrides,
    value,
    session,
    expirationDate
  });
}

export async function setCookieData(url, cookie) {
  if (!isSupportedPageUrl(url)) {
    throw new Error("Only http:// and https:// pages support cookie operations.");
  }

  const details = {
    url,
    name: cookie.name,
    value: String(cookie.value),
    path: cookie.path || "/"
  };

  for (const field of ["secure", "httpOnly"]) {
    if (typeof cookie[field] === "boolean") {
      details[field] = cookie[field];
    }
  }
  if (typeof cookie.sameSite === "string" && cookie.sameSite) {
    details.sameSite = cookie.sameSite;
  }
  if (typeof cookie.storeId === "string" && cookie.storeId) {
    details.storeId = cookie.storeId;
  }

  if (!cookie.hostOnly) {
    details.domain = cookie.domain;
  }

  const session = Object.hasOwn(cookie, "session")
    ? Boolean(cookie.session)
    : !Number.isFinite(cookie.expirationDate);
  if (!session) {
    if (!Number.isFinite(cookie.expirationDate)) {
      throw new Error("A persistent cookie requires a valid expiration date.");
    }
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
