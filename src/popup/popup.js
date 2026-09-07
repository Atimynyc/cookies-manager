import {
  activateTab,
  getActiveTab,
  getWindowHttpTabs,
  hasSitePermission,
  openSidePanel,
  reloadTab,
  removeCookie,
  setCookieData,
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
  getFavoriteSiteDataIds,
  getLastViewedSiteData,
  getPreferences,
  normalizeLastViewedSiteData,
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
import { createCookiePair, createStoragePair } from "../shared/pair-parser.js";
import { executeBatchOperation } from "../shared/batch-operations.js";
import {
  addOperationSkip,
  createBatchOperationResult,
  getBatchOperationCounts
} from "../shared/operation-result.js";
import {
  createSiteDataPackage,
  parseSiteDataPackage
} from "../shared/site-data-package.js";
import {
  buildSiteDataImportPreview,
  planSiteDataImport
} from "../shared/site-data-import.js";
import {
  createSiteProfile,
  duplicateSiteProfile,
  renameSiteProfile,
  resolveSiteProfileVariables
} from "../shared/site-profiles.js";
import {
  getSiteProfiles,
  saveSiteProfiles
} from "../shared/site-profile-store.js";
import {
  clearLatestBatchSnapshot,
  getLatestBatchSnapshot,
  saveLatestBatchSnapshot
} from "../shared/batch-snapshot-store.js";
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
import {
  readAllSiteDataRows,
  readSiteDataRows,
  resolveCookieStoreId
} from "./popup-data-service.js";
import { cancelDialogFromBackdrop, createDialogController } from "./popup-dialogs.js";
import { createClipboardFeedback, createStatusController, writeClipboard } from "./popup-feedback.js";
import { renderDataTable } from "./popup-table-view.js";
import { createHistoryView } from "./popup-history-view.js";
import { createSiteDataWorkbench } from "./popup-workbench.js";

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
  batchActions: document.querySelector("#batchActions"),
  selectAllCheckbox: document.querySelector("#selectAllCheckbox"),
  batchEditButton: document.querySelector("#batchEditButton"),
  batchDeleteButton: document.querySelector("#batchDeleteButton"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  profilesButton: document.querySelector("#profilesButton"),
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
  resetButton: document.querySelector("#resetButton"),
  deleteButton: document.querySelector("#deleteButton"),
  saveButton: document.querySelector("#saveButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmDialogTitle: document.querySelector("#confirmDialogTitle"),
  confirmDialogMessage: document.querySelector("#confirmDialogMessage"),
  confirmDialogDetail: document.querySelector("#confirmDialogDetail"),
  confirmDialogDeleteButton: document.querySelector("#confirmDialogDeleteButton"),
  textInputDialog: document.querySelector("#textInputDialog"),
  textInputDialogForm: document.querySelector("#textInputDialogForm"),
  textInputDialogTitle: document.querySelector("#textInputDialogTitle"),
  textInputDialogFieldLabel: document.querySelector("#textInputDialogFieldLabel"),
  textInputDialogInput: document.querySelector("#textInputDialogInput"),
  textInputDialogError: document.querySelector("#textInputDialogError"),
  textInputDialogSubmitButton: document.querySelector("#textInputDialogSubmitButton"),
  workbenchDialog: document.querySelector("#workbenchDialog"),
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

const dialogController = createDialogController(elements);
const requestDeleteConfirmation = dialogController.requestConfirmation;
const requestTextInput = dialogController.requestTextInput;
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
const workbench = createSiteDataWorkbench({
  dialog: elements.workbenchDialog,
  getContext: getWorkbenchContext,
  onPreview: previewSiteDataPackage,
  onApply: applySiteDataPackage,
  onUndo: undoLatestSiteDataBatch,
  onQuickImport: importQuickEntries,
  onBuildPackage: buildSiteDataExportForScope,
  onExportSelectionChange: updateExportSelection,
  onCopy: writeClipboard,
  onSaveJson: saveJsonFile,
  onSaveText: saveTextFile,
  onLoadProfiles: getSiteProfiles,
  onCreateProfile: createProfileFromCurrentSite,
  onRenameProfile: renameSavedProfile,
  onDuplicateProfile: duplicateSavedProfile,
  onDeleteProfile: deleteSavedProfile,
  onExportProfile: exportSavedProfile,
  onResolveProfile: resolveSiteProfileVariables
});

const popupParams = new URLSearchParams(location.search);
const surface = popupParams.get("surface") === "sidepanel" ? "sidepanel" : "popup";
document.documentElement.dataset.surface = surface;
document.body.dataset.surface = surface;

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
  elements.exportButton.addEventListener("click", () => workbench.open("export"));
  elements.importButton.addEventListener("click", () => workbench.open("import"));
  elements.profilesButton.addEventListener("click", () => workbench.open("profiles"));
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
  for (const dialog of [
    elements.confirmDialog,
    elements.textInputDialog
  ]) {
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

function getWorkbenchContext() {
  return {
    targetUrl: state.tab?.url || "",
    targetLabel: state.tab?.url ? `${getDisplayHost(state.tab.url)} · ${getCurrentView().title}` : "No supported target",
    currentViewLabel: getCurrentView().title,
    currentKind: state.dataView,
    currentCount: state.rows.length,
    selectedCount: state.selectedIds.size,
    selectedIds: [...state.selectedIds],
    currentRows: state.rows.map((row) => ({
      id: row.id,
      name: row.name,
      location: getRowLocation(row),
      kind: state.dataView
    })),
    cookieStoreId: state.cookieStoreId
  };
}

function updateExportSelection(ids) {
  const availableIds = new Set(state.rows.map((row) => row.id));
  state.selectedIds = new Set(ids.filter((id) => availableIds.has(id)));
  renderTable();
}

async function buildSiteDataExportForScope(scope) {
  const dataPackage = await buildSiteDataPackageForScope(scope);
  const count = Object.values(dataPackage.data)
    .reduce((total, items) => total + items.length, 0);
  return {
    ...dataPackage,
    url: state.tab.url,
    host: getDisplayHost(state.tab.url),
    type: scope === "all" ? "siteData" : state.dataView,
    count
  };
}

async function buildSiteDataPackageForScope(scope) {
  if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
    throw new Error("Open an HTTP or HTTPS page before exporting site data.");
  }

  let rowsByKind;
  if (scope === "all") {
    rowsByKind = await readAllSiteDataRows(state.tab, state.cookieStoreId);
  } else {
    const rows = scope === "selected" ? getSelectedRows() : state.rows;
    if (scope === "selected" && rows.length === 0) {
      throw new Error("Select at least one item before exporting.");
    }
    rowsByKind = { cookies: [], localStorage: [], sessionStorage: [] };
    rowsByKind[state.dataView] = rows;
  }

  return createSiteDataPackage({
    url: state.tab.url,
    origin: getSiteOrigin(state.tab.url),
    cookies: rowsByKind.cookies,
    localStorage: rowsByKind.localStorage,
    sessionStorage: rowsByKind.sessionStorage
  });
}

async function previewSiteDataPackage(dataPackage, options) {
  if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
    throw new Error("Open an HTTP or HTTPS page before importing site data.");
  }
  const rows = await readAllSiteDataRows(state.tab, state.cookieStoreId);
  return buildSiteDataImportPreview(parseSiteDataPackage(dataPackage), {
    cookies: rows.cookies.map((row) => row.raw),
    localStorage: rows.localStorage.map((row) => row.raw),
    sessionStorage: rows.sessionStorage.map((row) => row.raw)
  }, {
    targetUrl: state.tab.url,
    ...options
  });
}

async function applySiteDataPackage(preview, { strategy, selectedIds, onProgress }) {
  if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
    throw new Error("The target page is no longer available.");
  }

  const plan = planSiteDataImport(preview, { strategy, selectedIds });
  const result = createBatchOperationResult();
  plan.skipped.forEach(({ item, reason }) => addOperationSkip(result, item, reason));
  suppressCookieWatcher(Math.max(1500, plan.write.length * 30));

  const executed = await executeBatchOperation(plan.write, writeImportedSiteDataItem, {
    onProgress,
    yieldEvery: 10
  });
  result.success.push(...executed.success);
  result.failed.push(...executed.failed);

  const entries = executed.success.map((entry, index) => ({
    id: `${Date.now()}-${index}-${entry.item.id}`,
    kind: entry.item.kind,
    name: entry.item.name,
    before: entry.item.current,
    after: entry.value
  }));
  if (entries.length > 0) {
    await saveLatestBatchSnapshot({
      id: `${Date.now()}-site-data-import`,
      createdAt: new Date().toISOString(),
      targetUrl: state.tab.url,
      targetOrigin: getSiteOrigin(state.tab.url),
      tabId: state.tab.id,
      entries
    });
  }

  await refreshData();
  if (state.autoRefreshPage && entries.length > 0) {
    await reloadTab(state.tab.id);
  }
  showBatchImportStatus(result);
  return { result, canUndo: entries.length > 0 };
}

async function writeImportedSiteDataItem(item) {
  if (item.kind === "cookies") {
    return setCookieData(state.tab.url, item.incoming);
  }
  const storageType = item.kind === "sessionStorage" ? "session" : "local";
  return setStorageValue(
    state.tab.id,
    state.tab.url,
    storageType,
    item.incoming.key,
    item.incoming.value
  );
}

async function undoLatestSiteDataBatch({ onProgress } = {}) {
  const snapshot = await getLatestBatchSnapshot();
  if (!snapshot || snapshot.entries.length === 0) {
    throw new Error("No import snapshot is available in this browser session.");
  }
  if (!state.tab?.url || snapshot.tabId !== state.tab.id || snapshot.targetOrigin !== getSiteOrigin(state.tab.url)) {
    throw new Error("Return to the original target tab before undoing this import.");
  }

  suppressCookieWatcher(Math.max(1500, snapshot.entries.length * 30));
  const entries = [...snapshot.entries].reverse();
  const result = await executeBatchOperation(entries, undoImportedSiteDataItem, {
    onProgress,
    yieldEvery: 10
  });
  const failedIds = new Set(result.failed.map((entry) => entry.item.id));
  const remainingEntries = snapshot.entries.filter((entry) => failedIds.has(entry.id));
  if (remainingEntries.length > 0) {
    await saveLatestBatchSnapshot({ ...snapshot, entries: remainingEntries });
  } else {
    await clearLatestBatchSnapshot();
  }

  await refreshData();
  if (state.autoRefreshPage) {
    await reloadTab(state.tab.id);
  }
  showStatus(
    remainingEntries.length > 0
      ? `Undo restored ${result.success.length} items; ${result.failed.length} failed.`
      : `Undid ${result.success.length} imported items.`,
    remainingEntries.length > 0 ? "error" : "success"
  );
  return { result, complete: remainingEntries.length === 0 };
}

async function undoImportedSiteDataItem(entry) {
  if (entry.before) {
    if (entry.kind === "cookies") {
      return setCookieData(state.tab.url, entry.before);
    }
    return setStorageValue(
      state.tab.id,
      state.tab.url,
      entry.kind === "sessionStorage" ? "session" : "local",
      entry.before.key,
      entry.before.value
    );
  }

  if (entry.kind === "cookies") {
    await removeCookie(state.tab.url, entry.after);
  } else {
    await removeStorageItem(
      state.tab.id,
      state.tab.url,
      entry.kind === "sessionStorage" ? "session" : "local",
      entry.after.key
    );
  }
  return null;
}

function showBatchImportStatus(result) {
  const counts = getBatchOperationCounts(result);
  const summary = `${counts.success} written, ${counts.failed} failed, ${counts.skipped} skipped.`;
  showStatus(summary, counts.failed ? "error" : counts.success ? "success" : "warning");
}

async function createProfileFromCurrentSite(options) {
  const dataPackage = await buildSiteDataPackageForScope(options.scope);
  const profile = createSiteProfile({
    name: options.name,
    description: options.description,
    tags: options.tags,
    dataPackage,
    defaultConflictStrategy: options.defaultConflictStrategy,
    variables: options.variables
  });
  const profiles = await getSiteProfiles();
  return saveSiteProfiles([profile, ...profiles]);
}

async function renameSavedProfile(profile) {
  const name = await requestTextInput({
    title: "Rename saved state",
    fieldLabel: "Saved state name",
    initialValue: profile.name,
    submitLabel: "Rename",
    selectValue: true,
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        throw new Error("Enter a saved state name.");
      }
      return trimmed;
    }
  });
  const profiles = await getSiteProfiles();
  if (name === null) {
    return profiles;
  }
  return saveSiteProfiles(profiles.map((item) => item.id === profile.id ? renameSiteProfile(item, name) : item));
}

async function duplicateSavedProfile(profile) {
  const profiles = await getSiteProfiles();
  return saveSiteProfiles([duplicateSiteProfile(profile), ...profiles]);
}

async function deleteSavedProfile(profile) {
  const confirmed = await requestDeleteConfirmation({
    title: "Delete saved state?",
    message: `"${profile.name}" will be permanently deleted.`,
    detail: profile.source.origin
  });
  const profiles = await getSiteProfiles();
  if (!confirmed) {
    return profiles;
  }
  return saveSiteProfiles(profiles.filter((item) => item.id !== profile.id));
}

async function exportSavedProfile(profile) {
  const fileName = `${profile.name.replace(/[^a-z0-9.-]+/gi, "-") || "site-profile"}.json`;
  await saveJsonFile({ profileSchemaVersion: 1, profile }, fileName);
}

async function saveJsonFile(value, fileName) {
  await saveTextFile(JSON.stringify(value, null, 2), fileName, "application/json");
}

async function saveTextFile(text, fileName, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importQuickEntries(input) {
  if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
    throw new Error(`Open an http:// or https:// page before importing ${getCurrentView().plural}.`);
  }

  const pairs = validateQuickInputRows(input, isCookieView() ? "cookie" : "storage");

  setBusy(true);
  clearStatus();
  suppressCookieWatcher(Math.max(1500, pairs.length * 30));

  try {
    const previousRows = new Map(pairs.map((pair) => [pair.name, findLikelyImportedRow(pair.name)]));
    const result = await executeBatchOperation(pairs, async (pair) => {
      const importedRow = await importPair(pair);
      await safelyRecordImportChange(importedRow, pair.value, previousRows.get(pair.name));
      return importedRow;
    });
    const lastImportedRow = result.success.at(-1)?.value;
    if (lastImportedRow) {
      state.selectedId = lastImportedRow.id;
      rememberCurrentSelection();
    }
    await refreshData();

    if (state.autoRefreshPage && result.success.length > 0) {
      await reloadTab(state.tab.id);
    }

    showImportStatus(pairs, result);
  } catch (error) {
    showStatus(error?.message || `Failed to import ${getCurrentView().singular}.`, "error");
    throw error;
  } finally {
    setBusy(false);
  }
}

function validateQuickInputRows(rows, kind) {
  const cookies = kind === "cookie";
  const createPair = cookies ? createCookiePair : createStoragePair;
  const nameLabel = cookies ? "Cookie name" : "Storage key";
  const pairs = [];
  const names = new Set();
  for (const [index, row] of rows.entries()) {
    const name = String(row?.name || "").trim();
    const value = String(row?.value ?? "");
    if (!name && !value) {
      continue;
    }
    let pair;
    try {
      pair = createPair(name, value);
    } catch (error) {
      error.message = `Row ${index + 1}: ${error.message}`;
      error.rowIndex = index;
      throw error;
    }
    if (names.has(pair.name)) {
      const error = new TypeError(`Row ${index + 1}: ${nameLabel} "${pair.name}" is duplicated.`);
      error.rowIndex = index;
      throw error;
    }
    names.add(pair.name);
    pairs.push(pair);
  }
  if (pairs.length === 0) {
    const error = new TypeError(`Enter at least one ${nameLabel.toLowerCase()}.`);
    error.rowIndex = 0;
    throw error;
  }
  return pairs;
}

function showImportStatus(pairs, result) {
  const counts = getBatchOperationCounts(result);
  if (pairs.length === 1) {
    if (counts.success === 1) {
      showStatus(`Imported ${pairs[0].name}.`, "success");
    } else {
      showStatus(
        result.failed[0]?.error?.message || `Failed to import ${getCurrentView().singular}.`,
        "error"
      );
    }
    return;
  }
  if (counts.failed === 0) {
    const view = getCurrentView();
    showStatus(`Imported ${counts.success} ${counts.success === 1 ? view.singular : view.plural}.`, "success");
    return;
  }
  const view = getCurrentView();
  const itemLabel = counts.success === 1 ? view.singular : view.plural;
  const firstError = result.failed[0]?.error?.message;
  showStatus(
    `Imported ${counts.success} ${itemLabel}, ${counts.failed} failed.${firstError ? ` ${firstError}` : ""}`,
    "error"
  );
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
  elements.importButton.setAttribute("aria-label", "Import");
  elements.importButton.dataset.tooltip = "Import";
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
  elements.batchActions.hidden = selectedCount === 0;
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
  const tooltip = isCookieView() ? `My favorite cookie ${itemName}` : label;

  elements.editorFavoriteButton.classList.toggle("is-favorite", favorite);
  elements.editorFavoriteButton.setAttribute("aria-pressed", String(favorite));
  elements.editorFavoriteButton.setAttribute("aria-label", label);
  elements.editorFavoriteButton.title = tooltip;
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
  elements.exportButton.disabled = state.loading || !supportedPage;
  elements.importButton.disabled = state.loading || !supportedPage;
  elements.profilesButton.disabled = state.loading || !supportedPage;
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
    elements.profilesButton.disabled = true;
    elements.batchEditButton.disabled = true;
    elements.batchDeleteButton.disabled = true;
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
