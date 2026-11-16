import { t } from "../shared/i18n.js";
import { runOperation } from "../shared/operation-client.js";
import { assertOperationSucceeded, operationItemFromRow, operationToBatchResult } from "../shared/operation-presentation.js";
import { getBatchOperationCounts } from "../shared/operation-result.js";
import { assertOperationContext, createOperationContext, reloadOperationTarget } from "../shared/operation-context.js";

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
  updateValueWorkspaceHeight,
  updateSaveState,
  updateAutoToolOutput,
  prepareRowForSave,
  discardEditorDraft,
  rememberCurrentSelection,
  refreshData,
  loadRecentChanges,
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
    if (state.busy || state.loading || !row || !state.tab?.url) {
      return;
    }

    const target = createOperationContext(state.tab, state.cookieStoreId);
    const cookieView = isCookieView();
    const nextValue = elements.valueInput.value;
    const expiration = cookieView ? getExpirationDraft() : null;
    if (!hasSelectedItemChanges(row)) {
      return;
    }

    if (cookieView && !expiration) {
      elements.expirationInput.reportValidity();
      return;
    }

    setBusy(true);
    clearStatus();
    suppressCookieWatcher();

    try {
      await assertOperationContext(target);
      const currentRow = await prepareRowForSave(row, target);
      if (!currentRow) {
        return;
      }
      await assertOperationContext(target);
      assertRowTarget(currentRow, target);
      assertOperationSucceeded(await runOperation({
        target, label: t`Edit ${row.name}`, source: "edit",
        items: [operationItemFromRow(currentRow, {
          ...currentRow.raw, value: nextValue, ...(cookieView ? expiration : {})
        })]
      }));
      await loadRecentChanges();
      discardEditorDraft(row, target);
      state.selectedId = row.id;
      await refreshData();

      if (state.autoRefreshPage) {
        await reloadOperationTarget(target);
      }

      showStatus(t`Saved ${row.name}.`, "success");
    } catch (error) {
      showStatus(error?.message || t`Failed to save ${getCurrentView().singular}.`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedItem() {
    const row = getSelectedRow();
    if (state.busy || state.loading || !row || !state.tab?.url) {
      return;
    }

    const target = createOperationContext(state.tab, state.cookieStoreId);
    const confirmed = await requestDeleteConfirmation({
      title: t`Delete ${getCurrentView().singular}?`,
      message: t`"${row.name}" will be deleted.`,
      detail: getRowLocation(row)
    });
    if (!confirmed) {
      return;
    }

    setBusy(true);
    clearStatus();
    suppressCookieWatcher();

    try {
      await assertOperationContext(target);
      assertRowTarget(row, target);
      assertOperationSucceeded(await runOperation({
        target, label: t`Delete ${row.name}`, source: "delete",
        items: [operationItemFromRow(row, null)]
      }));
      await loadRecentChanges();
      discardEditorDraft(row, target);
      state.selectedId = "";
      rememberCurrentSelection();
      await refreshData();

      if (state.autoRefreshPage) {
        await reloadOperationTarget(target);
      }

      showStatus(t`Deleted ${row.name}.`, "success");
    } catch (error) {
      showStatus(error?.message || t`Failed to delete ${getCurrentView().singular}.`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function batchEditSelected() {
    const selectedRows = getSelectedRows();
    if (state.busy || state.loading || selectedRows.length === 0 || !state.tab?.url) {
      return;
    }

    const target = createOperationContext(state.tab, state.cookieStoreId);
    const nextValue = await requestTextInput({
      title: t("Set value"),
      fieldLabel: t`Value for ${selectedRows.length} selected ${getCurrentView().plural}`,
      submitLabel: t("Set value"),
      selection: getSelectionReview(selectedRows)
    });
    if (nextValue === null) {
      return;
    }

    setBusy(true);
    clearStatus();
    suppressCookieWatcher();

    try {
      const job = await runOperation({
        target, label: t`Edit ${selectedRows.length} items`, source: "batch-edit",
        items: selectedRows.map((row) => operationItemFromRow(row, { ...row.raw, value: nextValue }))
      });
      const result = operationToBatchResult(job);
      for (const item of result.success) {
        const row = selectedRows.find((candidate) => candidate.id === item.itemId);
        discardEditorDraft(row, target);
      }
      await loadRecentChanges();
      await refreshData();
      if (state.autoRefreshPage && result.success.length > 0) await reloadOperationTarget(target);
      showBatchOperationStatus(t("Updated"), result);
    } catch (error) {
      showStatus(error?.message || t`Failed to update selected ${getCurrentView().plural}.`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function batchDeleteSelected() {
    const selectedRows = getSelectedRows();
    if (state.busy || state.loading || selectedRows.length === 0 || !state.tab?.url) {
      return;
    }

    const target = createOperationContext(state.tab, state.cookieStoreId);
    const confirmed = await requestDeleteConfirmation({
      title: t`Delete selected ${getCurrentView().plural}?`,
      message: t`${selectedRows.length} selected ${getCurrentView().plural} will be deleted.`,
      confirmLabel: t`Delete ${selectedRows.length}`,
      selection: getSelectionReview(selectedRows)
    });
    if (!confirmed) {
      return;
    }

    setBusy(true);
    clearStatus();
    suppressCookieWatcher();

    try {
      const job = await runOperation({
        target, label: t`Delete ${selectedRows.length} items`, source: "batch-delete",
        items: selectedRows.map((row) => operationItemFromRow(row, null))
      });
      const result = operationToBatchResult(job);
      for (const entry of result.success) {
        discardEditorDraft(selectedRows.find((row) => row.id === entry.itemId), target);
      }
      await loadRecentChanges();
      state.selectedId = "";
      rememberCurrentSelection();
      state.selectedIds = new Set(result.failed.map((entry) => entry.itemId));
      await refreshData();
      if (state.autoRefreshPage && result.success.length > 0) await reloadOperationTarget(target);
      showBatchOperationStatus(t("Deleted"), result);
    } catch (error) {
      showStatus(error?.message || t`Failed to delete selected ${getCurrentView().plural}.`, "error");
    } finally {
      setBusy(false);
    }
  }

  function showBatchOperationStatus(action, result) {
    const counts = getBatchOperationCounts(result);
    if (counts.failed === 0 && counts.skipped === 0) {
      showStatus(t`${action} ${counts.success} selected ${getCurrentView().plural}.`, "success");
      return;
    }

    const summary = [
      `${action} ${counts.success}`,
      counts.failed ? t`${counts.failed} failed` : "",
      counts.skipped ? t`${counts.skipped} skipped` : ""
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
    if (state.busy || state.loading || !row) {
      return;
    }

    elements.valueInput.value = row.value;
    discardEditorDraft(row, createOperationContext(state.tab, state.cookieStoreId), { keepEditor: true });
    populateExpirationEditor(row);
    updateValueWorkspaceHeight();
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
      showStatus(error?.message || t("Failed to copy."), "error");
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

function assertRowTarget(row, target) {
  if (row.type) {
    if (row.raw.origin !== target.origin) {
      throw new Error(t("The item's origin does not match the target page. Refresh before editing."));
    }
    return;
  }
  const host = new URL(target.url).hostname;
  const domain = row.raw.domain.replace(/^\./, "");
  const matchesDomain = host === domain || (!row.raw.hostOnly && host.endsWith(`.${domain}`));
  if (!target.cookieStoreId || row.raw.storeId !== target.cookieStoreId || !matchesDomain) {
    throw new Error(t("The cookie does not belong to the target page and cookie store. Refresh before editing."));
  }
}
