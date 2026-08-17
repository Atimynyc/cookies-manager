import {
  activateTab,
  getActiveTab,
  getWindowHttpTabs,
  hasSitePermission,
  openSidePanel,
  reloadTab,
  removeCookie,
  setCookiePair,
  setCookieValue,
  watchCookieChanges
} from "../shared/cookie-api.js";
import {
  clearRecentChangeSnapshots,
  clearRecentCookieChanges,
  getRecentChangeSnapshots,
  getRecentCookieChanges,
  saveRecentChangeSnapshots,
  saveRecentCookieChanges
} from "../shared/history-store.js";
import {
  FAVORITE_SITE_DATA_IDS_KEY,
  getCookieTemplates,
  getFavoriteSiteDataIds,
  getLastViewedSiteData,
  getPreferences,
  normalizeLastViewedSiteData,
  normalizeCookieTemplates,
  saveCookieTemplates,
  saveFavoriteSiteDataIds,
  saveLastViewedSiteData,
  savePreferences
} from "../shared/settings-store.js";
import {
  makeFavoriteItemId,
  normalizeFavoriteItemIds,
  sortFavoriteRowsFirst
} from "../shared/favorites.js";
import {
  getCookieJson,
  getCookieSearchText,
  toCookieRow
} from "../shared/cookie-format.js";
import {
  removeStorageItem,
  setStoragePair,
  setStorageValue
} from "../shared/storage-api.js";
import {
  getStorageJson,
  getStorageSearchText,
  getStorageTypeLabel,
  toStorageRow
} from "../shared/storage-format.js";
import {
  createRecentChange,
  normalizeRecentChanges
} from "../shared/recent-changes.js";
import { getDisplayHost, getSiteOrigin, isSupportedPageUrl } from "../shared/url.js";
import { getAutoValueToolOutput } from "../shared/value-tools.js";
import { parseNameValuePair } from "../shared/pair-parser.js";
import { executeBatchOperation } from "../shared/batch-operations.js";
import { getBatchOperationCounts } from "../shared/operation-result.js";
import {
  clampColumnWidth,
  COLUMN_CSS_VARS,
  COLUMN_WIDTHS_VERSION,
  DATA_VIEWS,
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTHS,
  migrateColumnWidths,
  normalizeValueToolMode,
  VALUE_TOOL_DEFINITIONS
} from "./popup-config.js";
import { readSiteDataRows, resolveCookieStoreId } from "./popup-data-service.js";
import { cancelDialogFromBackdrop, createDialogController } from "./popup-dialogs.js";
import { createClipboardFeedback, createStatusController, writeClipboard } from "./popup-feedback.js";
import { renderDataTable } from "./popup-table-view.js";
import { createHistoryView } from "./popup-history-view.js";

const state = {
  tab: null,
  tabs: [],
  dataView: "cookies",
  rows: [],
  cookieStoreId: "",
  selectedId: "",
  siteOrigin: null,
  rememberedSelectedIds: normalizeLastViewedSiteData(null).selectedIds,
  selectedIds: new Set(),
  favoriteItemIds: new Set(),
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

let lastViewedSavePromise = Promise.resolve();

const elements = {
  hostLabel: document.querySelector("#hostLabel"),
  cookieCount: document.querySelector("#cookieCount"),
  siteSelect: document.querySelector("#siteSelect"),
  dataViewButtons: Array.from(document.querySelectorAll(".data-switch button[data-view]")),
  searchInput: document.querySelector("#searchInput"),
  refreshControl: document.querySelector("#refreshControl"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshMenuButton: document.querySelector("#refreshMenuButton"),
  refreshMenu: document.querySelector("#refreshMenu"),
  openSidePanelButton: document.querySelector("#openSidePanelButton"),
  autoRefreshToggle: document.querySelector("#autoRefreshToggle"),
  permissionBanner: document.querySelector("#permissionBanner"),
  permissionMessage: document.querySelector("#permissionMessage"),
  requestPermissionButton: document.querySelector("#requestPermissionButton"),
  statusBar: document.querySelector("#statusBar"),
  statusMessage: document.querySelector("#statusMessage"),
  closeStatusButton: document.querySelector("#closeStatusButton"),
  copyAnnouncement: document.querySelector("#copyAnnouncement"),
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
  historyViewButton: document.querySelector("#historyViewButton"),
  historyCountBadge: document.querySelector("#historyCountBadge"),
  detailsView: document.querySelector("#detailsView"),
  historyPanel: document.querySelector("#historyPanel"),
  detailPlaceholder: document.querySelector("#detailPlaceholder"),
  cookieEditor: document.querySelector("#cookieEditor"),
  editorName: document.querySelector("#editorName"),
  editorLocation: document.querySelector("#editorLocation"),
  editorFavoriteButton: document.querySelector("#editorFavoriteButton"),
  editorChips: document.querySelector("#editorChips"),
  valueInput: document.querySelector("#valueInput"),
  expirationEditorCell: document.querySelector("#expirationEditorCell"),
  expirationInput: document.querySelector("#expirationInput"),
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
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmDialogTitle: document.querySelector("#confirmDialogTitle"),
  confirmDialogMessage: document.querySelector("#confirmDialogMessage"),
  confirmDialogDetail: document.querySelector("#confirmDialogDetail"),
  textInputDialog: document.querySelector("#textInputDialog"),
  textInputDialogForm: document.querySelector("#textInputDialogForm"),
  textInputDialogTitle: document.querySelector("#textInputDialogTitle"),
  textInputDialogFieldLabel: document.querySelector("#textInputDialogFieldLabel"),
  textInputDialogInput: document.querySelector("#textInputDialogInput"),
  textInputDialogError: document.querySelector("#textInputDialogError"),
  textInputDialogSubmitButton: document.querySelector("#textInputDialogSubmitButton"),
  templateDialog: document.querySelector("#templateDialog"),
  templateDialogOptions: document.querySelector("#templateDialogOptions"),
  templateDialogFeedback: document.querySelector("#templateDialogFeedback"),
  templateDialogApplyButton: document.querySelector("#templateDialogApplyButton"),
  dialogCancelButtons: Array.from(document.querySelectorAll("[data-dialog-cancel]")),
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

const {
  requestConfirmation: requestDeleteConfirmation,
  requestTextInput
} = createDialogController(elements);
const { showStatus, clearStatus } = createStatusController(elements);
const { showCopyFeedback, resetCopyFeedback } = createClipboardFeedback(elements.copyAnnouncement);
const {
  clearHistoryDetail,
  getVisibleRecentChanges,
  renderHistory,
  updateHistoryButtonState
} = createHistoryView({
  state,
  elements,
  getHistoryItemKind,
  onSelectHistoryView: () => setActiveDetailView("history"),
  onUndo: undoRecentChange
});

const popupParams = new URLSearchParams(location.search);
document.body.dataset.surface = popupParams.get("surface") === "sidepanel" ? "sidepanel" : "popup";

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindEvents();

  try {
    const preferences = await getPreferences();
    state.autoRefreshPage = Boolean(preferences.autoRefreshPage);
    state.valueToolMode = normalizeValueToolMode(preferences.valueToolMode);
    state.columnWidths = migrateColumnWidths(
      preferences.columnWidths,
      preferences.columnWidthsVersion
    );
    elements.autoRefreshToggle.checked = state.autoRefreshPage;
    elements.valueToolModeSelect.value = state.valueToolMode;
    updateRefreshControlState();
    applyColumnWidths();
    if (Number(preferences.columnWidthsVersion) < COLUMN_WIDTHS_VERSION) {
      try {
        await savePreferences({
          columnWidths: state.columnWidths,
          columnWidthsVersion: COLUMN_WIDTHS_VERSION
        });
      } catch {
        // The migrated widths are still applied for the current view.
      }
    }
  } catch {
    state.autoRefreshPage = false;
    state.valueToolMode = "none";
    state.columnWidths = [...DEFAULT_COLUMN_WIDTHS];
    elements.autoRefreshToggle.checked = false;
    updateRefreshControlState();
    applyColumnWidths();
  }

  await Promise.all([
    loadCookieTemplates(),
    loadFavoriteSiteDataIds(),
    loadRecentChanges()
  ]);
  await refreshData();
  startCookieWatcher();
  startFavoriteWatcher();
}

function bindEvents() {
  for (const button of elements.dataViewButtons) {
    button.addEventListener("click", () => setDataView(button.dataset.view));
  }
  elements.siteSelect.addEventListener("change", switchToSelectedSite);
  elements.refreshButton.addEventListener("click", refreshData);
  elements.refreshMenuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setRefreshMenuOpen(elements.refreshMenu.hidden);
  });
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
    updateRefreshControlState();
    await savePreferences({ autoRefreshPage: state.autoRefreshPage });
  });
  elements.cookieEditor.addEventListener("submit", saveSelectedItem);
  elements.valueInput.addEventListener("input", () => {
    updateSaveState();
    updateAutoToolOutput();
  });
  const handleExpirationChange = () => {
    updateExpirationValidity();
    updateSaveState();
  };
  elements.expirationInput.addEventListener("input", handleExpirationChange);
  elements.expirationInput.addEventListener("change", handleExpirationChange);
  elements.resetButton.addEventListener("click", resetSelectedItem);
  elements.deleteButton.addEventListener("click", deleteSelectedItem);
  elements.editorFavoriteButton.addEventListener("click", () => {
    const row = getSelectedRow();
    if (row) {
      void toggleFavorite(row.id, !isFavorite(row.id));
    }
  });
  elements.copyValueButton.addEventListener("click", () => copySelected("value", elements.copyValueButton));
  elements.copyPairButton.addEventListener("click", () => copySelected("pair", elements.copyPairButton));
  elements.copyJsonButton.addEventListener("click", () => copySelected("json", elements.copyJsonButton));
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
  elements.historyViewButton.addEventListener("click", () => {
    setActiveDetailView(state.activeDetailView === "history" ? "details" : "history");
  });
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.closeHistoryDetailButton.addEventListener("click", clearHistoryDetail);
  for (const dialog of [elements.confirmDialog, elements.textInputDialog, elements.templateDialog]) {
    dialog.addEventListener("click", cancelDialogFromBackdrop);
  }
  for (const button of elements.dialogCancelButtons) {
    button.addEventListener("click", () => button.closest("dialog")?.close("cancel"));
  }
  document.addEventListener("click", (event) => {
    if (!elements.refreshControl.contains(event.target)) {
      setRefreshMenuOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.refreshMenu.hidden) {
      setRefreshMenuOpen(false);
      elements.refreshMenuButton.focus();
    }
  });
  initializeColumnResizers();
}

function setRefreshMenuOpen(open) {
  elements.refreshMenu.hidden = !open;
  elements.refreshMenuButton.setAttribute("aria-expanded", String(open));
}

function updateRefreshControlState() {
  elements.refreshControl.classList.toggle("is-auto", state.autoRefreshPage);
  const stateLabel = state.autoRefreshPage ? "on" : "off";
  elements.refreshMenuButton.title = `Reload after changes: ${stateLabel}`;
  elements.refreshMenuButton.setAttribute("aria-label", `Reload after changes: ${stateLabel}`);
  elements.refreshButton.title = state.autoRefreshPage ? "Refresh data (page reload is on)" : "Refresh data";
}

async function restoreLastViewedSiteData(url) {
  const siteOrigin = getSiteOrigin(url);
  if (state.siteOrigin === siteOrigin) {
    return;
  }

  state.siteOrigin = siteOrigin;
  let lastViewed = normalizeLastViewedSiteData(null);
  try {
    lastViewed = await getLastViewedSiteData(url);
  } catch {
    // A storage failure should not prevent the current site's data from loading.
  }

  if (state.siteOrigin !== siteOrigin) {
    return;
  }

  state.dataView = lastViewed.activeDataView;
  state.rememberedSelectedIds = { ...lastViewed.selectedIds };
  state.selectedId = state.rememberedSelectedIds[state.dataView] || "";
  state.selectedIds.clear();
  state.searchQuery = "";
  elements.searchInput.value = "";
  clearToolOutput();
  clearHistoryDetail();
  setActiveDetailView("details");
  renderViewChrome();
  renderHistory();
}

function rememberCurrentSelection() {
  state.rememberedSelectedIds[state.dataView] = state.selectedId;
  persistLastViewedSiteData();
}

function persistLastViewedSiteData() {
  if (!state.siteOrigin) {
    return;
  }

  const siteOrigin = state.siteOrigin;
  const value = {
    activeDataView: state.dataView,
    selectedIds: { ...state.rememberedSelectedIds }
  };
  lastViewedSavePromise = lastViewedSavePromise
    .catch(() => {})
    .then(() => saveLastViewedSiteData(siteOrigin, value))
    .catch(() => {});
}

async function setDataView(view) {
  if (!DATA_VIEWS[view] || state.dataView === view) {
    return;
  }

  state.dataView = view;
  state.rows = [];
  state.selectedId = state.rememberedSelectedIds[view] || "";
  state.selectedIds.clear();
  state.searchQuery = "";
  elements.searchInput.value = "";
  clearToolOutput();
  clearHistoryDetail();
  setActiveDetailView("details");
  renderViewChrome();
  renderHistory();
  persistLastViewedSiteData();
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
    await restoreLastViewedSiteData(tab?.url);
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
    state.cookieStoreId = await resolveCookieStoreId(tab);
    state.rows = await readSiteDataRows(tab, state.dataView, state.cookieStoreId);
    state.emptyMessage = view.emptyMessage;

    if (state.selectedId && !state.rows.some((row) => row.id === state.selectedId)) {
      state.selectedId = "";
      rememberCurrentSelection();
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
    state.siteOrigin = null;
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
  const expiration = isCookieView() ? getExpirationDraft() : null;
  if (!hasSelectedItemChanges(row)) {
    return;
  }

  if (isCookieView() && !expiration) {
    elements.expirationInput.reportValidity();
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    let savedCookie = null;
    if (isCookieView()) {
      savedCookie = await setCookieValue(state.tab.url, row.raw, nextValue, expiration);
    } else {
      await setStorageValue(state.tab.id, state.tab.url, getCurrentView().storageType, row.name, nextValue);
    }
    await safelyRecordRecentChange(row, nextValue, { savedCookie });
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

  const confirmed = await requestDeleteConfirmation({
    title: `Delete ${getCurrentView().singular}?`,
    message: `"${row.name}" will be permanently deleted.`,
    detail: getRowLocation(row)
  });
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
    rememberCurrentSelection();
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

  const nextValue = await requestTextInput({
    title: "Set value",
    fieldLabel: `Value for ${selectedRows.length} selected ${getCurrentView().plural}`,
    submitLabel: "Set value"
  });
  if (nextValue === null) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    const result = await executeBatchOperation(selectedRows, async (row) => {
      if (isCookieView()) {
        await setCookieValue(state.tab.url, row.raw, nextValue);
      } else {
        await setStorageValue(state.tab.id, state.tab.url, getCurrentView().storageType, row.name, nextValue);
      }
      await safelyRecordRecentChange(row, nextValue);
    });

    await refreshData();
    showBatchOperationStatus("Updated", result);
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

  const confirmed = await requestDeleteConfirmation({
    title: `Delete selected ${getCurrentView().plural}?`,
    message: `${selectedRows.length} selected ${getCurrentView().plural} will be permanently deleted.`
  });
  if (!confirmed) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    const result = await executeBatchOperation(selectedRows, async (row) => {
      if (isCookieView()) {
        await removeCookie(state.tab.url, row.raw);
      } else {
        await removeStorageItem(state.tab.id, state.tab.url, getCurrentView().storageType, row.name);
      }
    });

    state.selectedId = "";
    rememberCurrentSelection();
    state.selectedIds = new Set(result.failed.map((entry) => entry.itemId));
    await refreshData();
    showBatchOperationStatus("Deleted", result);
  } catch (error) {
    showStatus(error?.message || `Failed to delete selected ${getCurrentView().plural}.`, "error");
  } finally {
    setBusy(false);
  }
}

function showBatchOperationStatus(action, result) {
  const counts = getBatchOperationCounts(result);
  if (counts.failed === 0 && counts.skipped === 0) {
    showStatus(`${action} ${counts.success} selected ${getCurrentView().plural}.`, "success");
    return;
  }

  const summary = [
    `${action} ${counts.success}`,
    counts.failed ? `${counts.failed} failed` : "",
    counts.skipped ? `${counts.skipped} skipped` : ""
  ].filter(Boolean).join(", ");
  const firstError = result.failed[0]?.error?.message;
  showStatus(`${summary}.${firstError ? ` ${firstError}` : ""}`, counts.failed ? "error" : "warning");
}

function resetSelectedItem() {
  const row = getSelectedRow();
  if (!row) {
    return;
  }

  elements.valueInput.value = row.value;
  populateExpirationEditor(row);
  updateSaveState();
  updateAutoToolOutput();
}

async function copySelected(mode, feedbackButton) {
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
    clearStatus();
    showCopyFeedback(feedbackButton);
  } catch (error) {
    resetCopyFeedback(feedbackButton);
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

  const pair = await requestImportPair();
  if (!pair) {
    return;
  }

  setBusy(true);
  clearStatus();
  suppressCookieWatcher();

  try {
    const previousRow = findLikelyImportedRow(pair.name);
    const importedRow = await importPair(pair);
    await safelyRecordImportChange(importedRow, pair.value, previousRow);
    state.selectedId = importedRow.id;
    rememberCurrentSelection();
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

  const label = await requestTextInput({
    title: "Save template",
    fieldLabel: "Template name",
    initialValue: row.name,
    submitLabel: "Save",
    selectValue: true,
    validate: (value) => {
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        throw new Error("Enter a template name.");
      }
      return trimmedValue;
    }
  });
  if (label === null) {
    return;
  }

  const template = {
    id: `${Date.now()}-${row.name}`,
    label,
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

  const template = await requestTemplateSelection();
  if (!template) {
    return;
  }

  elements.valueInput.value = template.value;
  updateSaveState();
  updateAutoToolOutput();
  showStatus(`Applied template ${template.label}. Save to write it.`, "success");
}

function requestImportPair() {
  const view = getCurrentView();
  return requestTextInput({
    title: `Import ${view.singular}`,
    fieldLabel: view.pairLabel,
    placeholder: view.pairLabel,
    submitLabel: "Import",
    validate: parsePairText
  });
}

function requestTemplateSelection() {
  const previouslyFocused = document.activeElement;
  elements.templateDialog.returnValue = "cancel";
  setTemplateDialogFeedback();
  renderTemplateOptions();

  return new Promise((resolve) => {
    elements.templateDialog.addEventListener("close", () => {
      const selected = elements.templateDialogOptions.querySelector('input[name="cookieTemplate"]:checked');
      const template = elements.templateDialog.returnValue === "apply"
        ? state.cookieTemplates[Number(selected?.value)]
        : null;
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
      resolve(template || null);
    }, { once: true });
    elements.templateDialog.showModal();
    elements.templateDialogOptions.querySelector("input")?.focus();
  });
}

function renderTemplateOptions(selectedTemplate = state.cookieTemplates[0]) {
  elements.templateDialogOptions.replaceChildren();

  state.cookieTemplates.forEach((template, index) => {
    const row = document.createElement("div");
    row.className = "template-option-row";

    const option = document.createElement("label");
    option.className = "template-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "cookieTemplate";
    input.value = String(index);
    input.checked = template === selectedTemplate;

    const copy = document.createElement("span");
    copy.className = "template-option-copy";
    const label = document.createElement("span");
    label.className = "template-option-label";
    label.textContent = template.label;
    const source = document.createElement("span");
    source.className = "template-option-source";
    source.textContent = template.name;
    copy.append(label, source);
    option.append(input, copy);

    const deleteButton = document.createElement("button");
    deleteButton.className = "template-option-delete danger-button";
    deleteButton.type = "button";
    deleteButton.title = `Delete ${template.label}`;
    deleteButton.setAttribute("aria-label", `Delete template ${template.label}`);
    deleteButton.append(createTemplateDeleteIcon());
    deleteButton.addEventListener("click", () => deleteCookieTemplate(template));

    row.append(option, deleteButton);
    elements.templateDialogOptions.append(row);
  });

  elements.templateDialogApplyButton.disabled = state.cookieTemplates.length === 0;
}

function createTemplateDeleteIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  for (const pathData of ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 15H6L5 6", "M10 11v6M14 11v6"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

async function deleteCookieTemplate(template) {
  const confirmed = await requestDeleteConfirmation({
    title: "Delete template?",
    message: `"${template.label}" will be permanently deleted.`,
    detail: template.name
  });
  if (!confirmed) {
    return;
  }

  const selectedIndex = Number(
    elements.templateDialogOptions.querySelector('input[name="cookieTemplate"]:checked')?.value
  );
  const selectedTemplate = state.cookieTemplates[selectedIndex];
  const templateIndex = state.cookieTemplates.indexOf(template);
  const nextTemplates = state.cookieTemplates.filter((_, index) => index !== templateIndex);
  const deleteButtons = Array.from(elements.templateDialogOptions.querySelectorAll(".template-option-delete"));
  deleteButtons.forEach((button) => {
    button.disabled = true;
  });
  elements.templateDialogApplyButton.disabled = true;

  try {
    await saveCookieTemplates(nextTemplates);
    state.cookieTemplates = nextTemplates;
    updateSelectionControls();

    if (nextTemplates.length === 0) {
      elements.templateDialog.close("cancel");
      showStatus(`Deleted template ${template.label}.`, "success");
      return;
    }

    const nextSelectedTemplate = selectedTemplate === template ? nextTemplates[0] : selectedTemplate;
    renderTemplateOptions(nextSelectedTemplate);
    setTemplateDialogFeedback(`Deleted template ${template.label}.`);
    elements.templateDialogOptions.querySelector('input[name="cookieTemplate"]:checked')?.focus();
  } catch (error) {
    deleteButtons.forEach((button) => {
      button.disabled = false;
    });
    elements.templateDialogApplyButton.disabled = false;
    setTemplateDialogFeedback(error?.message || "Failed to delete template.", "error");
  }
}

function setTemplateDialogFeedback(message = "", type = "success") {
  elements.templateDialogFeedback.textContent = message;
  elements.templateDialogFeedback.hidden = !message;
  elements.templateDialogFeedback.classList.toggle("is-error", type === "error");
}

async function loadCookieTemplates() {
  try {
    state.cookieTemplates = await getCookieTemplates();
  } catch {
    state.cookieTemplates = [];
  }
}

function parsePairText(text) {
  return parseNameValuePair(text, {
    kind: isCookieView() ? "cookie" : "storage"
  });
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
    clearStatus();
    showCopyFeedback(elements.copyToolOutputButton);
  } catch (error) {
    resetCopyFeedback(elements.copyToolOutputButton);
    showStatus(error?.message || "Failed to copy.", "error");
  }
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
  const cookieView = isCookieView();
  document.body.dataset.view = state.dataView;
  elements.searchInput.placeholder = isCookieView()
    ? "Search name, value, domain, path"
    : "Search key, value, origin";
  elements.refreshButton.title = `Refresh ${view.plural}`;
  elements.refreshButton.setAttribute("aria-label", `Refresh ${view.plural}`);
  const importLabel = `Import ${view.pairLabel}`;
  elements.importButton.setAttribute("aria-label", importLabel);
  elements.importButton.dataset.tooltip = importLabel;
  elements.detailsView.setAttribute("aria-label", `${view.title} editor`);
  elements.detailPlaceholder.textContent = `Select a ${view.singular}`;
  elements.expirationEditorCell.hidden = !cookieView;
  elements.metaExpires.hidden = cookieView;

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
    await savePreferences({
      columnWidths: state.columnWidths,
      columnWidthsVersion: COLUMN_WIDTHS_VERSION
    });
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
  await savePreferences({
    columnWidths: state.columnWidths,
    columnWidthsVersion: COLUMN_WIDTHS_VERSION
  });
}

function renderHeader(url) {
  const view = getCurrentView();
  elements.hostLabel.textContent = getDisplayHost(url);
  elements.cookieCount.textContent = `${state.rows.length} ${state.rows.length === 1 ? view.singular : view.plural}`;
}

function renderTable() {
  const visibleRows = getVisibleRows();
  const favoriteIds = new Set(visibleRows
    .filter((row) => isFavorite(row.id))
    .map((row) => row.id));
  renderDataTable({
    tableBody: elements.cookieTableBody,
    rows: visibleRows,
    selectedId: state.selectedId,
    selectedIds: state.selectedIds,
    favoriteIds,
    onSelect: selectItem,
    onToggle: toggleRowSelection
  });
  elements.emptyState.textContent = state.emptyMessage;
  elements.emptyState.hidden = state.loading || visibleRows.length > 0;
  renderHeader(state.tab?.url);
  updateActionAvailability();
  updateSelectionSummary();
}

function getVisibleRows() {
  let rows = state.rows;
  if (state.searchQuery) {
    const getSearchText = isCookieView() ? getCookieSearchText : getStorageSearchText;
    rows = rows.filter((row) => getSearchText(row).includes(state.searchQuery));
  }

  return sortFavoriteRowsFirst(rows, state.favoriteItemIds, state.dataView);
}

function isFavorite(itemId) {
  return state.favoriteItemIds.has(makeFavoriteItemId(state.dataView, itemId));
}

async function toggleFavorite(itemId, favorite) {
  const favoriteItemId = makeFavoriteItemId(state.dataView, itemId);
  const previousFavorites = new Set(state.favoriteItemIds);

  if (favorite) {
    state.favoriteItemIds.add(favoriteItemId);
  } else {
    state.favoriteItemIds.delete(favoriteItemId);
  }
  renderTable();
  updateEditorFavoriteButton();

  try {
    await saveFavoriteSiteDataIds([...state.favoriteItemIds]);
  } catch {
    state.favoriteItemIds = previousFavorites;
    renderTable();
    updateEditorFavoriteButton();
    showStatus("Failed to update favorites.", "error");
  }
}

async function loadFavoriteSiteDataIds() {
  try {
    state.favoriteItemIds = new Set(await getFavoriteSiteDataIds());
  } catch {
    state.favoriteItemIds = new Set();
  }
}

function startFavoriteWatcher() {
  if (!chrome.storage?.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[FAVORITE_SITE_DATA_IDS_KEY]) {
      return;
    }

    const nextFavoriteItemIds = new Set(normalizeFavoriteItemIds(
      changes[FAVORITE_SITE_DATA_IDS_KEY].newValue
    ));
    if (areSetsEqual(state.favoriteItemIds, nextFavoriteItemIds)) {
      return;
    }

    state.favoriteItemIds = nextFavoriteItemIds;
    renderTable();
    updateEditorFavoriteButton();
  });
}

function areSetsEqual(a, b) {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function selectItem(id) {
  const changed = state.selectedId !== id;
  state.selectedId = id;
  rememberCurrentSelection();
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
  elements.historyViewButton.classList.toggle("is-active", isHistoryView);
  elements.historyViewButton.setAttribute("aria-pressed", String(isHistoryView));
  updateHistoryButtonState();

  if (isHistoryView) {
    renderHistory();
  }
}

function renderSelectedItem() {
  const row = getSelectedRow();
  const hasSelection = Boolean(row);

  elements.detailPlaceholder.hidden = hasSelection;
  elements.cookieEditor.hidden = !hasSelection;
  updateEditorFavoriteButton();

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
  populateExpirationEditor(row);
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

function updateEditorFavoriteButton() {
  const row = getSelectedRow();
  const favorite = Boolean(row && isFavorite(row.id));
  const itemName = row?.name || "item";
  const label = favorite ? `Remove ${itemName} from favorites` : `Favorite ${itemName}`;

  elements.editorFavoriteButton.classList.toggle("is-favorite", favorite);
  elements.editorFavoriteButton.setAttribute("aria-pressed", String(favorite));
  elements.editorFavoriteButton.setAttribute("aria-label", label);
  elements.editorFavoriteButton.title = label;
  elements.editorFavoriteButton.disabled = !row;
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

function populateExpirationEditor(row) {
  if (!isCookieView()) {
    return;
  }

  elements.expirationInput.value = row.session || !Number.isFinite(row.raw?.expirationDate)
    ? ""
    : formatDateTimeLocal(row.raw.expirationDate);
  elements.expirationInput.min = formatDateTimeLocal(Date.now() / 1000 + 1);
  updateExpirationValidity();
}

function updateExpirationValidity() {
  elements.expirationInput.setCustomValidity("");
  if (!elements.expirationInput.value) {
    return;
  }

  const expirationDate = new Date(elements.expirationInput.value).getTime();
  if (!Number.isFinite(expirationDate)) {
    elements.expirationInput.setCustomValidity("Enter a valid expiration date and time.");
  } else if (expirationDate <= Date.now()) {
    elements.expirationInput.setCustomValidity("Expiration must be in the future.");
  }
}

function getExpirationDraft() {
  if (!elements.expirationInput.value) {
    return { session: true };
  }

  updateExpirationValidity();
  const expirationDate = new Date(elements.expirationInput.value).getTime() / 1000;
  if (!elements.expirationInput.validity.valid || !Number.isFinite(expirationDate)) {
    return null;
  }

  return {
    session: false,
    expirationDate
  };
}

function formatDateTimeLocal(expirationDate) {
  const date = new Date(expirationDate * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds())
  ].join("");
}

function hasSelectedItemChanges(row) {
  return Boolean(row) && (
    elements.valueInput.value !== row.value ||
    (isCookieView() && isExpirationDraftChanged(row))
  );
}

function isExpirationDraftChanged(row) {
  const draft = getExpirationDraft();
  if (!draft) {
    return true;
  }
  if (draft.session !== Boolean(row.session)) {
    return true;
  }
  if (draft.session) {
    return false;
  }

  return !Number.isFinite(row.raw?.expirationDate) ||
    Math.abs(draft.expirationDate - row.raw.expirationDate) >= 1;
}

function updateSaveState() {
  const row = getSelectedRow();
  const hasChanges = hasSelectedItemChanges(row);
  elements.saveButton.disabled = !hasChanges;
  elements.resetButton.disabled = !hasChanges;
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

  try {
    const snapshots = await getRecentChangeSnapshots();
    state.undoSnapshots = new Map(
      Object.entries(snapshots).filter(([changeId, snapshot]) => changeId && snapshot && typeof snapshot === "object")
    );
    pruneUndoSnapshots();
  } catch {
    state.undoSnapshots = new Map();
  }

  renderHistory();
}

async function safelyRecordRecentChange(row, nextValue, { savedCookie = null } = {}) {
  try {
    const itemKind = getHistoryItemKind();
    const afterCookie = savedCookie || row.raw;
    const recordOptions = { itemKind };
    if (itemKind === "cookie") {
      Object.assign(recordOptions, {
        beforeSession: Boolean(row.raw?.session),
        beforeExpirationDate: row.raw?.expirationDate,
        afterSession: Boolean(afterCookie?.session),
        afterExpirationDate: afterCookie?.expirationDate
      });
    }

    const record = createRecentChange(
      row,
      nextValue,
      getDisplayHost(state.tab?.url),
      Date.now(),
      recordOptions
    );
    const snapshot = {
      itemKind,
      raw: row.raw,
      storageType: row.type || getCurrentView().storageType,
      key: row.name,
      value: row.value,
      beforeValue: row.value,
      afterValue: nextValue
    };
    if (itemKind === "cookie") {
      Object.assign(snapshot, {
        beforeSession: Boolean(row.raw?.session),
        beforeExpirationDate: row.raw?.expirationDate,
        afterSession: Boolean(afterCookie?.session),
        afterExpirationDate: afterCookie?.expirationDate
      });
    }
    state.undoSnapshots.set(record.id, snapshot);
    state.unreadHistoryIds.add(record.id);
    state.recentChanges = normalizeRecentChanges([record, ...state.recentChanges]);
    renderHistory();
    await saveRecentHistory();
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
    await saveRecentHistory();
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
    showStatus("This change can no longer be undone in this browser session.", "error");
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
      rememberCurrentSelection();
    } else {
      if (snapshot.itemKind === "cookie") {
        const restored = await setCookieValue(state.tab.url, snapshot.raw, snapshot.value);
        state.selectedId = toCookieRow(restored).id;
      } else {
        const restored = await setStorageValue(state.tab.id, state.tab.url, snapshot.storageType, snapshot.key, snapshot.value);
        state.selectedId = toStorageRow(restored).id;
      }
      rememberCurrentSelection();
    }

    state.undoSnapshots.delete(changeId);
    state.unreadHistoryIds.delete(changeId);
    if (state.selectedHistoryId === changeId) {
      clearHistoryDetail();
    }
    renderHistory();
    await safelySaveRecentChangeSnapshots();
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
      await Promise.all([
        clearRecentCookieChanges(),
        clearRecentChangeSnapshots()
      ]);
    } else {
      await saveRecentHistory();
    }
    state.selectedHistoryId = "";
    clearHistoryDetail();
    renderHistory();
    showStatus(`${getCurrentView().title} history cleared.`, "success");
  } catch (error) {
    showStatus(error?.message || "Failed to clear recent changes.", "error");
  }
}

function pruneUndoSnapshots() {
  const retainedIds = new Set(state.recentChanges.map((change) => change.id));
  for (const changeId of state.undoSnapshots.keys()) {
    if (!retainedIds.has(changeId)) {
      state.undoSnapshots.delete(changeId);
    }
  }
}

function serializeUndoSnapshots() {
  pruneUndoSnapshots();
  return Object.fromEntries(state.undoSnapshots);
}

async function saveRecentHistory() {
  await Promise.all([
    saveRecentCookieChanges(state.recentChanges),
    saveRecentChangeSnapshots(serializeUndoSnapshots())
  ]);
}

async function safelySaveRecentChangeSnapshots() {
  try {
    await saveRecentChangeSnapshots(serializeUndoSnapshots());
  } catch {
    // Undo should not fail because its session snapshot could not be removed.
  }
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
    elements.editorFavoriteButton.disabled = true;
    return;
  }

  elements.dataViewButtons.forEach((button) => {
    button.disabled = false;
  });
  const hasSelection = Boolean(getSelectedRow());
  elements.deleteButton.disabled = !hasSelection;
  updateEditorFavoriteButton();
  updateActionAvailability();
  updateSelectionControls();
}

function setPermissionBanner(visible, message = "Site permission is required for this page.") {
  elements.permissionBanner.hidden = !visible;
  elements.permissionMessage.textContent = message;
}
