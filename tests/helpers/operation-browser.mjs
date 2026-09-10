import vm from "node:vm";
import { installWebLocks } from "./web-locks.mjs";
import { createOperationEngine } from "../../src/shared/operation-engine.js";
import { OPERATION_MESSAGE_CHANNEL } from "../../src/shared/operation-client.js";
import { OPERATION_JOURNAL_KEY } from "../../src/shared/operation-journal.js";
import { getSiteDataItemId } from "../../src/shared/item-identity.js";
import { persistOperationHistory } from "../../src/shared/history-store.js";

export function createMemoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

export function installOperationBrowser(t, { tabs = [
  { id: 1, url: "https://example.com/app", incognito: false },
  { id: 2, url: "https://other.example/app", incognito: false }
] } = {}) {
  installWebLocks(t);
  const previousChrome = globalThis.chrome;
  const env = {
    tabs: new Map(tabs.map((tab) => [tab.id, structuredClone(tab)])),
    stores: [{ id: "0", tabIds: tabs.map((tab) => tab.id) }],
    cookies: [], storage: new Map(), origins: new Map(),
    localData: {}, sessionData: {}, writes: [], reloads: [], messages: [],
    onRead: null, afterWrite: null, beforeStorageScript: null,
    get jobs() { return env.sessionData[OPERATION_JOURNAL_KEY]?.jobs || []; }
  };
  env.getStorage = (tabId, type) => {
    const tab = env.tabs.get(tabId);
    const origin = env.origins.get(tabId) || new URL(tab.url).origin;
    const identity = `${Boolean(tab.incognito)}:${origin}:${type}${type === "session" ? `:${tabId}` : ""}`;
    if (!env.storage.has(identity)) env.storage.set(identity, createMemoryStorage());
    return env.storage.get(identity);
  };
  function recordWrite(write) {
    env.writes.push(write);
    env.afterWrite?.(write);
  }
  function storageArea(data) {
    return {
      QUOTA_BYTES: 10 * 1024 * 1024,
      get(keys, callback) {
        const result = keys === null ? data : typeof keys === "string" ? { [keys]: data[keys] }
          : Array.isArray(keys) ? Object.fromEntries(keys.map((key) => [key, data[key]])) : { ...keys, ...data };
        callback(structuredClone(result));
      },
      set(values, callback) { Object.assign(data, structuredClone(values)); callback(); },
      remove(keys, callback) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; callback(); }
    };
  }
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        env.messages.push(structuredClone(message));
        const dispatch = async () => {
          if (message.channel !== OPERATION_MESSAGE_CHANNEL) throw new Error("Unexpected message channel");
          const methods = {
            submit: () => env.engine.submitOperation(message.spec),
            list: () => env.engine.listOperations(),
            get: () => env.engine.getOperation(message.id),
            retry: () => env.engine.retryOperation(message.id),
            undo: () => env.engine.undoOperation(message.id, message.options),
            forget: () => env.engine.forgetOperation(message.id)
          };
          return methods[message.command]();
        };
        dispatch().then(
          (value) => callback({ ok: true, value: structuredClone(value) }),
          (error) => callback({ ok: false, error: { message: error.message, code: error.code } })
        );
      }
    },
    tabs: {
      get(tabId, callback) { callback(structuredClone(env.tabs.get(tabId))); },
      reload(tabId, callback) { env.reloads.push(tabId); callback(); }
    },
    cookies: {
      getAllCookieStores(callback) { callback(structuredClone(env.stores)); },
      get(details, callback) {
        const url = new URL(details.url);
        const candidates = env.cookies.filter((item) => {
          const domain = item.domain.replace(/^\./, "");
          const pathMatches = url.pathname === item.path || url.pathname.startsWith(item.path.endsWith("/") ? item.path : `${item.path}/`);
          return item.name === details.name && item.storeId === details.storeId
            && (url.hostname === domain || (!item.hostOnly && url.hostname.endsWith(`.${domain}`)))
            && pathMatches && (!item.secure || url.protocol === "https:")
            && JSON.stringify(item.partitionKey) === JSON.stringify(details.partitionKey);
        }).sort((left, right) => right.path.length - left.path.length);
        callback(structuredClone(candidates[0] || null));
      },
      getAll(details, callback) {
        const url = details.url ? new URL(details.url) : null;
        const matches = env.cookies.filter((item) => {
          const domain = item.domain.replace(/^\./, "");
          return (!details.storeId || item.storeId === details.storeId)
            && (details.name === undefined || item.name === details.name)
            && (!details.domain || domain === details.domain || domain.endsWith(`.${details.domain}`))
            && (!url || (url.hostname === domain || (!item.hostOnly && url.hostname.endsWith(`.${domain}`)))
              && url.pathname.startsWith(item.path) && (!item.secure || url.protocol === "https:"))
            && (!details.partitionKey || JSON.stringify(item.partitionKey) === JSON.stringify(details.partitionKey));
        });
        env.onRead?.({ kind: "cookies", details });
        callback(structuredClone(matches));
      },
      set(details, callback) {
        const saved = {
          name: details.name, value: details.value,
          domain: details.domain || new URL(details.url).hostname,
          path: details.path || "/", hostOnly: !details.domain,
          session: !Number.isFinite(details.expirationDate), secure: Boolean(details.secure),
          httpOnly: Boolean(details.httpOnly), sameSite: details.sameSite || "unspecified",
          storeId: details.storeId || "0",
          ...(Number.isFinite(details.expirationDate) ? { expirationDate: details.expirationDate } : {}),
          ...(details.partitionKey ? { partitionKey: structuredClone(details.partitionKey) } : {})
        };
        env.cookies = env.cookies.filter((item) => getSiteDataItemId("cookies", item) !== getSiteDataItemId("cookies", saved));
        env.cookies.push(saved);
        recordWrite({ kind: "cookie-set", ...structuredClone(details), details: structuredClone(details) });
        callback(structuredClone(saved));
      },
      remove(details, callback) {
        const url = new URL(details.url);
        const index = env.cookies.findIndex((item) => item.name === details.name && item.storeId === details.storeId
          && item.domain.replace(/^\./, "") === url.hostname && item.path === url.pathname
          && JSON.stringify(item.partitionKey) === JSON.stringify(details.partitionKey));
        if (index >= 0) env.cookies.splice(index, 1);
        recordWrite({ kind: "cookie-remove", ...structuredClone(details), details: structuredClone(details) });
        callback(index >= 0 ? details : null);
      }
    },
    scripting: {
      executeScript(details, callback) {
        env.beforeStorageScript?.(details);
        const tab = env.tabs.get(details.target.tabId);
        const origin = env.origins.get(tab.id) || new URL(tab.url).origin;
        const result = vm.runInNewContext(`(${details.func.toString()})(...args)`, {
          args: details.args, location: { origin },
          localStorage: env.getStorage(tab.id, "local"), sessionStorage: env.getStorage(tab.id, "session")
        });
        if (details.args[2] === "read") env.onRead?.({ kind: details.args[0], tabId: tab.id });
        if (details.args[2] !== "read" && result.ok && result.changed !== false) {
          recordWrite({ kind: `storage-${details.args[2]}`, tabId: tab.id, type: details.args[0],
            origin, key: details.args[3], args: structuredClone(details.args) });
        }
        callback([{ result: structuredClone(result) }]);
      }
    },
    storage: { local: storageArea(env.localData), session: storageArea(env.sessionData) }
  };
  env.engine = createOperationEngine({ persistHistory: persistOperationHistory });
  t.after(async () => {
    await env.engine.resumeOperations();
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  return env;
}
