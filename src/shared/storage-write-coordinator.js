import { t } from "./i18n.js";
export async function withStorageWriteLock(storageKey, action) {
  if (typeof storageKey !== "string" || !storageKey || typeof action !== "function") {
    throw new TypeError(t("A storage key and update action are required."));
  }
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== "function") {
    throw Object.assign(new Error(
      t("Storage write coordination is unavailable. Reload the extension in an up-to-date Chrome browser and try again.")
    ), { code: "STORAGE_WRITE_COORDINATION_UNAVAILABLE" });
  }

  return locks.request(`cookie-controller:storage.local:${storageKey}`, { mode: "exclusive" }, action);
}
