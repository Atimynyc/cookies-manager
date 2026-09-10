export async function withStorageWriteLock(storageKey, action) {
  if (typeof storageKey !== "string" || !storageKey || typeof action !== "function") {
    throw new TypeError("A storage key and update action are required.");
  }
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== "function") {
    throw Object.assign(new Error(
      "Storage write coordination is unavailable. Reload the extension in an up-to-date Chrome browser and try again."
    ), { code: "STORAGE_WRITE_COORDINATION_UNAVAILABLE" });
  }

  return locks.request(`cookie-controller:storage.local:${storageKey}`, { mode: "exclusive" }, action);
}
