import { callChrome } from "./chrome-call.js";
import { parseHttpUrl } from "./url.js";

export function createOperationContext(tab, cookieStoreId = "") {
  const url = parseHttpUrl(tab?.url);
  if (!Number.isInteger(tab?.id) || tab.id < 0 || !url) {
    throw new Error("Select an http:// or https:// tab before changing site data.");
  }

  return Object.freeze({
    tabId: tab.id,
    url: tab.url,
    origin: url.origin,
    cookieStoreId: String(cookieStoreId || ""),
    incognito: Boolean(tab.incognito)
  });
}

export async function assertOperationContext(context) {
  if (!isOperationContext(context)) {
    throw new Error("The operation target is unavailable. Refresh and try again.");
  }

  const tab = await callChrome("tabs.get", context.tabId);
  if (parseHttpUrl(tab?.url)?.origin !== context.origin) {
    throw new Error("The target tab changed sites. Refresh and try again.");
  }
  if (Boolean(tab.incognito) !== context.incognito) {
    throw new Error("The target tab changed browsing modes. Refresh and try again.");
  }
  if (context.cookieStoreId) {
    const stores = await callChrome("cookies.getAllCookieStores");
    const store = stores.find((item) => item.tabIds?.includes(context.tabId));
    if (store?.id !== context.cookieStoreId) {
      throw new Error("The target cookie store changed. Refresh and try again.");
    }
  }
  return context;
}

export async function reloadOperationTarget(context) {
  try {
    await assertOperationContext(context);
    await callChrome("tabs.reload", context.tabId);
    return true;
  } catch {
    // A completed mutation must not reload a newly navigated page or become a failure.
    return false;
  }
}

export function getUndoUnavailableReason(snapshot, tab, cookieStoreId = "") {
  if (!snapshot) {
    return "This change can no longer be undone in this browser session.";
  }
  const target = snapshot.target;
  if (!isOperationContext(target)) {
    return "This older change has no verified target information and cannot be undone.";
  }
  if (parseHttpUrl(tab?.url)?.origin !== target.origin) {
    return `Undo is only available for ${target.origin}.`;
  }
  if (Boolean(tab?.incognito) !== target.incognito) {
    return "Switch to the original browsing mode before undoing this change.";
  }
  if (snapshot.storageType === "session" && tab?.id !== target.tabId) {
    return `Session Storage undo requires the original tab (${target.tabId}).`;
  }
  if (snapshot.itemKind === "cookie") {
    const cookie = snapshot.raw;
    const hostname = parseHttpUrl(target.url).hostname;
    const domain = cookie?.domain?.replace(/^\./, "");
    const validDomain = domain && (hostname === domain || (!cookie.hostOnly && hostname.endsWith(`.${domain}`)));
    if (!target.cookieStoreId || cookie?.storeId !== target.cookieStoreId || !validDomain || !cookie.path?.startsWith("/")) {
      return "This change has incomplete cookie target information and cannot be undone.";
    }
    if (cookieStoreId !== target.cookieStoreId) {
      return "Switch to the original cookie store before undoing this change.";
    }
  } else if (!["local", "session"].includes(snapshot.storageType) || snapshot.raw?.origin !== target.origin) {
    return "This change has incomplete storage target information and cannot be undone.";
  }
  return "";
}

function isOperationContext(context) {
  return Boolean(
    context &&
    Number.isInteger(context.tabId) && context.tabId >= 0 &&
    typeof context.incognito === "boolean" &&
    typeof context.cookieStoreId === "string" &&
    context.origin && parseHttpUrl(context.url)?.origin === context.origin
  );
}
