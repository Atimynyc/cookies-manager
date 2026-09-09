(function applyRuntimeTheme() {
  const extensionContextIncognito = Boolean(globalThis.chrome?.extension?.inIncognitoContext);
  let activeTabIncognito = false;

  function applyTheme() {
    document.documentElement.dataset.theme = extensionContextIncognito || activeTabIncognito
      ? "incognito"
      : "light";
  }

  function setActiveTabIncognito(value) {
    activeTabIncognito = Boolean(value);
    applyTheme();
  }

  globalThis.cookieControllerTheme = Object.freeze({ setActiveTabIncognito });
  applyTheme();

  globalThis.chrome?.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
    if (globalThis.chrome?.runtime?.lastError) {
      return;
    }
    setActiveTabIncognito(tabs?.[0]?.incognito);
  });
}());
