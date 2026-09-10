import { clearHistoryKind, getDismissedChangeIds, getRecentChangeSnapshots, getRecentCookieChanges } from "../shared/history-store.js";
import { normalizeRecentChanges } from "../shared/recent-changes.js";
import { compareRecentChangeOrder, projectOperationHistory } from "../shared/operation-history.js";
import { listOperations, undoOperation } from "../shared/operation-client.js";
import { createOperationContext, getUndoUnavailableReason, reloadOperationTarget } from "../shared/operation-context.js";

export function createPopupHistoryController({
  state, getCurrentView, getHistoryItemKind, rememberCurrentSelection,
  clearHistoryDetail, renderHistory, refreshData, suppressCookieWatcher,
  setBusy, showStatus, clearStatus
}) {
  let loadSequence = 0;

  async function loadRecentChanges() {
    const sequence = ++loadSequence;
    try {
      const [jobs, saved, legacySnapshots, dismissedIds] = await Promise.all([
        listOperations(), getRecentCookieChanges(), getRecentChangeSnapshots(), getDismissedChangeIds()
      ]);
      if (sequence !== loadSequence) return;
      const dismissed = new Set(dismissedIds);
      const projected = projectOperationHistory(jobs);
      const merged = new Map(normalizeRecentChanges(saved).map((change) => [change.id, change]));
      for (const change of projected.changes) merged.set(change.id, change);
      const previousIds = new Set(state.recentChanges.map((change) => change.id));
      state.recentChanges = normalizeRecentChanges([...merged.values()]
        .filter((change) => !dismissed.has(change.id)).sort(compareRecentChangeOrder));
      for (const change of state.recentChanges) {
        if (!previousIds.has(change.id)) state.unreadHistoryIds.add(change.id);
      }
      state.undoSnapshots = new Map(Object.entries({
        ...Object.fromEntries(Object.entries(legacySnapshots).map(([id, snapshot]) => [id, { ...snapshot, legacyUnverified: true }])),
        ...projected.snapshots
      }).filter(([id]) => !dismissed.has(id)));
      state.operationJobs = jobs;
      renderHistory();
    } catch (error) {
      showStatus(error?.message || "Operation history could not be loaded.", "error");
    }
  }

  async function undoRecentChange(changeId) {
    if (state.busy || state.loading) return;
    const snapshot = state.undoSnapshots.get(changeId);
    const reason = getUndoUnavailableReason(snapshot, state.tab, state.cookieStoreId);
    if (reason) return showStatus(reason, "error");
    if (!snapshot.operationId) return showStatus("This older change has no operation journal and cannot be safely undone.", "error");
    const target = createOperationContext(state.tab, snapshot.target.cookieStoreId);
    setBusy(true);
    clearStatus();
    suppressCookieWatcher();
    try {
      const job = await undoOperation(snapshot.operationId, { target, itemIds: [snapshot.operationItemId] });
      const item = job.items.find((entry) => entry.id === snapshot.operationItemId);
      await loadRecentChanges();
      if (item?.state !== "undone") throw new Error(item?.error || "The change could not be undone.");
      state.unreadHistoryIds.delete(changeId);
      if (state.selectedHistoryId === changeId) clearHistoryDetail();
      rememberCurrentSelection();
      renderHistory();
      await refreshData();
      if (state.autoRefreshPage) await reloadOperationTarget(target);
      showStatus("Undid the selected change.", "success");
    } catch (error) {
      showStatus(error?.message || "Failed to undo change.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (state.busy || state.loading) return;
    try {
      const itemKind = getHistoryItemKind();
      const changes = projectOperationHistory(state.operationJobs || []).changes;
      await clearHistoryKind(itemKind, changes.filter((change) => change.itemKind === itemKind).map((change) => change.id));
      clearHistoryDetail();
      await loadRecentChanges();
      showStatus(`${getCurrentView().title} history cleared.`, "success");
    } catch (error) {
      showStatus(error?.message || "Failed to clear recent changes.", "error");
    }
  }

  return { clearHistory, loadRecentChanges, undoRecentChange };
}
