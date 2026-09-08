import {
  activateTab,
  getActiveTab,
  getWindowHttpTabs,
  hasSitePermission,
  openSidePanel,
  reloadTab,
  setCookiePair,
  watchCookieChanges
} from "../shared/cookie-api.js";
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
  setStoragePair
} from "../shared/storage-api.js";
import {
  getStorageJson,
  getStorageSearchText,
  getStorageTypeLabel,
  toStorageRow
} from "../shared/storage-format.js";
import { getDisplayHost, getSiteOrigin, isSupportedPageUrl } from "../shared/url.js";
import { getAutoValueToolOutput } from "../shared/value-tools.js";
import { createCookiePair, createStoragePair } from "../shared/pair-parser.js";
import { executeBatchOperation } from "../shared/batch-operations.js";
import {
  getBatchOperationCounts
} from "../shared/operation-result.js";
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
  readSiteDataRows,
  resolveCookieStoreId
} from "./popup-data-service.js";
import { cancelDialogFromBackdrop, createDialogController } from "./popup-dialogs.js";
import { createClipboardFeedback, createStatusController, writeClipboard } from "./popup-feedback.js";
import { renderDataTable } from "./popup-table-view.js";
import { createHistoryView } from "./popup-history-view.js";
import { createPopupHistoryController } from "./popup-history-controller.js";
import { createPopupItemActionsController } from "./popup-item-actions-controller.js";

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
let workbenchPromise = null;
let workbenchOpening = false;

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
let historyController;
const historyView = createHistoryView({
  state,
  elements,
  getHistoryItemKind,
  onSelectHistoryView: () => setActiveDetailView("history"),
  onUndo: (changeId) => historyController.undoRecentChange(changeId)
});
const {
  clearHistoryDetail,
  getVisibleRecentChanges,
  renderHistory,
  updateHistoryButtonState
} = historyView;
historyController = createPopupHistoryController({
  state,
  getCurrentView,
  getHistoryItemKind,
  rememberCurrentSelection,
  clearHistoryDetail,
  renderHistory,
  refreshData,
  suppressCookieWatcher,
  setBusy,
  showStatus,
  clearStatus
});
const itemActions = createPopupItemActionsController({
  state,
  elements,
  getCurrentView,
  isCookieView,
  getSelectedRow,
  getSelectedRows,
  getExpirationDraft,
  hasSelectedItemChanges,
  getRowLocation,
  getRowJson,
  populateExpirationEditor,
  updateSaveState,
  updateAutoToolOutput,
  rememberCurrentSelection,
  refreshData,
  recordRecentChange: historyController.recordRecentChange,
  suppressCookieWatcher,
  requestDeleteConfirmation,
  requestTextInput,
  setBusy,
  showStatus,
  clearStatus,
  writeClipboard,
  showCopyFeedback,
  resetCopyFeedback
});

const popupParams = new URLSearchParams(location.search);
const surface = popupParams.get("surface") === "sidepanel" ? "sidepanel" : "popup";
document.documentElement.dataset.surface = surface;
document.body.dataset.surface = surface;

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindEvents();

  const historyPromise = historyController.loadRecentChanges();
  await Promise.all([
    loadPreferences(),
    loadFavoriteSiteDataIds()
  ]);
  await refreshData();
  await historyPromise;
  startCookieWatcher();
  startFavoriteWatcher();
}

async function loadPreferences() {
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
      void savePreferences({
        columnWidths: state.columnWidths,
        columnWidthsVersion: COLUMN_WIDTHS_VERSION
      }).catch(() => {
        // The migrated widths are still applied for the current view.
      });
    }
  } catch {
    state.autoRefreshPage = false;
    state.valueToolMode = "none";
    state.columnWidths = [...DEFAULT_COLUMN_WIDTHS];
    elements.autoRefreshToggle.checked = false;
    updateRefreshControlState();
    applyColumnWidths();
  }
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
  elements.batchEditButton.addEventListener("click", itemActions.batchEditSelected);
  elements.batchDeleteButton.addEventListener("click", itemActions.batchDeleteSelected);
  elements.exportButton.addEventListener("click", () => void openWorkbench("export"));
  elements.importButton.addEventListener("click", () => void openWorkbench("import"));
  elements.profilesButton.addEventListener("click", () => void openWorkbench("profiles"));
  elements.searchInput.addEventListener("input", () => {
    state.searchQuery = elements.searchInput.value.trim().toLowerCase();
    renderTable();
  });
  elements.autoRefreshToggle.addEventListener("change", async () => {
    state.autoRefreshPage = elements.autoRefreshToggle.checked;
    updateRefreshControlState();
    await savePreferences({ autoRefreshPage: state.autoRefreshPage });
  });
  elements.cookieEditor.addEventListener("submit", itemActions.saveSelectedItem);
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
  elements.resetButton.addEventListener("click", itemActions.resetSelectedItem);
  elements.deleteButton.addEventListener("click", itemActions.deleteSelectedItem);
  elements.editorFavoriteButton.addEventListener("click", () => {
    const row = getSelectedRow();
    if (row) {
      void toggleFavorite(row.id, !isFavorite(row.id));
    }
  });
  elements.copyValueButton.addEventListener("click", () => itemActions.copySelected("value", elements.copyValueButton));
  elements.copyPairButton.addEventListener("click", () => itemActions.copySelected("pair", elements.copyPairButton));
  elements.copyJsonButton.addEventListener("click", () => itemActions.copySelected("json", elements.copyJsonButton));
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
  elements.clearHistoryButton.addEventListener("click", historyController.clearHistory);
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
    renderHeader(tab?.url);

    const supportedPage = Boolean(tab?.url && isSupportedPageUrl(tab.url));
    const [, , cookieStoreId] = await Promise.all([
      restoreLastViewedSiteData(tab?.url),
      refreshSiteOptions(tab?.id),
      supportedPage ? resolveCookieStoreId(tab) : Promise.resolve("")
    ]);
    const view = getCurrentView();

    if (!supportedPage) {
      state.rows = [];
      state.selectedId = "";
      state.emptyMessage = "This page is not supported";
      renderHeader(tab?.url);
      renderTable();
      renderSelectedItem();
      showStatus(view.unsupportedMessage, "error");
      return;
    }

    state.cookieStoreId = cookieStoreId;
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

async function getWorkbench() {
  if (!workbenchPromise) {
    workbenchPromise = Promise.all([
      import("./popup-workbench.js"),
      import("./popup-site-data-controller.js"),
      import("./popup-downloads.js")
    ]).then(([
      { createSiteDataWorkbench },
      { createPopupSiteDataController },
      { saveJsonFile, saveTextFile }
    ]) => {
      const siteDataController = createPopupSiteDataController({
        state,
        getSelectedRows,
        refreshData,
        suppressCookieWatcher,
        showStatus,
        requestDeleteConfirmation,
        requestTextInput
      });

      return createSiteDataWorkbench({
        dialog: elements.workbenchDialog,
        getContext: getWorkbenchContext,
        onPreview: siteDataController.previewPackage,
        onApply: siteDataController.applyPackage,
        onUndo: siteDataController.undoLatestBatch,
        onQuickImport: importQuickEntries,
        onBuildPackage: siteDataController.buildExportForScope,
        onExportSelectionChange: updateExportSelection,
        onCopy: writeClipboard,
        onSaveJson: saveJsonFile,
        onSaveText: saveTextFile,
        onLoadProfiles: siteDataController.getProfiles,
        onCreateProfile: siteDataController.createProfileFromCurrentSite,
        onRenameProfile: siteDataController.renameSavedProfile,
        onDuplicateProfile: siteDataController.duplicateSavedProfile,
        onDeleteProfile: siteDataController.deleteSavedProfile,
        onExportProfile: siteDataController.exportSavedProfile,
        onResolveProfile: siteDataController.resolveProfileVariables
      });
    }).catch((error) => {
      workbenchPromise = null;
      throw error;
    });
  }

  return workbenchPromise;
}

async function openWorkbench(view) {
  if (workbenchOpening) {
    return;
  }

  workbenchOpening = true;
  try {
    const workbench = await getWorkbench();
    await workbench.open(view);
  } catch (error) {
    showStatus(error?.message || "Failed to open site data tools.", "error");
  } finally {
    workbenchOpening = false;
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
      await historyController.recordImportChange(importedRow, pair.value, previousRows.get(pair.name));
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
  elements.loadingState.textContent = view.loadingMessage;
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
  updateSelectionSummary(visibleRows);
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

function selectItem(id, rowElement) {
  const changed = state.selectedId !== id;
  state.selectedId = id;
  rememberCurrentSelection();

  if (!rowElement?.isConnected || rowElement.dataset.itemId !== id) {
    renderTable();
  } else if (changed) {
    elements.cookieTableBody.querySelector("tr.is-selected")?.classList.remove("is-selected");
    rowElement.classList.add("is-selected");
  }

  renderSelectedItem();

  if (changed) {
    setActiveDetailView("details");
    elements.cookieEditor.scrollTop = 0;
  }
}

function toggleRowSelection(id, selected, rowElement) {
  if (selected) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  if (!rowElement?.isConnected || rowElement.dataset.itemId !== id) {
    renderTable();
    return;
  }

  rowElement.classList.toggle("is-checked", selected);
  updateSelectionSummary();
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

function updateSelectionSummary(visibleRows = null) {
  const selectedCount = state.selectedIds.size;
  const visibleRowCount = visibleRows
    ? visibleRows.length
    : elements.cookieTableBody.rows.length;
  const visibleSelectedCount = visibleRows
    ? visibleRows.filter((row) => state.selectedIds.has(row.id)).length
    : elements.cookieTableBody.querySelectorAll(".select-cell input:checked").length;
  elements.selectionCount.textContent = `${selectedCount} selected`;
  elements.batchActions.hidden = selectedCount === 0;
  elements.batchEditButton.disabled = selectedCount === 0;
  elements.batchDeleteButton.disabled = selectedCount === 0;
  elements.selectAllCheckbox.checked = visibleRowCount > 0 && visibleSelectedCount === visibleRowCount;
  elements.selectAllCheckbox.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleRowCount;
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

function getHistoryItemKind() {
  return {
    cookies: "cookie",
    localStorage: "localStorage",
    sessionStorage: "sessionStorage"
  }[state.dataView] || "cookie";
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
