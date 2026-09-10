import { createOperationEngine } from "../shared/operation-engine.js";
import { OPERATION_MESSAGE_CHANNEL } from "../shared/operation-client.js";
import { persistOperationHistory } from "../shared/history-store.js";

const operations = createOperationEngine({ persistHistory: persistOperationHistory });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.channel !== OPERATION_MESSAGE_CHANNEL) return false;
  const extensionOrigin = chrome.runtime.getURL("");
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) {
    sendResponse({ ok: false, error: { message: "Only this extension can request site data operations." } });
    return false;
  }
  const commands = {
    submit: () => operations.submitOperation(message.spec),
    list: () => operations.listOperations(),
    get: () => operations.getOperation(message.id),
    retry: () => operations.retryOperation(message.id),
    undo: () => operations.undoOperation(message.id, message.options),
    forget: () => operations.forgetOperation(message.id)
  };
  const command = commands[message.command];
  if (!command) {
    sendResponse({ ok: false, error: { message: "Unknown operation command." } });
    return false;
  }
  Promise.resolve().then(command).then(
    (value) => sendResponse({ ok: true, value }),
    (error) => sendResponse({ ok: false, error: { message: error?.message || "Operation failed.", code: error?.code } })
  );
  return true;
});

chrome.runtime.onStartup.addListener(() => { void operations.resumeOperations(); });
void operations.resumeOperations();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    installedAt: Date.now()
  });
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
});
