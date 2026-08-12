import { getCookieStoreIdForTab, getCookiesForUrl } from "../shared/cookie-api.js";
import { compareCookieRows, toCookieRow } from "../shared/cookie-format.js";
import { getStorageItems } from "../shared/storage-api.js";
import { compareStorageRows, toStorageRow } from "../shared/storage-format.js";

export async function readSiteDataRows(tab, dataView, cookieStoreId = "") {
  if (dataView === "cookies") {
    const cookies = await getCookiesForUrl(tab.url, cookieStoreId);
    return cookies.map(toCookieRow).sort(compareCookieRows);
  }

  const storageType = dataView === "sessionStorage" ? "session" : "local";
  const items = await getStorageItems(tab.id, tab.url, storageType);
  return items.map(toStorageRow).sort(compareStorageRows);
}

export async function resolveCookieStoreId(tab) {
  if (!tab?.id) {
    return "";
  }

  try {
    return await getCookieStoreIdForTab(tab.id);
  } catch {
    return "";
  }
}
