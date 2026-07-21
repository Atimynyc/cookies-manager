import {
  clearRecentCookieChanges,
  activateTab,
  getActiveTab,
  getCookieStoreIdForTab,
  getCookieTemplates,
  getCookiesForUrl,
  getPreferences,
  getRecentCookieChanges,
  getWindowHttpTabs,
  hasSitePermission,
  openSidePanel,
  reloadTab,
  removeCookie,
  saveCookieTemplates,
  savePreferences,
  saveRecentCookieChanges,
  setCookiePair,
  setCookieValue,
  watchCookieChanges
} from "../shared/cookie-api.js";
import {
  compareCookieRows,
  getCookieJson,
  getCookieSearchText,
  toCookieRow
} from "../shared/cookie-format.js";
import {
  getStorageItems,
  removeStorageItem,
  setStoragePair,
  setStorageValue
} from "../shared/storage-api.js";
import {
  compareStorageRows,
  getStorageJson,
  getStorageSearchText,
  getStorageTypeLabel,
  toStorageRow
} from "../shared/storage-format.js";
import {
  createRecentChange,
  formatBytes,
  normalizeRecentChanges
} from "../shared/recent-changes.js";
import { getDisplayHost, isSupportedPageUrl } from "../shared/url.js";
import {
  compactJsonValue,
  decodeJwtPayload,
  decodeUrlValue,
  encodeUrlValue,
  formatJsonValue,
  getAutoValueToolOutput
} from "../shared/value-tools.js";

const VALUE_TOOL_DEFINITIONS = {
  urlDecode: {
    title: "URL decoded value",
    run: decodeUrlValue
  },
  urlEncode: {
    title: "URL encoded value",
    run: encodeUrlValue
  },
  jsonFormat: {
    title: "Formatted JSON",
    run: formatJsonValue
  },
  jsonCompact: {
    title: "Compacted JSON",
    run: compactJsonValue
  },
  jwt: {
    title: "JWT payload",
    run: decodeJwtPayload
  }
};
const VALUE_TOOL_MODES = new Set(["none", ...Object.keys(VALUE_TOOL_DEFINITIONS)]);
const DATA_VIEWS = {
  cookies: {
    storageType: "",
    singular: "cookie",
    plural: "cookies",
    title: "Cookie",
    emptyMessage: "No cookies for this page",
    unavailableMessage: "Cookies unavailable",
    unsupportedMessage: "Only http:// and https:// pages support cookie operations.",
    readErrorMessage: "Failed to read cookies.",
    exportKey: "cookies",
    importPrompt: "Enter one cookie as name=value",
    invalidPairMessage: "Cookie name is invalid.",
    pairLabel: "name=value",
    tableLabels: ["Name", "Value", "Domain", "Path", "Expires", "Flags", "Size"],
    metaLabels: ["Domain", "Path", "Expires", "SameSite", "Store", "Size"]
  },
  localStorage: {
    storageType: "local",
    singular: "local storage item",
    plural: "local storage items",
    title: "Local Storage",
    emptyMessage: "No local storage for this page",
    unavailableMessage: "Local storage unavailable",
    unsupportedMessage: "Only http:// and https:// pages support storage operations.",
    readErrorMessage: "Failed to read local storage.",
    exportKey: "items",
    importPrompt: "Enter one local storage item as key=value",
    invalidPairMessage: "Storage key is invalid.",
    pairLabel: "key=value",
    tableLabels: ["Key", "Value", "Origin", "Storage", "Scope", "Flags", "Size"],
    metaLabels: ["Origin", "Storage", "Scope", "SameSite", "Type", "Size"]
  },
  sessionStorage: {
    storageType: "session",
    singular: "session storage item",
    plural: "session storage items",
    title: "Session Storage",
    emptyMessage: "No session storage for this page",
    unavailableMessage: "Session storage unavailable",
    unsupportedMessage: "Only http:// and https:// pages support storage operations.",
    readErrorMessage: "Failed to read session storage.",
    exportKey: "items",
    importPrompt: "Enter one session storage item as key=value",
    invalidPairMessage: "Storage key is invalid.",
    pairLabel: "key=value",
    tableLabels: ["Key", "Value", "Origin", "Storage", "Scope", "Flags", "Size"],
    metaLabels: ["Origin", "Storage", "Scope", "SameSite", "Type", "Size"]
  }
};
const DEFAULT_COLUMN_WIDTHS = [115, 150, 130, 84, 116, 92, 58];
const MIN_COLUMN_WIDTHS = [76, 110, 104, 64, 102, 76, 54];
const MAX_COLUMN_WIDTH = 360;
const COLUMN_CSS_VARS = [
  "--cookie-col-name",
  "--cookie-col-value",
  "--cookie-col-domain",
  "--cookie-col-path",
  "--cookie-col-expires",
  "--cookie-col-flags",
  "--cookie-col-size"
];
const TEMPLATE_LIMIT = 12;

const state = {
  tab: null,
  tabs: [],
  dataView: "cookies",
  rows: [],
  cookieStoreId: "",
  selectedId: "",
  selectedIds: new Set(),
  searchQuery: "",
  autoRefreshPage: false,
  valueToolMode: "none",
  columnWidths: [...DEFAULT_COLUMN_WIDTHS],
  cookieTemplates: [],
  recentChanges: [],
  undoSnapshots: new Map(),
  unreadHistoryIds: new Set(),
  selectedHistoryId: "",
  activeDetailView: "details",
  toolOutputText: "",
  emptyMessage: "No cookies for this page",
  ignoreCookieChangesUntil: 0,
  loading: false
};

const elements = {
  hostLabel: document.querySelector("#hostLabel"),
  cookieCount: document.querySelector("#cookieCount"),
  siteSelect: document.querySelector("#siteSelect"),
  dataViewButtons: Array.from(document.querySelectorAll(".data-switch button[data-view]")),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
  openSidePanelButton: document.querySelector("#openSidePanelButton"),
  autoRefreshToggle: document.querySelector("#autoRefreshToggle"),
  permissionBanner: document.querySelector("#permissionBanner"),
  permissionMessage: document.querySelector("#permissionMessage"),
  requestPermissionButton: document.querySelector("#requestPermissionButton"),
  statusBar: document.querySelector("#statusBar"),
  statusMessage: document.querySelector("#statusMessage"),
  closeStatusButton: document.querySelector("#closeStatusButton"),
  selectionCount: document.querySelector("#selectionCount"),
  selectAllCheckbox: document.querySelector("#selectAllCheckbox"),
  batchEditButton: document.querySelector("#batchEditButton"),
  batchDeleteButton: document.querySelector("#batchDeleteButton"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  cookieTableBody: document.querySelector("#cookieTableBody"),
  loadingState: document.querySelector("#loadingState"),
  emptyState: document.querySelector("#emptyState"),
  detailPane: document.querySelector(".detail-pane"),
  detailsViewButton: document.querySelector("#detailsViewButton"),
  historyViewButton: document.querySelector("#historyViewButton"),
  historyCountBadge: document.querySelector("#historyCountBadge"),
  detailsView: document.querySelector("#detailsView"),
  historyPanel: document.querySelector("#historyPanel"),
  detailPlaceholder: document.querySelector("#detailPlaceholder"),
  cookieEditor: document.querySelector("#cookieEditor"),
  editorName: document.querySelector("#editorName"),
  editorLocation: document.querySelector("#editorLocation"),
  editorChips: document.querySelector("#editorChips"),
  valueInput: document.querySelector("#valueInput"),
  valueToolModeSelect: document.querySelector("#valueToolModeSelect"),
  runToolButton: document.querySelector("#runToolButton"),
  toolOutput: document.querySelector("#toolOutput"),
  toolOutputTitle: document.querySelector("#toolOutputTitle"),
  toolOutputBody: document.querySelector("#toolOutputBody"),
  copyToolOutputButton: document.querySelector("#copyToolOutputButton"),
  metaDomainLabel: document.querySelector("#metaDomainLabel"),
  metaDomain: document.querySelector("#metaDomain"),
  metaPathLabel: document.querySelector("#metaPathLabel"),
  metaPath: document.querySelector("#metaPath"),
  metaExpiresLabel: document.querySelector("#metaExpiresLabel"),
  metaExpires: document.querySelector("#metaExpires"),
  metaSameSiteLabel: document.querySelector("#metaSameSiteLabel"),
  metaSameSite: document.querySelector("#metaSameSite"),
  metaStoreLabel: document.querySelector("#metaStoreLabel"),
  metaStore: document.querySelector("#metaStore"),
  metaSize: document.querySelector("#metaSize"),
  copyValueButton: document.querySelector("#copyValueButton"),
  copyPairButton: document.querySelector("#copyPairButton"),
  copyJsonButton: document.querySelector("#copyJsonButton"),
  saveTemplateButton: document.querySelector("#saveTemplateButton"),
  applyTemplateButton: document.querySelector("#applyTemplateButton"),
  resetButton: document.querySelector("#resetButton"),
  deleteButton: document.querySelector("#deleteButton"),
  saveButton: document.querySelector("#saveButton"),
  historyList: document.querySelector("#historyList"),
  historyEmpty: document.querySelector("#historyEmpty"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  historyDetail: document.querySelector("#historyDetail"),
  historyDetailTitle: document.querySelector("#historyDetailTitle"),
  closeHistoryDetailButton: document.querySelector("#closeHistoryDetailButton"),
  historyDetailGrid: document.querySelector("#historyDetailGrid"),
  historyValueDetail: document.querySelector("#historyValueDetail"),
  historyBeforeValue: document.querySelector("#historyBeforeValue"),
  historyAfterValue: document.querySelector("#historyAfterValue"),
  historyDetailNote: document.querySelector("#historyDetailNote")
};

const popupParams = new URLSearchParams(location.search);
document.body.dataset.surface = popupParams.get("surface") === "sidepanel" ? "sidepanel" : "popup";

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindEvents();

  try {
    const preferences = await getPreferences();
    state.autoRefreshPage = Boolean(preferences.autoRefreshPage);
    state.valueToolMode = normalizeValueToolMode(preferences.valueToolMode);
    state.columnWidths = normalizeColumnWidths(preferences.columnWidths);
    elements.autoRefreshToggle.checked = state.autoRefreshPage;
    elements.valueToolModeSelect.value = state.valueToolMode;
    applyColumnWidths();
  } catch {
    state.autoRefreshPage = false;
    state.valueToolMode = "none";
    state.columnWidths = [...DEFAULT_COLUMN_WIDTHS];
    applyColumnWidths();
  }

  await loadCookieTemplates();
  await loadRecentChanges();
  await refreshData();
  startCookieWatcher();
}

function bindEvents() {
  for (const button of elements.dataViewButtons) {
    button.addEventListener("click", () => setDataView(button.dataset.view));
  }
  elements.siteSelect.addEventListener("change", switchToSelectedSite);
  elements.refreshButton.addEventListener("click", refreshData);
  elements.openSidePanelButton.addEventListener("click", openCurrentSidePanel);
  elements.requestPermissionButton.addEventListener("click", refreshData);
  elements.closeStatusButton.addEventListener("click", clearStatus);
  elements.selectAllCheckbox.addEventListener("change", toggleSelectAllVisible);
  elements.batchEditButton.addEventListener("click", batchEditSelected);
  elements.batchDeleteButton.addEventListener("click", batchDeleteSelected);
  elements.exportButton.addEventListener("click", exportCurrentData);
  elements.importButton.addEventListener("click", importPairFromInput);
  elements.searchInput.addEventListener("input", () => {
    state.searchQuery = elements.searchInput.value.trim().toLowerCase();
    renderTable();
  });
  elements.autoRefreshToggle.addEventListener("change", async () => {
    state.autoRefreshPage = elements.autoRefreshToggle.checked;
    await savePreferences({ autoRefreshPage: state.autoRefreshPage });
  });
  elements.cookieEditor.addEventListener("submit", saveSelectedItem);
  elements.valueInput.addEventListener("input", () => {
    updateSaveState();
    updateAutoToolOutput();
  });
  elements.resetButton.addEventListener("click", resetSelectedValue);
  elements.deleteButton.addEventListener("click", deleteSelectedItem);
  elements.copyValueButton.addEventListener("click", () => copySelected("value"));
  elements.copyPairButton.addEventListener("click", () => copySelected("pair"));
  elements.copyJsonButton.addEventListener("click", () => copySelected("json"));
  elements.saveTemplateButton.addEventListener("click", saveSelectedTemplate);
  elements.applyTemplateButton.addEventListener("click", applyCookieTemplate);
  elements.valueToolModeSelect.addEventListener("change", async () => {
    state.valueToolMode = normalizeValueToolMode(elements.valueToolModeSelect.value);
    await savePreferences({ valueToolMode: state.valueToolMode });
    updateAutoToolOutput();
    updateToolState();
  });
  elements.runToolButton.addEventListener("click", runSelectedValueTool);
  elements.copyToolOutputButton.addEventListener("click", copyToolOutput);
  elements.detailsViewButton.addEventListener("click", () => setActiveDetailView("details"));
  elements.historyViewButton.addEventListener("click", () => setActiveDetailView("history"));
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.closeHistoryDetailButton.addEventListener("click", clearHistoryDetail);
  initializeColumnResizers();
}

async function setDataView(view) {
  if (!DATA_VIEWS[view] || state.dataView === view) {
    return;
  }

  state.dataView = view;
  state.rows = [];
  state.selectedId = "";
  state.selectedIds.clear();
  state.searchQuery = "";
  elements.searchInput.value = "";
  clearToolOutput();
  clearHistoryDetail();
  setActiveDetailView("details");
  renderViewChrome();
  renderHistory();
  await refreshData();
}

async function refreshData() {
  setLoading(true);
  clearStatus();
  setPermissionBanner(false);
  renderViewChrome();

  try {
    const tab = await getActiveTab();
    state.tab = tab;
    state.cookieStoreId = "";
    await refreshSiteOptions(tab?.id);
    const view = getCurrentView();

    if (!tab?.url || !isSupportedPageUrl(tab.url)) {
      state.rows = [];
      state.selectedId = "";
      state.emptyMessage = "This page is not supported";
      renderHeader(tab?.url);
      renderTable();
      renderSelectedItem();
      showStatus(view.unsupportedMessage, "error");
      return;
    }

    renderHeader(tab.url);
    state.cookieStoreId = await getCurrentCookieStoreId(tab);
    state.rows = await readCurrentRows(tab);
    state.emptyMessage = view.emptyMessage;

    if (state.selectedId && !state.rows.some((row) => row.id === state.selectedId)) {
      state.selectedId = "";
    }
    pruneSelectedIds();

    renderTable();
    renderSelectedItem();
  } catch (error) {
    state.rows = [];
    state.emptyMessage = getCurrentView().unavailableMessage;
    renderTable();
    renderSelectedItem();
    await handleReadError(error);
  } finally {
    setLoading(false);
  }
}

async function refreshSiteOptions(activeTabId) {
  try {
    state.tabs = await getWindowHttpTabs();
  } catch {
    state.tabs = [];
  }

  const fragment = document.createDocumentFragment();
  for (const tab of state.tabs) {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = getSiteOptionLabel(tab);
    option.title = tab.url || "";
    option.selected = tab.id === activeTabId;
    fragment.append(option);
  }

  elements.siteSelect.replaceChildren(fragment);
  elements.siteSelect.disabled = state.tabs.length <= 1;
}

function getSiteOptionLabel(tab) {
  const host = getDisplayHost(tab.url);
  const title = tab.title ? ` - ${tab.title}` : "";
  return `${host}${title}`;
}

async function switchToSelectedSite() {
  const tabId = Number(elements.siteSelect.value);
  if (!Number.isFinite(tabId)) {
    return;
  }

  try {
    await activateTab(tabId);
    state.selectedId = "";
    state.selectedIds.clear();
    await refreshData();
  } catch (error) {
    showStatus(error?.message || "Failed to switch site.", "error");
  }
}

async function openCurrentSidePanel() {
  try {
    await openSidePanel(state.tab?.id);
    showStatus("Opened side panel.", "success");
  } catch (error) {
    showStatus(error?.message || "Failed to open side panel.", "error");
  }
}

async function readCurrentRows(tab) {
  if (state.dataView === "cookies") {
    const cookies = await getCookiesForUrl(tab.url, state.cookieStoreId);
    return cookies.map(toCookieRow).sort(compareCookieRows);
  }

  const view = getCurrentView();
  const items = await getStorageItems(tab.id, tab.url, view.storageType);
  return items.map(toStorageRow).sort(compareStorageRows);
}

async function handleReadError(error) {
  const message = error?.message || getCurrentView().readErrorMessage;
  const canRequestPermission = state.tab?.url && isSupportedPageUrl(state.tab.url);

  if (canRequestPermission) {
    const alreadyGranted = await safeHasSitePermission(state.tab.url);
    setPermissionBanner(
      !alreadyGranted,
      `${message} Reload this extension in chrome://extensions after updating the manifest.`
    );
  }

  showStatus(message, "error");
}

async function safeHasSitePermission(url) {
  try {
    return await hasSitePermission(url);
  } catch {
    return false;
  }
}

async function saveSelectedItem(event) {
  event.preventDefault();

  const row = getSelectedRow();
  if (!row || !state.tab?.url) {
    return;
  }

  const nextValue = elements.valueInput.value;
  if (nextValue === row.value) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    if (isCookieView()) {
      await setCookieValue(state.tab.url, row.raw, nextValue);
    } else {
      await setStorageValue(state.tab.id, state.tab.url, getCurrentView().storageType, row.name, nextValue);
    }
    await safelyRecordRecentChange(row, nextValue);
    state.selectedId = row.id;
    await refreshData();

    if (state.autoRefreshPage) {
      await reloadTab(state.tab.id);
    }

    showStatus(`Saved ${row.name}.`, "success");
  } catch (error) {
    showStatus(error?.message || `Failed to save ${getCurrentView().singular}.`, "error");
  } finally {
    setBusy(false);
  }
}

async function deleteSelectedItem() {
  const row = getSelectedRow();
  if (!row || !state.tab?.url) {
    return;
  }

  const confirmed = window.confirm(`Delete ${getCurrentView().singular} "${row.name}"?\n${getRowLocation(row)}`);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    if (isCookieView()) {
      await removeCookie(state.tab.url, row.raw);
    } else {
      await removeStorageItem(state.tab.id, state.tab.url, getCurrentView().storageType, row.name);
    }
    state.selectedId = "";
    await refreshData();

    if (state.autoRefreshPage) {
      await reloadTab(state.tab.id);
    }

    showStatus(`Deleted ${row.name}.`, "success");
  } catch (error) {
    showStatus(error?.message || `Failed to delete ${getCurrentView().singular}.`, "error");
  } finally {
    setBusy(false);
  }
}

async function batchEditSelected() {
  const selectedRows = getSelectedRows();
  if (selectedRows.length === 0 || !state.tab?.url) {
    return;
  }

  const nextValue = window.prompt(`Set value for ${selectedRows.length} selected ${getCurrentView().plural}:`);
  if (nextValue === null) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    for (const row of selectedRows) {
      if (isCookieView()) {
        await setCookieValue(state.tab.url, row.raw, nextValue);
      } else {
        await setStorageValue(state.tab.id, state.tab.url, getCurrentView().storageType, row.name, nextValue);
      }
      await safelyRecordRecentChange(row, nextValue);
    }

    await refreshData();
    showStatus(`Updated ${selectedRows.length} selected ${getCurrentView().plural}.`, "success");
  } catch (error) {
    showStatus(error?.message || `Failed to update selected ${getCurrentView().plural}.`, "error");
  } finally {
    setBusy(false);
  }
}

async function batchDeleteSelected() {
  const selectedRows = getSelectedRows();
  if (selectedRows.length === 0 || !state.tab?.url) {
    return;
  }

  const confirmed = window.confirm(`Delete ${selectedRows.length} selected ${getCurrentView().plural}?`);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    for (const row of selectedRows) {
      if (isCookieView()) {
        await removeCookie(state.tab.url, row.raw);
      } else {
        await removeStorageItem(state.tab.id, state.tab.url, getCurrentView().storageType, row.name);
      }
    }

    state.selectedId = "";
    state.selectedIds.clear();
    await refreshData();
    showStatus(`Deleted ${selectedRows.length} selected ${getCurrentView().plural}.`, "success");
  } catch (error) {
    showStatus(error?.message || `Failed to delete selected ${getCurrentView().plural}.`, "error");
  } finally {
    setBusy(false);
  }
}

function resetSelectedValue() {
  const row = getSelectedRow();
  if (!row) {
    return;
  }

  elements.valueInput.value = row.value;
  updateSaveState();
  updateAutoToolOutput();
}

async function copySelected(mode) {
  const row = getSelectedRow();
  if (!row) {
    return;
  }

  const text = {
    value: row.value,
    pair: `${row.name}=${row.value}`,
    json: getRowJson(row)
  }[mode];

  try {
    await writeClipboard(text);
    showStatus("Copied to clipboard.", "success");
  } catch (error) {
    showStatus(error?.message || "Failed to copy.", "error");
  }
}

async function exportCurrentData() {
  if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
    showStatus(`Open an http:// or https:// page before exporting ${getCurrentView().plural}.`, "error");
    return;
  }

  const view = getCurrentView();
  const payload = {
    url: state.tab.url,
    host: getDisplayHost(state.tab.url),
    type: state.dataView,
    exportedAt: new Date().toISOString(),
    count: state.rows.length,
    [view.exportKey]: state.rows.map((row) => row.raw)
  };

  try {
    await writeClipboard(JSON.stringify(payload, null, 2));
    showStatus(`Exported ${state.rows.length} ${state.rows.length === 1 ? view.singular : view.plural} to clipboard.`, "success");
  } catch (error) {
    showStatus(error?.message || `Failed to export ${view.plural}.`, "error");
  }
}

async function importPairFromInput() {
  if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
    showStatus(`Open an http:// or https:// page before importing ${getCurrentView().plural}.`, "error");
    return;
  }

  const text = window.prompt(getCurrentView().importPrompt);
  if (text === null) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    const pair = parsePairText(text);
    const previousRow = findLikelyImportedRow(pair.name);
    const importedRow = await importPair(pair);
    await safelyRecordImportChange(importedRow, pair.value, previousRow);
    state.selectedId = importedRow.id;
    await refreshData();

    if (state.autoRefreshPage) {
      await reloadTab(state.tab.id);
    }

    showStatus(`Imported ${pair.name}.`, "success");
  } catch (error) {
    showStatus(error?.message || `Failed to import ${getCurrentView().singular}.`, "error");
  } finally {
    setBusy(false);
  }
}

async function saveSelectedTemplate() {
  const row = getSelectedRow();
  if (!row || !isCookieView()) {
    showStatus("Select a cookie before saving a template.", "error");
    return;
  }

  const label = window.prompt("Template name", row.name);
  if (!label) {
    return;
  }

  const template = {
    id: `${Date.now()}-${row.name}`,
    label: label.trim(),
    name: row.name,
    value: elements.valueInput.value,
    domain: row.domain,
    path: row.path,
    createdAt: Date.now()
  };

  state.cookieTemplates = normalizeCookieTemplates([template, ...state.cookieTemplates]);
  await saveCookieTemplates(state.cookieTemplates);
  showStatus(`Saved template ${template.label}.`, "success");
}

async function applyCookieTemplate() {
  const row = getSelectedRow();
  if (!row || !isCookieView()) {
    showStatus("Select a cookie before applying a template.", "error");
    return;
  }

  if (state.cookieTemplates.length === 0) {
    showStatus("No cookie templates have been saved yet.", "error");
    return;
  }

  const menu = state.cookieTemplates
    .map((template, index) => `${index + 1}. ${template.label} (${template.name})`)
    .join("\n");
  const choice = window.prompt(`Choose a template number:\n${menu}`, "1");
  const index = Number(choice) - 1;
  const template = state.cookieTemplates[index];

  if (!template) {
    if (choice !== null) {
      showStatus("Template choice is invalid.", "error");
    }
    return;
  }

  elements.valueInput.value = template.value;
  updateSaveState();
  updateAutoToolOutput();
  showStatus(`Applied template ${template.label}. Save to write it.`, "success");
}

async function loadCookieTemplates() {
  try {
    state.cookieTemplates = normalizeCookieTemplates(await getCookieTemplates());
  } catch {
    state.cookieTemplates = [];
  }
}

function normalizeCookieTemplates(templates) {
  if (!Array.isArray(templates)) {
    return [];
  }

  return templates
    .filter((template) => template && typeof template.label === "string" && typeof template.value === "string")
    .slice(0, TEMPLATE_LIMIT);
}

function parsePairText(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);

  if (!line) {
    throw new Error(`Enter a valid ${getCurrentView().pairLabel}.`);
  }

  const firstPair = isCookieView() ? line.replace(/^Cookie:\s*/i, "").split(";")[0].trim() : line;
  const separatorIndex = firstPair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(`Enter a valid ${getCurrentView().pairLabel}.`);
  }

  const name = firstPair.slice(0, separatorIndex).trim();
  const value = firstPair.slice(separatorIndex + 1);

  if (!name || (isCookieView() && /[\s;=]/.test(name))) {
    throw new Error(getCurrentView().invalidPairMessage);
  }

  return { name, value };
}

async function importPair(pair) {
  if (isCookieView()) {
    const cookie = await setCookiePair(state.tab.url, pair.name, pair.value, state.cookieStoreId);
    return toCookieRow(cookie);
  }

  const item = await setStoragePair(state.tab.id, state.tab.url, getCurrentView().storageType, pair.name, pair.value);
  return toStorageRow(item);
}

function findLikelyImportedRow(name) {
  if (!state.tab?.url) {
    return null;
  }

  if (!isCookieView()) {
    return state.rows.find((row) => row.name === name) || null;
  }

  const host = new URL(state.tab.url).hostname;
  return state.rows.find((row) =>
    row.name === name &&
    row.path === "/" &&
    (row.domain === host || row.domain === `.${host}`)
  ) || null;
}

function runSelectedValueTool() {
  const row = getSelectedRow();
  if (!row) {
    return;
  }

  const definition = VALUE_TOOL_DEFINITIONS[state.valueToolMode];
  if (!definition) {
    showStatus("Choose a value helper first.", "error");
    return;
  }

  try {
    const result = {
      title: definition.title,
      text: definition.run(elements.valueInput.value)
    };

    showToolOutput(result.title, result.text);
    showStatus(`${result.title} ready.`, "success");
  } catch (error) {
    clearToolOutput();
    showStatus(error?.message || "Unable to parse this value.", "error");
  }
}

function showToolOutput(title, text) {
  state.toolOutputText = text;
  elements.toolOutputTitle.textContent = title;
  elements.toolOutputBody.textContent = text;
  elements.toolOutput.hidden = false;
  elements.copyToolOutputButton.disabled = !text;
}

function updateAutoToolOutput() {
  const row = getSelectedRow();
  if (!row) {
    clearToolOutput();
    return;
  }

  const result = getAutoValueToolOutput(elements.valueInput.value);
  if (result) {
    showToolOutput(result.title, result.text);
    return;
  }

  clearToolOutput();
}

function clearToolOutput() {
  state.toolOutputText = "";
  elements.toolOutputTitle.textContent = "Output";
  elements.toolOutputBody.textContent = "";
  elements.toolOutput.hidden = true;
  elements.copyToolOutputButton.disabled = true;
}

async function copyToolOutput() {
  if (!state.toolOutputText) {
    return;
  }

  try {
    await writeClipboard(state.toolOutputText);
    showStatus("Copied tool output.", "success");
  } catch (error) {
    showStatus(error?.message || "Failed to copy.", "error");
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard is unavailable.");
  }
}

function normalizeValueToolMode(mode) {
  return VALUE_TOOL_MODES.has(mode) ? mode : "none";
}

function normalizeColumnWidths(widths) {
  if (!Array.isArray(widths)) {
    return [...DEFAULT_COLUMN_WIDTHS];
  }

  return DEFAULT_COLUMN_WIDTHS.map((defaultWidth, index) => {
    const width = Number(widths[index]);
    if (!Number.isFinite(width)) {
      return defaultWidth;
    }
    return clampColumnWidth(width, index);
  });
}

function clampColumnWidth(width, index) {
  return Math.min(Math.max(Math.round(width), MIN_COLUMN_WIDTHS[index]), MAX_COLUMN_WIDTH);
}

function applyColumnWidths() {
  state.columnWidths.forEach((width, index) => {
    document.documentElement.style.setProperty(COLUMN_CSS_VARS[index], `${width}px`);
  });
}

function getCurrentView() {
  return DATA_VIEWS[state.dataView] || DATA_VIEWS.cookies;
}

function isCookieView() {
  return state.dataView === "cookies";
}

function renderViewChrome() {
  const view = getCurrentView();
  document.body.dataset.view = state.dataView;
  elements.searchInput.placeholder = isCookieView()
    ? "Search name, value, domain, path"
    : "Search key, value, origin";
  elements.refreshButton.title = `Refresh ${view.plural}`;
  elements.refreshButton.setAttribute("aria-label", `Refresh ${view.plural}`);
  elements.importButton.textContent = `Import ${view.pairLabel}`;
  elements.detailsView.setAttribute("aria-label", `${view.title} editor`);
  elements.detailPlaceholder.textContent = `Select a ${view.singular}`;

  elements.dataViewButtons.forEach((button) => {
    const isActive = button.dataset.view === state.dataView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  document.querySelectorAll("th[data-column-index]").forEach((header) => {
    const index = Number(header.dataset.columnIndex);
    const handle = header.querySelector(".column-resizer");
    header.childNodes.forEach((node) => {
      if (node !== handle) {
        node.remove();
      }
    });
    header.insertBefore(document.createTextNode(view.tableLabels[index]), handle || null);
    if (handle) {
      handle.title = `Resize ${view.tableLabels[index]} column`;
      handle.setAttribute("aria-label", `Resize ${view.tableLabels[index]} column`);
    }
  });

  [
    elements.metaDomainLabel,
    elements.metaPathLabel,
    elements.metaExpiresLabel,
    elements.metaSameSiteLabel,
    elements.metaStoreLabel
  ].forEach((label, index) => {
    label.textContent = view.metaLabels[index];
  });
}

function initializeColumnResizers() {
  document.querySelectorAll("th[data-column-index]").forEach((header) => {
    const index = Number(header.dataset.columnIndex);
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "column-resizer";
    handle.title = `Resize ${header.textContent.trim()} column`;
    handle.setAttribute("aria-label", `Resize ${header.textContent.trim()} column`);
    handle.addEventListener("pointerdown", (event) => startColumnResize(event, index));
    handle.addEventListener("keydown", (event) => resizeColumnWithKeyboard(event, index));
    header.append(handle);
  });
}

function startColumnResize(event, index) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = state.columnWidths[index];

  const onPointerMove = (moveEvent) => {
    const nextWidth = clampColumnWidth(startWidth + moveEvent.clientX - startX, index);
    state.columnWidths[index] = nextWidth;
    applyColumnWidths();
  };

  const onPointerUp = async () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    await savePreferences({ columnWidths: state.columnWidths });
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp, { once: true });
}

async function resizeColumnWithKeyboard(event, index) {
  const directions = {
    ArrowLeft: -12,
    ArrowRight: 12,
    Home: MIN_COLUMN_WIDTHS[index] - state.columnWidths[index],
    End: DEFAULT_COLUMN_WIDTHS[index] - state.columnWidths[index]
  };

  if (!(event.key in directions)) {
    return;
  }

  event.preventDefault();
  state.columnWidths[index] = clampColumnWidth(state.columnWidths[index] + directions[event.key], index);
  applyColumnWidths();
  await savePreferences({ columnWidths: state.columnWidths });
}

function renderHeader(url) {
  const view = getCurrentView();
  elements.hostLabel.textContent = getDisplayHost(url);
  elements.cookieCount.textContent = `${state.rows.length} ${state.rows.length === 1 ? view.singular : view.plural}`;
}

function renderTable() {
  const visibleRows = getVisibleRows();
  const fragment = document.createDocumentFragment();

  for (const row of visibleRows) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.dataset.itemId = row.id;
    tr.dataset.cookieId = row.id;
    tr.className = [
      row.id === state.selectedId ? "is-selected" : "",
      state.selectedIds.has(row.id) ? "is-checked" : ""
    ].filter(Boolean).join(" ");
    tr.addEventListener("click", () => selectItem(row.id));
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectItem(row.id);
      }
    });

    tr.append(
      createSelectCell(row),
      createCell(row.name, row.name),
      createCell(row.value, row.value, "value-cell"),
      createCell(row.domain, row.domain),
      createCell(row.path, row.path),
      createCell(row.expires, row.expires),
      createFlagCell(row),
      createCell(`${row.size} B`, `${row.size} bytes`)
    );

    fragment.append(tr);
  }

  elements.cookieTableBody.replaceChildren(fragment);
  elements.emptyState.textContent = state.emptyMessage;
  elements.emptyState.hidden = state.loading || visibleRows.length > 0;
  renderHeader(state.tab?.url);
  updateActionAvailability();
  updateSelectionSummary();
}

function createSelectCell(row) {
  const td = document.createElement("td");
  const checkbox = document.createElement("input");
  td.className = "select-cell";
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedIds.has(row.id);
  checkbox.setAttribute("aria-label", `Select ${row.name}`);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => toggleRowSelection(row.id, checkbox.checked));
  td.append(checkbox);
  return td;
}

function createCell(text, title = text, className = "") {
  const td = document.createElement("td");
  td.textContent = text || "";
  td.title = title || "";

  if (className) {
    td.className = className;
  }

  return td;
}

function createFlagCell(row) {
  const td = document.createElement("td");
  const stack = document.createElement("span");
  stack.className = "flag-stack";

  const flags = [];
  if (row.httpOnly) {
    flags.push("Http");
  }
  if (row.secure) {
    flags.push("Sec");
  }
  if (row.partitioned) {
    flags.push("Part");
  }

  if (flags.length === 0) {
    td.textContent = "-";
    return td;
  }

  for (const flag of flags) {
    const badge = document.createElement("span");
    badge.className = "flag";
    badge.textContent = flag;
    badge.title = {
      Http: "HttpOnly",
      Sec: "Secure",
      Part: "Partitioned"
    }[flag];
    stack.append(badge);
  }

  td.append(stack);
  return td;
}

function getVisibleRows() {
  if (!state.searchQuery) {
    return state.rows;
  }

  const getSearchText = isCookieView() ? getCookieSearchText : getStorageSearchText;
  return state.rows.filter((row) => getSearchText(row).includes(state.searchQuery));
}

function selectItem(id) {
  const changed = state.selectedId !== id;
  state.selectedId = id;
  renderTable();
  renderSelectedItem();

  if (changed) {
    setActiveDetailView("details");
    elements.cookieEditor.scrollTop = 0;
  }
}

function toggleRowSelection(id, selected) {
  if (selected) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }
  renderTable();
}

function toggleSelectAllVisible() {
  const visibleRows = getVisibleRows();
  if (elements.selectAllCheckbox.checked) {
    visibleRows.forEach((row) => state.selectedIds.add(row.id));
  } else {
    visibleRows.forEach((row) => state.selectedIds.delete(row.id));
  }
  renderTable();
}

function pruneSelectedIds() {
  const ids = new Set(state.rows.map((row) => row.id));
  for (const id of state.selectedIds) {
    if (!ids.has(id)) {
      state.selectedIds.delete(id);
    }
  }
}

function getSelectedRows() {
  return state.rows.filter((row) => state.selectedIds.has(row.id));
}

function updateSelectionSummary() {
  const selectedCount = state.selectedIds.size;
  const visibleRows = getVisibleRows();
  const visibleSelectedCount = visibleRows.filter((row) => state.selectedIds.has(row.id)).length;
  elements.selectionCount.textContent = `${selectedCount} selected`;
  elements.batchEditButton.disabled = selectedCount === 0;
  elements.batchDeleteButton.disabled = selectedCount === 0;
  elements.selectAllCheckbox.checked = visibleRows.length > 0 && visibleSelectedCount === visibleRows.length;
  elements.selectAllCheckbox.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleRows.length;
}

function setActiveDetailView(view) {
  state.activeDetailView = view === "history" ? "history" : "details";

  const isHistoryView = state.activeDetailView === "history";
  elements.detailsView.hidden = isHistoryView;
  elements.historyPanel.hidden = !isHistoryView;
  elements.detailsViewButton.classList.toggle("is-active", !isHistoryView);
  elements.historyViewButton.classList.toggle("is-active", isHistoryView);
  elements.detailsViewButton.setAttribute("aria-pressed", String(!isHistoryView));
  elements.historyViewButton.setAttribute("aria-pressed", String(isHistoryView));

  if (isHistoryView) {
    renderHistory();
  }
}

function renderSelectedItem() {
  const row = getSelectedRow();
  const hasSelection = Boolean(row);

  elements.detailPlaceholder.hidden = hasSelection;
  elements.cookieEditor.hidden = !hasSelection;

  if (!row) {
    clearToolOutput();
    renderHistory();
    updateSelectionControls();
    return;
  }

  elements.editorName.textContent = row.name;
  elements.editorName.title = row.name;
  elements.editorLocation.textContent = getRowLocation(row);
  elements.editorLocation.title = getRowLocation(row);
  elements.valueInput.value = row.value;
  updateAutoToolOutput();
  elements.metaDomain.textContent = row.domain;
  elements.metaDomain.title = row.domain;
  elements.metaPath.textContent = row.path;
  elements.metaPath.title = row.path;
  elements.metaExpires.textContent = row.expires;
  elements.metaExpires.title = row.expires;
  elements.metaSameSite.textContent = row.sameSite || "-";
  elements.metaStore.textContent = row.storeId || "Default";
  elements.metaSize.textContent = `${row.size} B`;

  renderEditorChips(row);
  renderHistory();
  updateSelectionControls();
}

function renderEditorChips(row) {
  const chips = [];

  if (isCookieView()) {
    if (row.httpOnly) {
      chips.push({ label: "HttpOnly", className: "is-danger" });
    }
    if (row.secure) {
      chips.push({ label: "Secure", className: "is-accent" });
    }
    if (row.session) {
      chips.push({ label: "Session", className: "" });
    }
    if (row.partitioned) {
      chips.push({ label: "Partitioned", className: "" });
    }
    if (row.partitionTopLevelSite) {
      chips.push({ label: `CHIPS ${row.partitionTopLevelSite}`, className: "" });
    }
  } else {
    chips.push({
      label: getStorageTypeLabel(row.type),
      className: row.type === "session" ? "" : "is-accent"
    });
  }

  elements.editorChips.replaceChildren(
    ...chips.map((chip) => {
      const span = document.createElement("span");
      span.className = `chip ${chip.className}`.trim();
      span.textContent = chip.label;
      return span;
    })
  );
}

function getRowLocation(row) {
  if (isCookieView()) {
    return `${row.domain}${row.path}`;
  }

  return `${row.origin || row.domain} ${getStorageTypeLabel(row.type)}`.trim();
}

function getRowJson(row) {
  return isCookieView() ? getCookieJson(row) : getStorageJson(row);
}

function updateSaveState() {
  const row = getSelectedRow();
  elements.saveButton.disabled = !row || elements.valueInput.value === row.value;
  elements.resetButton.disabled = !row || elements.valueInput.value === row.value;
  updateToolState();
}

function updateToolState() {
  const hasSelection = Boolean(getSelectedRow());
  elements.valueToolModeSelect.disabled = !hasSelection;
  elements.runToolButton.disabled = !hasSelection || state.valueToolMode === "none";
}

function updateSelectionControls() {
  const hasSelection = Boolean(getSelectedRow());
  elements.deleteButton.disabled = !hasSelection;
  elements.copyValueButton.disabled = !hasSelection;
  elements.copyPairButton.disabled = !hasSelection;
  elements.copyJsonButton.disabled = !hasSelection;
  elements.copyToolOutputButton.disabled = !state.toolOutputText;
  elements.clearHistoryButton.disabled = getVisibleRecentChanges().length === 0;
  elements.saveTemplateButton.disabled = !hasSelection || !isCookieView();
  elements.applyTemplateButton.disabled = !hasSelection || !isCookieView() || state.cookieTemplates.length === 0;
  updateSaveState();
}

async function loadRecentChanges() {
  try {
    state.recentChanges = normalizeRecentChanges(await getRecentCookieChanges());
  } catch {
    state.recentChanges = [];
  }

  renderHistory();
}

async function safelyRecordRecentChange(row, nextValue) {
  try {
    const record = createRecentChange(row, nextValue, getDisplayHost(state.tab?.url), Date.now(), {
      itemKind: getHistoryItemKind()
    });
    state.undoSnapshots.set(record.id, {
      itemKind: getHistoryItemKind(),
      raw: row.raw,
      storageType: row.type || getCurrentView().storageType,
      key: row.name,
      value: row.value,
      beforeValue: row.value,
      afterValue: nextValue
    });
    state.unreadHistoryIds.add(record.id);
    state.recentChanges = normalizeRecentChanges([record, ...state.recentChanges]);
    renderHistory();
    await saveRecentCookieChanges(state.recentChanges);
  } catch {
    // Saving should not fail because local history could not be updated.
  }
}

async function safelyRecordImportChange(row, nextValue, previousRow) {
  try {
    const record = createRecentChange(row, nextValue, getDisplayHost(state.tab?.url), Date.now(), {
      action: previousRow ? "import-overwrite" : "import-create",
      itemKind: getHistoryItemKind(),
      beforeSize: previousRow?.size || 0
    });

    state.undoSnapshots.set(record.id, previousRow
      ? {
          itemKind: getHistoryItemKind(),
          raw: previousRow.raw,
          storageType: previousRow.type || getCurrentView().storageType,
          key: previousRow.name,
          value: previousRow.value,
          beforeValue: previousRow.value,
          afterValue: nextValue
        }
      : {
          itemKind: getHistoryItemKind(),
          raw: row.raw,
          storageType: row.type || getCurrentView().storageType,
          key: row.name,
          beforeValue: "",
          afterValue: nextValue,
          deleteOnUndo: true
        });
    state.unreadHistoryIds.add(record.id);
    state.recentChanges = normalizeRecentChanges([record, ...state.recentChanges]);
    renderHistory();
    await saveRecentCookieChanges(state.recentChanges);
  } catch {
    // Importing should not fail because local history could not be updated.
  }
}

function getHistoryItemKind() {
  return {
    cookies: "cookie",
    localStorage: "localStorage",
    sessionStorage: "sessionStorage"
  }[state.dataView] || "cookie";
}

async function undoRecentChange(changeId) {
  const snapshot = state.undoSnapshots.get(changeId);
  if (!snapshot || !state.tab?.url) {
    showStatus("This change can no longer be undone from this popup session.", "error");
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    if (snapshot.deleteOnUndo) {
      if (snapshot.itemKind === "cookie") {
        await removeCookie(state.tab.url, snapshot.raw);
      } else {
        await removeStorageItem(state.tab.id, state.tab.url, snapshot.storageType, snapshot.key);
      }
      state.selectedId = "";
    } else {
      if (snapshot.itemKind === "cookie") {
        const restored = await setCookieValue(state.tab.url, snapshot.raw, snapshot.value);
        state.selectedId = toCookieRow(restored).id;
      } else {
        const restored = await setStorageValue(state.tab.id, state.tab.url, snapshot.storageType, snapshot.key, snapshot.value);
        state.selectedId = toStorageRow(restored).id;
      }
    }

    state.undoSnapshots.delete(changeId);
    state.unreadHistoryIds.delete(changeId);
    if (state.selectedHistoryId === changeId) {
      clearHistoryDetail();
    }
    renderHistory();
    await refreshData();

    if (state.autoRefreshPage) {
      await reloadTab(state.tab.id);
    }

    showStatus("Undid the selected change.", "success");
  } catch (error) {
    showStatus(error?.message || "Failed to undo change.", "error");
  } finally {
    setBusy(false);
  }
}

async function clearHistory() {
  try {
    const itemKind = getHistoryItemKind();
    const clearedIds = new Set(
      state.recentChanges
        .filter((change) => change.itemKind === itemKind)
        .map((change) => change.id)
    );
    state.recentChanges = state.recentChanges.filter((change) => change.itemKind !== itemKind);
    clearedIds.forEach((changeId) => {
      state.undoSnapshots.delete(changeId);
      state.unreadHistoryIds.delete(changeId);
    });
    if (state.recentChanges.length === 0) {
      await clearRecentCookieChanges();
    } else {
      await saveRecentCookieChanges(state.recentChanges);
    }
    state.selectedHistoryId = "";
    clearHistoryDetail();
    renderHistory();
    showStatus(`${getCurrentView().title} history cleared.`, "success");
  } catch (error) {
    showStatus(error?.message || "Failed to clear recent changes.", "error");
  }
}

function renderHistory() {
  if (!elements.historyList) {
    return;
  }

  const visibleChanges = getVisibleRecentChanges();
  updateHistoryBadge(syncUnreadHistory(visibleChanges));
  const items = visibleChanges.map(createHistoryItem);
  elements.historyList.replaceChildren(...items);
  elements.historyList.hidden = visibleChanges.length === 0;
  elements.historyEmpty.hidden = visibleChanges.length > 0;
  elements.clearHistoryButton.disabled = visibleChanges.length === 0;

  if (state.selectedHistoryId && !visibleChanges.some((change) => change.id === state.selectedHistoryId)) {
    state.selectedHistoryId = "";
    clearHistoryDetail();
  }
}

function getVisibleRecentChanges() {
  const itemKind = getHistoryItemKind();
  return state.recentChanges.filter((change) => {
    const snapshot = state.undoSnapshots.get(change.id);
    return change.itemKind === itemKind && snapshot && "beforeValue" in snapshot && "afterValue" in snapshot;
  });
}

function syncUnreadHistory(visibleChanges) {
  const allChangeIds = new Set(state.recentChanges.map((change) => change.id));
  const visibleIds = new Set(visibleChanges.map((change) => change.id));

  for (const changeId of state.unreadHistoryIds) {
    if (!allChangeIds.has(changeId) || (visibleIds.has(changeId) && state.activeDetailView === "history")) {
      state.unreadHistoryIds.delete(changeId);
    }
  }

  return visibleChanges.filter((change) => state.unreadHistoryIds.has(change.id)).length;
}

function updateHistoryBadge(count) {
  elements.historyCountBadge.hidden = count === 0;
  elements.historyCountBadge.textContent = count > 9 ? "9+" : String(count);
  elements.historyViewButton.title = count > 0 ? `${count} unread changes` : "Recent changes";
}

function createHistoryItem(change) {
  const item = document.createElement("li");
  const main = document.createElement("div");
  const sub = document.createElement("div");
  const name = document.createElement("span");
  const time = document.createElement("time");
  const scope = document.createElement("span");
  const delta = document.createElement("span");
  const detailButton = document.createElement("button");

  item.dataset.changeId = change.id;
  main.className = "history-main";
  sub.className = "history-sub";
  name.className = "history-name";
  time.className = "history-time";
  scope.className = "history-scope";
  delta.className = "history-delta";
  detailButton.type = "button";
  detailButton.className = "history-detail-button";
  detailButton.textContent = "Details";
  detailButton.setAttribute("aria-controls", "historyDetail");
  detailButton.setAttribute("aria-expanded", String(state.selectedHistoryId === change.id));
  detailButton.addEventListener("click", () => showHistoryDetail(change.id));

  name.textContent = change.name || getChangeItemLabel(change);
  name.title = change.name || "";
  time.textContent = formatHistoryTime(change.timestamp);
  time.dateTime = new Date(change.timestamp).toISOString();

  const location = getChangeLocation(change);
  scope.textContent = location || "Unknown scope";
  scope.title = location || "";
  delta.textContent = `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`;

  main.append(name, time);
  sub.append(scope, delta, detailButton);
  if (state.undoSnapshots.has(change.id)) {
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "history-undo-button";
    undoButton.textContent = "Undo";
    undoButton.addEventListener("click", () => undoRecentChange(change.id));
    sub.append(undoButton);
  }
  item.append(main, sub);

  if (state.selectedHistoryId === change.id && !elements.historyDetail.hidden) {
    item.classList.add("is-expanded");
    item.append(elements.historyDetail);
  }

  return item;
}

function showHistoryDetail(changeId) {
  const change = getVisibleRecentChanges().find((item) => item.id === changeId);
  if (!change) {
    clearHistoryDetail();
    return;
  }

  setActiveDetailView("history");
  const snapshot = state.undoSnapshots.get(change.id);
  state.selectedHistoryId = change.id;
  elements.historyDetailTitle.textContent = `${formatChangeAction(change.action)}: ${change.name || getChangeItemLabel(change)}`;
  renderHistoryDetailGrid(change);
  renderHistoryValueDetail(change, snapshot);
  elements.historyDetail.hidden = false;
  attachHistoryDetail(change.id);
}

function clearHistoryDetail() {
  const expandedItem = elements.historyDetail.closest("li");
  if (expandedItem) {
    expandedItem.classList.remove("is-expanded");
    expandedItem.querySelector(".history-detail-button")?.setAttribute("aria-expanded", "false");
  }

  state.selectedHistoryId = "";
  elements.historyDetail.hidden = true;
  elements.historyDetailTitle.textContent = "Change detail";
  elements.historyDetailGrid.replaceChildren();
  elements.historyBeforeValue.replaceChildren();
  elements.historyAfterValue.replaceChildren();
  elements.historyValueDetail.hidden = true;
  elements.historyDetailNote.hidden = true;
  elements.historyDetailNote.textContent = "";
  elements.historyPanel.append(elements.historyDetail);
}

function attachHistoryDetail(changeId) {
  const item = Array.from(elements.historyList.children)
    .find((candidate) => candidate.dataset.changeId === changeId);
  if (!item) {
    return;
  }

  elements.historyList.querySelectorAll("li.is-expanded").forEach((candidate) => {
    candidate.classList.remove("is-expanded");
    candidate.querySelector(".history-detail-button")?.setAttribute("aria-expanded", "false");
  });
  item.classList.add("is-expanded");
  item.querySelector(".history-detail-button")?.setAttribute("aria-expanded", "true");
  item.append(elements.historyDetail);
  item.scrollIntoView({ block: "nearest" });
}

function renderHistoryDetailGrid(change) {
  const rows = isCookieChange(change) ? [
    ["Action", formatChangeAction(change.action)],
    ["Cookie", change.name || ""],
    ["Domain", change.domain || ""],
    ["Path", change.path || ""],
    ["Store", change.storeId || "Default"],
    ["Host", change.host || ""],
    ["Changed", formatFullHistoryTime(change.timestamp)],
    ["Size", `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`],
    ["Cookie ID", change.cookieId || ""]
  ] : [
    ["Action", formatChangeAction(change.action)],
    ["Key", change.name || ""],
    ["Storage", getStorageTypeLabel(change.storageType)],
    ["Origin", change.origin || ""],
    ["Host", change.host || ""],
    ["Changed", formatFullHistoryTime(change.timestamp)],
    ["Size", `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`],
    ["Item ID", change.itemId || ""]
  ];

  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value || "-";
    detail.title = value || "";
    group.append(term, detail);
    fragment.append(group);
  }

  elements.historyDetailGrid.replaceChildren(fragment);
}

function startCookieWatcher() {
  watchCookieChanges((changeInfo) => {
    if (
      !isCookieView() ||
      state.loading ||
      Date.now() < state.ignoreCookieChangesUntil ||
      !state.tab?.url ||
      (state.cookieStoreId && changeInfo.cookie?.storeId !== state.cookieStoreId) ||
      !isWatchedCookie(changeInfo.cookie)
    ) {
      return;
    }

    window.setTimeout(() => {
      refreshData();
    }, 150);
  });
}

async function getCurrentCookieStoreId(tab) {
  try {
    return await getCookieStoreIdForTab(tab.id);
  } catch {
    return "";
  }
}

function suppressCookieWatcher(duration = 1500) {
  state.ignoreCookieChangesUntil = Date.now() + duration;
}

function isWatchedCookie(cookie) {
  if (!cookie || !state.tab?.url) {
    return false;
  }

  try {
    const host = new URL(state.tab.url).hostname;
    const domain = String(cookie.domain || "").replace(/^\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function isCookieChange(change) {
  return (change.itemKind || "cookie") === "cookie";
}

function getChangeItemLabel(change) {
  return isCookieChange(change) ? "Cookie" : getStorageTypeLabel(change.storageType);
}

function getChangeLocation(change) {
  if (isCookieChange(change)) {
    return `${change.host || ""} ${change.domain || ""}${change.path || ""}`.trim();
  }

  return `${change.host || ""} ${change.origin || ""} ${getStorageTypeLabel(change.storageType)}`.trim();
}

function renderHistoryValueDetail(change, snapshot) {
  if (snapshot && "beforeValue" in snapshot && "afterValue" in snapshot) {
    renderValueDiff(elements.historyBeforeValue, elements.historyAfterValue, snapshot.beforeValue || "", snapshot.afterValue || "");
    elements.historyValueDetail.hidden = false;
    elements.historyDetailNote.hidden = true;
    elements.historyDetailNote.textContent = "";
    return;
  }

  elements.historyBeforeValue.replaceChildren();
  elements.historyAfterValue.replaceChildren();
  elements.historyValueDetail.hidden = true;
  elements.historyDetailNote.hidden = false;
  elements.historyDetailNote.textContent =
    "Value snapshots are only available for changes made during the current popup session.";
}

function renderValueDiff(beforeElement, afterElement, beforeValue, afterValue) {
  const diff = getSingleRangeDiff(beforeValue, afterValue);
  beforeElement.replaceChildren(...createDiffNodes(beforeValue, diff.beforeStart, diff.beforeEnd, "diff-removed"));
  afterElement.replaceChildren(...createDiffNodes(afterValue, diff.afterStart, diff.afterEnd, "diff-added"));
}

function getSingleRangeDiff(beforeValue, afterValue) {
  const beforeLength = beforeValue.length;
  const afterLength = afterValue.length;
  let prefixLength = 0;

  while (
    prefixLength < beforeLength &&
    prefixLength < afterLength &&
    beforeValue[prefixLength] === afterValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLength - prefixLength &&
    suffixLength < afterLength - prefixLength &&
    beforeValue[beforeLength - 1 - suffixLength] === afterValue[afterLength - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    beforeStart: prefixLength,
    beforeEnd: beforeLength - suffixLength,
    afterStart: prefixLength,
    afterEnd: afterLength - suffixLength
  };
}

function createDiffNodes(value, diffStart, diffEnd, className) {
  if (diffStart === diffEnd) {
    return [document.createTextNode(value)];
  }

  const nodes = [];
  if (diffStart > 0) {
    nodes.push(document.createTextNode(value.slice(0, diffStart)));
  }

  const mark = document.createElement("mark");
  mark.className = className;
  mark.textContent = value.slice(diffStart, diffEnd);
  nodes.push(mark);

  if (diffEnd < value.length) {
    nodes.push(document.createTextNode(value.slice(diffEnd)));
  }

  return nodes;
}

function formatChangeAction(action) {
  return {
    edit: "Edit",
    "import-create": "Import create",
    "import-overwrite": "Import overwrite"
  }[action] || "Change";
}

function formatHistoryTime(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatFullHistoryTime(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

function getSelectedRow() {
  return state.rows.find((row) => row.id === state.selectedId) || null;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.loadingState.hidden = !isLoading;
  elements.refreshButton.disabled = isLoading;
  updateActionAvailability();
  renderTable();
}

function updateActionAvailability() {
  const supportedPage = Boolean(state.tab?.url && isSupportedPageUrl(state.tab.url));
  elements.exportButton.disabled = state.loading || !supportedPage || state.rows.length === 0;
  elements.importButton.disabled = state.loading || !supportedPage;
}

function setBusy(isBusy) {
  if (isBusy) {
    elements.dataViewButtons.forEach((button) => {
      button.disabled = true;
    });
    elements.saveButton.disabled = true;
    elements.deleteButton.disabled = true;
    elements.resetButton.disabled = true;
    elements.copyValueButton.disabled = true;
    elements.copyPairButton.disabled = true;
    elements.copyJsonButton.disabled = true;
    elements.valueToolModeSelect.disabled = true;
    elements.runToolButton.disabled = true;
    elements.copyToolOutputButton.disabled = true;
  elements.clearHistoryButton.disabled = true;
  elements.exportButton.disabled = true;
  elements.importButton.disabled = true;
  elements.batchEditButton.disabled = true;
  elements.batchDeleteButton.disabled = true;
  elements.saveTemplateButton.disabled = true;
  elements.applyTemplateButton.disabled = true;
    return;
  }

  elements.dataViewButtons.forEach((button) => {
    button.disabled = false;
  });
  const hasSelection = Boolean(getSelectedRow());
  elements.deleteButton.disabled = !hasSelection;
  updateActionAvailability();
  updateSelectionControls();
}

function setPermissionBanner(visible, message = "Site permission is required for this page.") {
  elements.permissionBanner.hidden = !visible;
  elements.permissionMessage.textContent = message;
}

function showStatus(message, type = "info") {
  elements.statusBar.hidden = false;
  elements.statusMessage.textContent = message;
  elements.statusBar.className = `status-bar is-${type}`;
}

function clearStatus() {
  elements.statusBar.hidden = true;
  elements.statusMessage.textContent = "";
  elements.statusBar.className = "status-bar";
}
