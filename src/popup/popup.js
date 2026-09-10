import {
  activateTab,
  getActiveTab,
  getWindowHttpTabs,
  hasSitePermission,
  openSidePanel,
  watchCookieChanges
} from "../shared/cookie-api.js";
import {
  FAVORITE_SITE_DATA_IDS_KEY,
  getFavoriteSiteDataIds,
  getLastViewedSiteData,
  getPreferences,
  normalizeLastViewedSiteData,
  setFavoriteSiteDataId,
  saveLastViewedSiteData,
  savePreferences
} from "../shared/settings-store.js";
import {
  makeFavoriteItemId,
  normalizeFavoriteItemIds,
  sortFavoriteRowsFirst,
  sortRowsByName
} from "../shared/favorites.js";
import {
  getCookieJson,
  getCookieSearchText,
  toCookieRow
} from "../shared/cookie-format.js";
import {
  getStorageJson,
  getStorageSearchText,
  getStorageTypeLabel,
  toStorageRow
} from "../shared/storage-format.js";
import { getDisplayHost, getSiteOrigin, isSupportedPageUrl } from "../shared/url.js";
import { getAutoValueToolOutput } from "../shared/value-tools.js";
import { createCookiePair, createStoragePair } from "../shared/pair-parser.js";
import { runOperation } from "../shared/operation-client.js";
import { operationToBatchResult } from "../shared/operation-presentation.js";
import { getSiteDataItemId } from "../shared/item-identity.js";
import { assertOperationContext, createOperationContext, reloadOperationTarget } from "../shared/operation-context.js";
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
import { createEditorDraftStore, getEditorDraftKey, getEditorRowSignature } from "./popup-editor-drafts.js";
import { createOperationsView } from "./popup-operations-view.js";

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
  selectedOnly: false,
  selectedSearchQuery: "",
  nameSortDirections: {
    cookies: "none",
    localStorage: "none",
    sessionStorage: "none"
  },
  autoRefreshPage: false,
  valueToolMode: "none",
  columnWidths: [...DEFAULT_COLUMN_WIDTHS],
  recentChanges: [],
  undoSnapshots: new Map(),
  unreadHistoryIds: new Set(),
  selectedHistoryId: "",
  activeDetailView: "details",
  activeValueView: "raw",
  toolOutputText: "",
  toolOutputTitle: "",
  emptyMessage: "No cookies for this page",
  ignoreCookieChangesUntil: 0,
  loading: false,
  busy: false
};

const COPY_MODES = Object.freeze({
  value: "Copy value",
  pair: "Copy name=value",
  json: "Copy JSON"
});

const VALUE_WORKSPACE_DEFAULT_HEIGHT = 146;
const VALUE_WORKSPACE_FOOTER_HEIGHT = 34;
const VALUE_WORKSPACE_MAX_HEIGHT = 360;

let lastViewedSavePromise = Promise.resolve();
let workbenchPromise = null;
let workbenchOpening = false;
let selectedCopyMode = "value";
let refreshRequestId = 0;
let cookieRefreshTimer = 0;
let renderedEditor = null;
const editorDrafts = createEditorDraftStore();
const pendingFavoriteIds = new Set();

const elements = {
  hostLabel: document.querySelector("#hostLabel"),
  siteIcon: document.querySelector("#siteIcon"),
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
  selectionCountLabel: document.querySelector("#selectionCountLabel"),
  batchActions: document.querySelector("#batchActions"),
  selectAllCheckbox: document.querySelector("#selectAllCheckbox"),
  batchEditButton: document.querySelector("#batchEditButton"),
  batchDeleteButton: document.querySelector("#batchDeleteButton"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  profilesButton: document.querySelector("#profilesButton"),
  nameSortHeader: document.querySelector(".name-sort-header"),
  nameSortButton: document.querySelector("#nameSortButton"),
  nameSortLabel: document.querySelector("#nameSortLabel"),
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
  valueWorkspace: document.querySelector(".value-workspace"),
  valueViewSwitch: document.querySelector("#valueViewSwitch"),
  valueViewLabel: document.querySelector("#valueViewLabel"),
  valueViewToggleButton: document.querySelector("#valueViewToggleButton"),
  valueViewToggleIcon: document.querySelector("#valueViewToggleIcon"),
  expirationEditorCell: document.querySelector("#expirationEditorCell"),
  expirationInput: document.querySelector("#expirationInput"),
  valueToolsControl: document.querySelector("#valueToolsControl"),
  valueToolsButton: document.querySelector("#valueToolsButton"),
  valueToolsMenu: document.querySelector("#valueToolsMenu"),
  valueToolButtons: Array.from(document.querySelectorAll("#valueToolsMenu [data-value-tool]")),
  toolOutput: document.querySelector("#toolOutput"),
  toolOutputBody: document.querySelector("#toolOutputBody"),
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
  copyControl: document.querySelector("#copyControl"),
  copyButton: document.querySelector("#copyButton"),
  copyMenuButton: document.querySelector("#copyMenuButton"),
  copyMenu: document.querySelector("#copyMenu"),
  copyModeButtons: Array.from(document.querySelectorAll("#copyMenu [data-copy-mode]")),
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
  renderHistory: renderHistoryChanges,
  updateHistoryButtonState
} = historyView;
function renderHistory() {
  renderHistoryChanges();
  operationsView.render();
}
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
  updateValueWorkspaceHeight,
  updateSaveState,
  updateAutoToolOutput,
  prepareRowForSave,
  discardEditorDraft,
  rememberCurrentSelection,
  refreshData,
  loadRecentChanges: historyController.loadRecentChanges,
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
const operationsView = createOperationsView({
  state, loadRecentChanges: historyController.loadRecentChanges, refreshData,
  setBusy, showStatus, requestDeleteConfirmation
});

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindEvents();
  operationsView.initialize();

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
    updateValueToolControl();
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
    updateValueToolControl();
    updateRefreshControlState();
    applyColumnWidths();
  }
}

function bindEvents() {
  elements.siteIcon.addEventListener("load", () => {
    elements.siteIcon.hidden = false;
  });
  elements.siteIcon.addEventListener("error", () => {
    elements.siteIcon.hidden = true;
  });
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
  elements.selectionCount.addEventListener("click", toggleSelectedOnly);
  elements.nameSortButton.addEventListener("click", toggleNameSort);
  elements.batchEditButton.addEventListener("click", itemActions.batchEditSelected);
  elements.batchDeleteButton.addEventListener("click", itemActions.batchDeleteSelected);
  elements.exportButton.addEventListener("click", () => void openWorkbench("export"));
  elements.importButton.addEventListener("click", () => void openWorkbench("import"));
  elements.profilesButton.addEventListener("click", () => void openWorkbench("profiles"));
  elements.searchInput.addEventListener("input", () => {
    const query = elements.searchInput.value.trim().toLowerCase();
    if (state.selectedOnly) {
      state.selectedSearchQuery = query;
    } else {
      state.searchQuery = query;
    }
    renderTable();
  });
  elements.autoRefreshToggle.addEventListener("change", async () => {
    state.autoRefreshPage = elements.autoRefreshToggle.checked;
    updateRefreshControlState();
    await savePreferences({ autoRefreshPage: state.autoRefreshPage });
  });
  elements.cookieEditor.addEventListener("submit", itemActions.saveSelectedItem);
  elements.valueInput.addEventListener("input", () => {
    rememberEditorDraft();
    updateValueWorkspaceHeight();
    updateSaveState();
    updateAutoToolOutput();
  });
  window.addEventListener("resize", updateValueWorkspaceHeight);
  const handleExpirationChange = () => {
    rememberEditorDraft();
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
  elements.copyButton.addEventListener("click", copyUsingSelectedMode);
  elements.copyMenuButton.addEventListener("click", () => setCopyMenuOpen(elements.copyMenu.hidden));
  elements.copyMenuButton.addEventListener("keydown", handleCopyMenuButtonKeydown);
  elements.copyMenu.addEventListener("keydown", handleCopyMenuKeydown);
  for (const button of elements.copyModeButtons) {
    button.addEventListener("click", () => selectCopyMode(button.dataset.copyMode));
  }
  elements.valueToolsButton.addEventListener("click", () => {
    setValueToolsMenuOpen(elements.valueToolsMenu.hidden);
  });
  elements.valueToolsButton.addEventListener("keydown", handleValueToolsButtonKeydown);
  elements.valueToolsMenu.addEventListener("keydown", handleValueToolsMenuKeydown);
  for (const button of elements.valueToolButtons) {
    button.addEventListener("click", () => selectValueTool(button.dataset.valueTool));
  }
  elements.valueViewToggleButton.addEventListener("click", () => {
    setActiveValueView(state.activeValueView === "result" ? "raw" : "result");
  });
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
    if (!elements.copyControl.contains(event.target)) {
      setCopyMenuOpen(false);
    }
    if (!elements.valueToolsControl.contains(event.target)) {
      setValueToolsMenuOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.copyMenu.hidden) {
        setCopyMenuOpen(false);
        elements.copyMenuButton.focus();
      } else if (!elements.valueToolsMenu.hidden) {
        setValueToolsMenuOpen(false);
        elements.valueToolsButton.focus();
      } else if (!elements.refreshMenu.hidden) {
        setRefreshMenuOpen(false);
        elements.refreshMenuButton.focus();
      }
    }
  });
  updateCopyControl();
  updateValueToolControl();
  initializeColumnResizers();
}

function copyUsingSelectedMode() {
  if (state.activeValueView === "result" && state.toolOutputText) {
    void copyToolOutput();
    return;
  }

  void itemActions.copySelected(selectedCopyMode, elements.copyButton);
}

function selectCopyMode(mode) {
  if (!Object.hasOwn(COPY_MODES, mode)) {
    return;
  }

  resetCopyFeedback(elements.copyButton);
  selectedCopyMode = mode;
  updateCopyControl();
  setCopyMenuOpen(false);
  copyUsingSelectedMode();
}

function updateCopyControl() {
  resetCopyFeedback(elements.copyButton);
  const showResult = state.activeValueView === "result" && Boolean(state.toolOutputText);
  const label = showResult ? "Copy result" : COPY_MODES[selectedCopyMode];
  elements.copyControl.classList.toggle("is-result", showResult);
  elements.copyMenuButton.hidden = showResult;
  if (showResult) {
    setCopyMenuOpen(false);
  }
  elements.copyButton.dataset.copyMode = showResult ? "result" : selectedCopyMode;
  elements.copyButton.dataset.tooltip = label;
  elements.copyButton.setAttribute("aria-label", label);
  for (const button of elements.copyModeButtons) {
    button.setAttribute("aria-checked", String(button.dataset.copyMode === selectedCopyMode));
  }
}

function setCopyMenuOpen(open, focusTarget = "selected") {
  const nextOpen = Boolean(open) && !elements.copyMenuButton.disabled;
  elements.copyMenu.hidden = !nextOpen;
  elements.copyMenuButton.setAttribute("aria-expanded", String(nextOpen));
  if (!nextOpen) {
    return;
  }

  const target = focusTarget === "last"
    ? elements.copyModeButtons.at(-1)
    : elements.copyModeButtons.find((button) => button.dataset.copyMode === selectedCopyMode);
  target?.focus();
}

function handleCopyMenuButtonKeydown(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }

  event.preventDefault();
  setCopyMenuOpen(true, event.key === "ArrowUp" ? "last" : "selected");
}

function handleCopyMenuKeydown(event) {
  const currentIndex = elements.copyModeButtons.indexOf(document.activeElement);
  const directions = {
    ArrowDown: 1,
    ArrowUp: -1
  };

  if (Object.hasOwn(directions, event.key)) {
    event.preventDefault();
    const nextIndex = (currentIndex + directions[event.key] + elements.copyModeButtons.length)
      % elements.copyModeButtons.length;
    elements.copyModeButtons[nextIndex].focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    elements.copyModeButtons[event.key === "Home" ? 0 : elements.copyModeButtons.length - 1].focus();
  } else if (event.key === "Tab") {
    setCopyMenuOpen(false);
  }
}

function selectValueTool(mode) {
  const nextMode = normalizeValueToolMode(mode);
  if (nextMode === "none") {
    return;
  }

  state.valueToolMode = nextMode;
  updateValueToolControl();
  setValueToolsMenuOpen(false);
  void savePreferences({ valueToolMode: state.valueToolMode }).catch(() => {
    // The selected tool still runs even if its preference cannot be saved.
  });
  runSelectedValueTool(nextMode);
}

function updateValueToolControl() {
  for (const button of elements.valueToolButtons) {
    button.setAttribute("aria-checked", String(button.dataset.valueTool === state.valueToolMode));
  }
}

function setValueToolsMenuOpen(open, focusTarget = "selected") {
  const nextOpen = Boolean(open) && !elements.valueToolsButton.disabled;
  elements.valueToolsMenu.hidden = !nextOpen;
  elements.valueToolsButton.setAttribute("aria-expanded", String(nextOpen));
  if (!nextOpen) {
    return;
  }

  const selectedButton = elements.valueToolButtons.find(
    (button) => button.dataset.valueTool === state.valueToolMode
  );
  const target = focusTarget === "last"
    ? elements.valueToolButtons.at(-1)
    : selectedButton || elements.valueToolButtons[0];
  target?.focus();
}

function handleValueToolsButtonKeydown(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }

  event.preventDefault();
  setValueToolsMenuOpen(true, event.key === "ArrowUp" ? "last" : "selected");
}

function handleValueToolsMenuKeydown(event) {
  const currentIndex = elements.valueToolButtons.indexOf(document.activeElement);
  const directions = {
    ArrowDown: 1,
    ArrowUp: -1
  };

  if (Object.hasOwn(directions, event.key)) {
    event.preventDefault();
    const nextIndex = (currentIndex + directions[event.key] + elements.valueToolButtons.length)
      % elements.valueToolButtons.length;
    elements.valueToolButtons[nextIndex].focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    elements.valueToolButtons[event.key === "Home" ? 0 : elements.valueToolButtons.length - 1].focus();
  } else if (event.key === "Tab") {
    setValueToolsMenuOpen(false);
  }
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

async function restoreLastViewedSiteData(url, requestId) {
  const siteOrigin = getSiteOrigin(url);
  if (state.siteOrigin === siteOrigin) {
    return;
  }

  let lastViewed = normalizeLastViewedSiteData(null);
  try {
    lastViewed = await getLastViewedSiteData(url);
  } catch {
    // A storage failure should not prevent the current site's data from loading.
  }

  if (requestId !== refreshRequestId) {
    return;
  }

  state.siteOrigin = siteOrigin;
  state.dataView = lastViewed.activeDataView;
  state.rememberedSelectedIds = { ...lastViewed.selectedIds };
  state.selectedId = state.rememberedSelectedIds[state.dataView] || "";
  state.selectedIds.clear();
  state.searchQuery = "";
  state.selectedOnly = false;
  state.selectedSearchQuery = "";
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
    selectedIds: { [state.dataView]: state.selectedId }
  };
  lastViewedSavePromise = lastViewedSavePromise
    .catch(() => {})
    .then(() => saveLastViewedSiteData(siteOrigin, value))
    .catch(() => {});
}

async function setDataView(view) {
  if (state.busy || !DATA_VIEWS[view] || state.dataView === view) {
    return;
  }

  rememberEditorDraft();
  state.dataView = view;
  state.rows = [];
  state.selectedId = state.rememberedSelectedIds[view] || "";
  state.selectedIds.clear();
  state.searchQuery = "";
  state.selectedOnly = false;
  state.selectedSearchQuery = "";
  elements.searchInput.value = "";
  clearToolOutput();
  clearHistoryDetail();
  setActiveDetailView("details");
  renderViewChrome();
  renderHistory();
  persistLastViewedSiteData();
  await refreshData();
}

async function refreshData({ preserveStatus = false } = {}) {
  window.clearTimeout(cookieRefreshTimer);
  rememberEditorDraft();
  const requestId = ++refreshRequestId;
  setLoading(true);
  if (!preserveStatus) clearStatus();
  setPermissionBanner(false);
  renderViewChrome();

  try {
    const tab = await getActiveTab();
    if (requestId !== refreshRequestId) {
      return;
    }
    state.tab = tab;
    globalThis.cookieControllerTheme?.setActiveTabIncognito(tab?.incognito);
    state.cookieStoreId = "";
    renderHeader(tab);

    const supportedPage = Boolean(tab?.url && isSupportedPageUrl(tab.url));
    const [, , cookieStoreId] = await Promise.all([
      restoreLastViewedSiteData(tab?.url, requestId),
      refreshSiteOptions(tab?.id, requestId),
      supportedPage ? resolveCookieStoreId(tab) : Promise.resolve("")
    ]);
    if (requestId !== refreshRequestId) {
      return;
    }
    const view = getCurrentView();

    if (!supportedPage) {
      state.rows = [];
      state.selectedId = "";
      state.emptyMessage = "This page is not supported";
      renderHeader(tab);
      renderTable();
      renderSelectedItem();
      showStatus(view.unsupportedMessage, "error");
      return;
    }

    state.cookieStoreId = cookieStoreId;
    const rows = await readSiteDataRows(tab, state.dataView, state.cookieStoreId);
    if (requestId !== refreshRequestId) {
      return;
    }
    state.rows = rows;
    state.emptyMessage = view.emptyMessage;

    if (state.selectedId && !state.rows.some((row) => row.id === state.selectedId)) {
      state.selectedId = "";
      rememberCurrentSelection();
    }
    pruneSelectedIds();

    renderTable();
    renderSelectedItem();
  } catch (error) {
    if (requestId !== refreshRequestId) {
      return;
    }
    state.rows = [];
    state.emptyMessage = getCurrentView().unavailableMessage;
    renderTable();
    renderSelectedItem();
    await handleReadError(error);
  } finally {
    if (requestId === refreshRequestId) {
      setLoading(false);
    }
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

async function refreshSiteOptions(activeTabId, requestId) {
  let tabs;
  try {
    tabs = await getWindowHttpTabs();
  } catch {
    tabs = [];
  }
  if (requestId !== refreshRequestId) {
    return;
  }
  state.tabs = tabs;

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
  elements.siteSelect.disabled = state.busy || state.loading || state.tabs.length <= 1;
}

function getSiteOptionLabel(tab) {
  const host = getDisplayHost(tab.url);
  const title = tab.title ? ` - ${tab.title}` : "";
  return `${host}${title}`;
}

async function switchToSelectedSite() {
  if (state.busy || state.loading) {
    return;
  }
  rememberEditorDraft();
  const tabId = Number(elements.siteSelect.value);
  if (!Number.isFinite(tabId)) {
    return;
  }

  try {
    await activateTab(tabId);
    state.siteOrigin = null;
    state.selectedId = "";
    state.selectedIds.clear();
    resetSelectedOnly();
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
  const target = createOperationContext(state.tab, state.cookieStoreId);
  const kind = state.dataView;

  setBusy(true);
  clearStatus();
  suppressCookieWatcher(Math.max(1500, pairs.length * 30));

  try {
    await assertOperationContext(target);
    const currentRows = await readSiteDataRows({ id: target.tabId, url: target.url }, kind, target.cookieStoreId);
    const previousRows = new Map(pairs.map((pair) => [pair.name, findLikelyImportedRow(pair.name, currentRows, target, kind)]));
    const job = await runOperation({
      target, label: `Import ${pairs.length} ${pairs.length === 1 ? "item" : "items"}`, source: "quick-import",
      items: pairs.map((pair) => {
        const after = kind === "cookies" ? {
          name: pair.name, value: pair.value, domain: new URL(target.url).hostname,
          path: "/", hostOnly: true, storeId: target.cookieStoreId,
          session: true, secure: false, httpOnly: false, sameSite: "unspecified"
        } : { type: DATA_VIEWS[kind].storageType, origin: target.origin, key: pair.name, value: pair.value };
        return { id: getSiteDataItemId(kind, after), kind, name: pair.name, before: previousRows.get(pair.name)?.raw || null, after };
      })
    });
    const result = operationToBatchResult(job);
    await historyController.loadRecentChanges();
    const lastSaved = result.success.at(-1)?.value;
    const lastImportedRow = lastSaved ? (kind === "cookies" ? toCookieRow(lastSaved) : toStorageRow(lastSaved)) : null;
    if (lastImportedRow) {
      state.selectedId = lastImportedRow.id;
      rememberCurrentSelection();
    }
    await refreshData();

    if (state.autoRefreshPage && result.success.length > 0) {
      await reloadOperationTarget(target);
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

function findLikelyImportedRow(name, rows, target, kind) {
  if (kind !== "cookies") {
    return rows.find((row) => row.name === name) || null;
  }

  const host = new URL(target.url).hostname;
  return rows.find((row) =>
    row.name === name &&
    row.path === "/" &&
    !row.partitioned && row.raw.hostOnly && row.raw.storeId === target.cookieStoreId &&
    row.domain === host
  ) || null;
}

function runSelectedValueTool(mode = state.valueToolMode) {
  const row = getSelectedRow();
  if (!row) {
    return;
  }

  const definition = VALUE_TOOL_DEFINITIONS[mode];
  if (!definition) {
    return;
  }

  try {
    const result = {
      title: definition.title,
      text: definition.run(elements.valueInput.value)
    };

    showToolOutput(result.title, result.text, true);
    showStatus(`${result.title} ready.`, "success");
  } catch (error) {
    clearToolOutput();
    showStatus(error?.message || "Unable to parse this value.", "error");
  }
}

function showToolOutput(title, text, activate = false) {
  state.toolOutputText = text;
  state.toolOutputTitle = title;
  elements.toolOutputBody.textContent = text;
  elements.toolOutput.setAttribute("aria-label", title);
  elements.valueViewToggleButton.disabled = false;
  elements.valueViewToggleIcon.hidden = false;
  setActiveValueView(activate ? "result" : "raw");
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
  state.toolOutputTitle = "";
  elements.toolOutputBody.textContent = "";
  elements.valueViewToggleButton.disabled = true;
  elements.valueViewToggleIcon.hidden = true;
  elements.valueViewToggleButton.removeAttribute("title");
  elements.valueViewToggleButton.setAttribute("aria-label", "Show result");
  setActiveValueView("raw");
}

function setActiveValueView(view) {
  const showResult = view === "result" && Boolean(state.toolOutputText);
  state.activeValueView = showResult ? "result" : "raw";
  elements.valueViewSwitch.hidden = !state.toolOutputText;
  elements.valueInput.hidden = showResult;
  elements.toolOutput.hidden = !showResult;
  elements.valueWorkspace.classList.toggle("is-result", showResult);
  updateCopyControl();
  if (!showResult) {
    updateValueWorkspaceHeight();
  }
  elements.valueViewLabel.textContent = showResult ? state.toolOutputTitle : "Raw";
  if (state.toolOutputText) {
    const nextViewLabel = showResult ? "raw value" : state.toolOutputTitle;
    elements.valueViewToggleButton.title = `Show ${nextViewLabel}`;
    elements.valueViewToggleButton.setAttribute("aria-label", `Show ${nextViewLabel}`);
  }
}

function updateValueWorkspaceHeight() {
  if (elements.valueInput.hidden) {
    return;
  }

  const editorScrollTop = elements.cookieEditor.scrollTop;
  elements.valueWorkspace.style.height = `${VALUE_WORKSPACE_DEFAULT_HEIGHT}px`;
  const requiredHeight = elements.valueInput.scrollHeight + VALUE_WORKSPACE_FOOTER_HEIGHT;
  const nextHeight = Math.min(
    VALUE_WORKSPACE_MAX_HEIGHT,
    Math.max(VALUE_WORKSPACE_DEFAULT_HEIGHT, requiredHeight)
  );
  elements.valueWorkspace.style.height = `${nextHeight}px`;
  elements.cookieEditor.scrollTop = editorScrollTop;
}

async function copyToolOutput() {
  if (!state.toolOutputText) {
    return;
  }

  try {
    await writeClipboard(state.toolOutputText);
    clearStatus();
    showCopyFeedback(elements.copyButton);
  } catch (error) {
    resetCopyFeedback(elements.copyButton);
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
    ? state.selectedOnly ? "Search selected cookies" : "Search name, value, domain, path"
    : state.selectedOnly ? "Search selected items" : "Search key, value, origin";
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
    if (index === 0) {
      elements.nameSortLabel.textContent = view.tableLabels[index];
    } else {
      header.childNodes.forEach((node) => {
        if (node !== handle) {
          node.remove();
        }
      });
      header.insertBefore(document.createTextNode(view.tableLabels[index]), handle || null);
    }
    if (handle) {
      handle.title = `Resize ${view.tableLabels[index]} column`;
      handle.setAttribute("aria-label", `Resize ${view.tableLabels[index]} column`);
    }
  });
  updateNameSortControl();

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

function renderHeader(tab) {
  const view = getCurrentView();
  elements.hostLabel.textContent = getDisplayHost(tab?.url);
  elements.cookieCount.textContent = `${state.rows.length} ${state.rows.length === 1 ? view.singular : view.plural}`;
  renderSiteIcon(tab);
}

function renderSiteIcon(tab) {
  const faviconUrl = typeof tab?.favIconUrl === "string" ? tab.favIconUrl.trim() : "";
  if (elements.siteIcon.dataset.source === faviconUrl) {
    return;
  }

  elements.siteIcon.dataset.source = faviconUrl;
  elements.siteIcon.hidden = true;
  if (!faviconUrl) {
    elements.siteIcon.removeAttribute("src");
    return;
  }

  elements.siteIcon.src = faviconUrl;
}

function renderTable() {
  if (state.selectedOnly && state.selectedIds.size === 0) {
    resetSelectedOnly();
  }
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
  renderHeader(state.tab);
  updateActionAvailability();
  updateSelectionSummary(visibleRows);
}

function getVisibleRows() {
  let rows = state.rows;
  if (state.selectedOnly) {
    rows = rows.filter((row) => state.selectedIds.has(row.id));
  }

  const query = state.selectedOnly ? state.selectedSearchQuery : state.searchQuery;
  if (query) {
    const getSearchText = isCookieView() ? getCookieSearchText : getStorageSearchText;
    rows = rows.filter((row) => getSearchText(row).includes(query));
  }

  const sortDirection = state.nameSortDirections[state.dataView];
  if (sortDirection !== "none") {
    rows = sortRowsByName(rows, sortDirection);
  }

  return sortFavoriteRowsFirst(rows, state.favoriteItemIds, state.dataView);
}

function toggleNameSort() {
  const currentDirection = state.nameSortDirections[state.dataView];
  state.nameSortDirections[state.dataView] = currentDirection === "ascending"
    ? "descending"
    : "ascending";
  updateNameSortControl();
  renderTable();
}

function updateNameSortControl() {
  const label = getCurrentView().tableLabels[0];
  const direction = state.nameSortDirections[state.dataView];
  const nextDirection = direction === "ascending" ? "descending" : "ascending";
  const actionLabel = `Sort ${label} ${nextDirection}`;
  elements.nameSortHeader.setAttribute("aria-sort", direction);
  elements.nameSortLabel.textContent = label;
  elements.nameSortButton.title = actionLabel;
  elements.nameSortButton.setAttribute("aria-label", actionLabel);
}

function isFavorite(itemId) {
  return state.favoriteItemIds.has(makeFavoriteItemId(state.dataView, itemId));
}

async function toggleFavorite(itemId, favorite) {
  const favoriteItemId = makeFavoriteItemId(state.dataView, itemId);
  if (pendingFavoriteIds.has(favoriteItemId)) return;
  pendingFavoriteIds.add(favoriteItemId);
  const previousFavorites = new Set(state.favoriteItemIds);

  if (favorite) {
    state.favoriteItemIds.add(favoriteItemId);
  } else {
    state.favoriteItemIds.delete(favoriteItemId);
  }
  renderTable();
  updateEditorFavoriteButton();

  try {
    state.favoriteItemIds = new Set(await setFavoriteSiteDataId(favoriteItemId, favorite));
    renderTable();
    updateEditorFavoriteButton();
  } catch {
    state.favoriteItemIds = previousFavorites;
    renderTable();
    updateEditorFavoriteButton();
    showStatus("Failed to update favorites.", "error");
  } finally {
    pendingFavoriteIds.delete(favoriteItemId);
    updateEditorFavoriteButton();
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
  if (state.busy || state.loading) {
    return;
  }
  rememberEditorDraft();
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
  if (state.busy || state.loading) {
    renderTable();
    return;
  }
  if (selected) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  if (state.selectedOnly || !rowElement?.isConnected || rowElement.dataset.itemId !== id) {
    renderTable();
    return;
  }

  rowElement.classList.toggle("is-checked", selected);
  updateSelectionSummary();
}

function toggleSelectedOnly() {
  if (state.selectedIds.size === 0) {
    return;
  }

  state.selectedOnly = !state.selectedOnly;
  state.selectedSearchQuery = "";
  elements.searchInput.value = state.selectedOnly ? "" : state.searchQuery;
  renderViewChrome();
  renderTable();
}

function resetSelectedOnly() {
  if (!state.selectedOnly && !state.selectedSearchQuery) {
    return;
  }
  state.selectedOnly = false;
  state.selectedSearchQuery = "";
  elements.searchInput.value = state.searchQuery;
  renderViewChrome();
}

function toggleSelectAllVisible() {
  if (state.busy || state.loading) {
    return;
  }
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
  const hiddenSelectedCount = Math.max(0, selectedCount - visibleSelectedCount);
  elements.selectionCountLabel.textContent = `${selectedCount} selected${hiddenSelectedCount ? ` · ${hiddenSelectedCount} hidden` : ""}`;
  elements.selectionCount.disabled = selectedCount === 0;
  elements.selectionCount.setAttribute("aria-pressed", String(state.selectedOnly));
  elements.selectionCount.title = state.selectedOnly ? "Show all items" : "Show selected items";
  elements.batchActions.hidden = selectedCount === 0;
  elements.batchEditButton.disabled = state.busy || state.loading || selectedCount === 0;
  elements.batchDeleteButton.disabled = state.busy || state.loading || selectedCount === 0;
  elements.selectAllCheckbox.disabled = state.busy || state.loading;
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

function rememberEditorDraft() {
  if (!renderedEditor) {
    return;
  }
  const { key, row, kind } = renderedEditor;
  const cookie = kind === "cookies";
  const originalExpiration = cookie && !row.session && Number.isFinite(row.raw.expirationDate)
    ? formatDateTimeLocal(row.raw.expirationDate)
    : "";
  editorDrafts.capture(key, row, elements.valueInput.value,
    cookie ? elements.expirationInput.value : "", originalExpiration);
}

function discardEditorDraft(row, target, { keepEditor = false } = {}) {
  const kind = row.type === "session" ? "sessionStorage" : row.type === "local" ? "localStorage" : "cookies";
  const key = getEditorDraftKey(target, kind, row.id);
  editorDrafts.remove(key);
  if (!keepEditor && renderedEditor?.key === key) {
    renderedEditor = null;
  }
}

async function prepareRowForSave(row, target) {
  const kind = row.type === "session" ? "sessionStorage" : row.type === "local" ? "localStorage" : "cookies";
  const readCurrentRow = async () => {
    const rows = await readSiteDataRows({ id: target.tabId, url: target.url }, kind, target.cookieStoreId);
    const current = rows.find((item) => item.id === row.id);
    if (!current) {
      throw new Error("This item was removed from the page. Your draft was kept.");
    }
    return current;
  };
  const current = await readCurrentRow();
  const key = getEditorDraftKey(target, kind, row.id);
  if (editorDrafts.hasConflict(key, current) || getEditorRowSignature(row) !== getEditorRowSignature(current)) {
    const confirmed = await requestDeleteConfirmation({
      title: "Overwrite changed item?",
      message: `"${row.name}" changed on the page after editing started.`,
      detail: kind === "cookies"
        ? "The current value and expiration will be replaced by your draft."
        : "The current page value will be replaced by your draft.",
      confirmLabel: "Overwrite"
    });
    if (!confirmed) {
      return null;
    }
    await assertOperationContext(target);
    const latest = await readCurrentRow();
    if (getEditorRowSignature(latest) !== getEditorRowSignature(current)) {
      throw new Error("This item changed again. Refresh and review it before saving. Your draft was kept.");
    }
  }
  return current;
}

function renderSelectedItem() {
  rememberEditorDraft();
  const row = getSelectedRow();
  const hasSelection = Boolean(row);

  clearToolOutput();
  elements.detailPlaceholder.hidden = hasSelection;
  elements.cookieEditor.hidden = !hasSelection;
  updateEditorFavoriteButton();

  if (!row) {
    renderedEditor = null;
    renderHistory();
    updateSelectionControls();
    return;
  }

  elements.editorName.textContent = row.name;
  elements.editorName.title = row.name;
  elements.editorLocation.textContent = getRowLocation(row);
  elements.editorLocation.title = getRowLocation(row);
  const target = createOperationContext(state.tab, state.cookieStoreId);
  const key = getEditorDraftKey(target, state.dataView, row.id);
  const draft = editorDrafts.get(key);
  renderedEditor = { key, row, target, kind: state.dataView };
  elements.valueInput.value = draft?.value ?? row.value;
  populateExpirationEditor(row);
  if (draft && isCookieView()) {
    elements.expirationInput.value = draft.expiration;
    updateExpirationValidity();
  }
  if (editorDrafts.hasConflict(key, row)) {
    showStatus("This item changed on the page. Your draft was kept.", "warning");
  }
  updateAutoToolOutput();
  updateValueWorkspaceHeight();
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
  const pending = row && pendingFavoriteIds.has(makeFavoriteItemId(state.dataView, row.id));
  elements.editorFavoriteButton.disabled = state.busy || state.loading || !row || pending;
  elements.editorFavoriteButton.setAttribute("aria-busy", String(Boolean(pending)));
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
  elements.saveButton.disabled = state.busy || state.loading || !hasChanges;
  elements.resetButton.disabled = state.busy || state.loading || !hasChanges;
  updateToolState();
}

function updateToolState() {
  const hasSelection = Boolean(getSelectedRow());
  const hasOutput = Boolean(state.toolOutputText);
  elements.valueToolsButton.disabled = state.busy || state.loading || !hasSelection;
  elements.valueViewToggleButton.disabled = state.busy || state.loading || !hasSelection || !hasOutput;
  if (!hasSelection) {
    setValueToolsMenuOpen(false);
  }
}

function updateSelectionControls() {
  const hasSelection = Boolean(getSelectedRow());
  const blocked = state.busy || state.loading;
  elements.deleteButton.disabled = blocked || !hasSelection;
  elements.copyButton.disabled = blocked || !hasSelection;
  elements.copyMenuButton.disabled = blocked || !hasSelection;
  if (!hasSelection) {
    setCopyMenuOpen(false);
  }
  elements.clearHistoryButton.disabled = blocked || getVisibleRecentChanges().length === 0;
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
      state.busy ||
      state.loading ||
      Date.now() < state.ignoreCookieChangesUntil ||
      !state.tab?.url ||
      (state.cookieStoreId && changeInfo.cookie?.storeId !== state.cookieStoreId) ||
      !isWatchedCookie(changeInfo.cookie)
    ) {
      return;
    }

    window.clearTimeout(cookieRefreshTimer);
    cookieRefreshTimer = window.setTimeout(() => {
      if (state.busy) {
        return;
      }
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
  elements.refreshButton.disabled = state.busy || isLoading;
  elements.siteSelect.disabled = state.busy || isLoading || state.tabs.length <= 1;
  elements.dataViewButtons.forEach((button) => { button.disabled = state.busy || isLoading; });
  elements.valueInput.disabled = state.busy || isLoading;
  elements.expirationInput.disabled = state.busy || isLoading;
  updateActionAvailability();
  updateEditorFavoriteButton();
  updateSelectionControls();
  renderHistory();
  renderTable();
}

function updateActionAvailability() {
  const supportedPage = Boolean(state.tab?.url && isSupportedPageUrl(state.tab.url));
  elements.exportButton.disabled = state.busy || state.loading || !supportedPage;
  elements.importButton.disabled = state.busy || state.loading || !supportedPage;
  elements.profilesButton.disabled = state.busy || state.loading || !supportedPage;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  elements.refreshButton.disabled = isBusy || state.loading;
  elements.siteSelect.disabled = isBusy || state.loading || state.tabs.length <= 1;
  elements.valueInput.disabled = isBusy || state.loading;
  elements.expirationInput.disabled = isBusy || state.loading;
  renderHistory();
  if (isBusy) {
    elements.dataViewButtons.forEach((button) => {
      button.disabled = true;
    });
    elements.saveButton.disabled = true;
    elements.deleteButton.disabled = true;
    elements.resetButton.disabled = true;
    elements.copyButton.disabled = true;
    elements.copyMenuButton.disabled = true;
    setCopyMenuOpen(false);
    elements.valueToolsButton.disabled = true;
    setValueToolsMenuOpen(false);
    elements.valueViewToggleButton.disabled = true;
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
    button.disabled = state.loading;
  });
  const hasSelection = Boolean(getSelectedRow());
  elements.deleteButton.disabled = !hasSelection;
  updateEditorFavoriteButton();
  updateActionAvailability();
  updateSelectionControls();
  updateSelectionSummary();
}

function setPermissionBanner(visible, message = "Site permission is required for this page.") {
  elements.permissionBanner.hidden = !visible;
  elements.permissionMessage.textContent = message;
}
