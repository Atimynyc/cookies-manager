export function callChrome(path, ...args) {
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
