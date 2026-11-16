(function applyRuntimeTheme() {
  const extensionContextIncognito = Boolean(globalThis.chrome?.extension?.inIncognitoContext);
  const keys = { regular: "uiThemeRegular", incognito: "uiThemeIncognito" };
  const preferences = { regular: null, incognito: null };
  const revisions = { regular: 0, incognito: 0 };
  const listeners = new Set();
  let activeTabIncognito = false;
  let contextRevision = 0;

  const getScope = () => extensionContextIncognito || activeTabIncognito ? "incognito" : "regular";
  const getPreference = (scope = getScope()) => preferences[scope] || (scope === "incognito" ? "dark" : "light");

  function applyTheme() {
    const scope = getScope();
    const theme = getPreference(scope);
    document.documentElement.dataset.theme = theme === "dark" ? "incognito" : "light";
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.dataset.themeScope = scope;
    for (const listener of listeners) listener();
  }

  function setActiveTabIncognito(value) {
    contextRevision += 1;
    activeTabIncognito = Boolean(value);
    applyTheme();
  }

  function setPreference(value, scope = getScope()) {
    if (!(scope in keys)) return;
    revisions[scope] += 1;
    preferences[scope] = ["light", "dark"].includes(value) ? value : null;
    applyTheme();
  }

  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [scope, key] of Object.entries(keys)) {
      if (changes[key]) setPreference(changes[key].newValue, scope);
    }
  });

  const preferencesReady = new Promise(resolve => {
    if (!globalThis.chrome?.storage?.local) { resolve(); return; }
    const initialRevisions = { ...revisions };
    chrome.storage.local.get({ uiThemeRegular: null, uiThemeIncognito: null }, result => {
      if (!chrome.runtime.lastError) {
        for (const [scope, key] of Object.entries(keys)) {
          if (initialRevisions[scope] === revisions[scope]) setPreference(result?.[key], scope);
        }
      }
      resolve();
    });
  });
  const contextReady = new Promise(resolve => {
    if (!globalThis.chrome?.tabs?.query) { resolve(); return; }
    const initialRevision = contextRevision;
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!chrome.runtime.lastError && initialRevision === contextRevision) setActiveTabIncognito(tabs?.[0]?.incognito);
      resolve();
    });
  });

  globalThis.cookieControllerTheme = Object.freeze({
    setActiveTabIncognito, setPreference, getPreference, getScope,
    getStorageKey: (scope = getScope()) => keys[scope],
    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ready: Promise.all([preferencesReady, contextReady])
  });
  applyTheme();
}());
