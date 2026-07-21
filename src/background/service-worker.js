chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    installedAt: Date.now()
  });
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
});
