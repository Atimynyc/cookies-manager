export function installWebLocks(t) {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const queues = new Map();
  const requests = [];
  const locks = {
    request(name, options, callback) {
      requests.push({ name, ...options });
      const previous = queues.get(name) || Promise.resolve();
      const result = previous.then(() => callback({ name, mode: options.mode }));
      const settled = result.catch(() => {});
      queues.set(name, settled);
      settled.then(() => {
        if (queues.get(name) === settled) queues.delete(name);
      });
      return result;
    }
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  t.after(() => {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  });
  return { locks, requests };
}
