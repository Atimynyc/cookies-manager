import {
  reloadTab,
  removeCookie,
  setCookieValue
} from "../shared/cookie-api.js";
import {
  removeStorageItem,
  setStorageValue
} from "../shared/storage-api.js";
import { executeBatchOperation } from "../shared/batch-operations.js";
import { getBatchOperationCounts } from "../shared/operation-result.js";

export function createPopupItemActionsController({
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
  recordRecentChange,
  suppressCookieWatcher,
  requestDeleteConfirmation,
  requestTextInput,
  setBusy,
  showStatus,
  clearStatus,
  writeClipboard,
  showCopyFeedback,
  resetCopyFeedback
}) {
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
      await recordRecentChange(row, nextValue, { savedCookie });
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
      submitLabel: "Set value",
      selection: getSelectionReview(selectedRows)
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
        await recordRecentChange(row, nextValue);
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
      message: `${selectedRows.length} selected ${getCurrentView().plural} will be permanently deleted.`,
      confirmLabel: `Delete ${selectedRows.length}`,
      selection: getSelectionReview(selectedRows)
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

  function getSelectionReview(rows) {
    return {
      label: getCurrentView().plural,
      rows: rows.map((row) => ({
        name: row.name,
        location: getRowLocation(row)
      }))
    };
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

  return {
    batchDeleteSelected,
    batchEditSelected,
    copySelected,
    deleteSelectedItem,
    resetSelectedItem,
    saveSelectedItem
  };
}
