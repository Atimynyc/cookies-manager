import {
  removeCookie,
  setCookieValue
} from "../shared/cookie-api.js";
import {
  removeStorageItem,
  setStorageValue
} from "../shared/storage-api.js";
import {
  clearRecentChangeSnapshots,
  clearRecentCookieChanges,
  getRecentChangeSnapshots,
  getRecentCookieChanges,
  saveRecentChangeSnapshots,
  saveRecentCookieChanges
} from "../shared/history-store.js";
import {
  createRecentChange,
  normalizeRecentChanges
} from "../shared/recent-changes.js";
import { toCookieRow } from "../shared/cookie-format.js";
import { toStorageRow } from "../shared/storage-format.js";
import { getDisplayHost } from "../shared/url.js";
import {
  assertOperationContext,
  createOperationContext,
  getUndoUnavailableReason,
  reloadOperationTarget
} from "../shared/operation-context.js";

export function createPopupHistoryController({
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
}) {
  let undoInProgress = false;

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

  async function recordRecentChange(row, nextValue, { savedCookie = null, target = null } = {}) {
    try {
      const itemKind = row.kind || (row.type === "session" ? "sessionStorage" : row.type === "local" ? "localStorage" : "cookie");
      const afterCookie = savedCookie || row.raw;
      const recordOptions = { itemKind, target };
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
        getDisplayHost(target?.url || row.origin),
        Date.now(),
        recordOptions
      );
      const snapshot = {
        itemKind,
        target: target ? Object.freeze({ ...target }) : null,
        raw: structuredClone(row.raw),
        storageType: row.type || "",
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

  async function recordImportChange(row, nextValue, previousRow, { target = null } = {}) {
    try {
      const itemKind = row.kind || (row.type === "session" ? "sessionStorage" : row.type === "local" ? "localStorage" : "cookie");
      const record = createRecentChange(row, nextValue, getDisplayHost(target?.url || row.origin), Date.now(), {
        action: previousRow ? "import-overwrite" : "import-create",
        itemKind,
        beforeSize: previousRow?.size || 0,
        target
      });

      state.undoSnapshots.set(record.id, previousRow
        ? {
            itemKind,
            target: target ? Object.freeze({ ...target }) : null,
            raw: structuredClone(previousRow.raw),
            storageType: previousRow.type || "",
            key: previousRow.name,
            value: previousRow.value,
            beforeValue: previousRow.value,
            afterValue: nextValue
          }
        : {
            itemKind,
            target: target ? Object.freeze({ ...target }) : null,
            raw: structuredClone(row.raw),
            storageType: row.type || "",
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

  async function undoRecentChange(changeId) {
    if (undoInProgress || state.busy || state.loading) {
      return;
    }
    const snapshot = state.undoSnapshots.get(changeId);
    const unavailableReason = getUndoUnavailableReason(snapshot, state.tab, state.cookieStoreId);
    if (unavailableReason) {
      showStatus(unavailableReason, "error");
      return;
    }

    undoInProgress = true;
    setBusy(true);
    clearStatus();
    suppressCookieWatcher();

    try {
      const target = createOperationContext(state.tab, snapshot.target.cookieStoreId);
      await assertOperationContext(target);
      if (snapshot.deleteOnUndo) {
        if (snapshot.itemKind === "cookie") {
          const removed = await removeCookie(snapshot.target.url, snapshot.raw);
          if (!removed) {
            throw new Error("The cookie was not removed. Refresh and try again.");
          }
        } else {
          await removeStorageItem(target.tabId, target.url, snapshot.storageType, snapshot.key);
        }
        state.selectedId = "";
        rememberCurrentSelection();
      } else if (snapshot.itemKind === "cookie") {
        const restored = await setCookieValue(snapshot.target.url, snapshot.raw, snapshot.value);
        state.selectedId = toCookieRow(restored).id;
        rememberCurrentSelection();
      } else {
        const restored = await setStorageValue(target.tabId, target.url, snapshot.storageType, snapshot.key, snapshot.value);
        state.selectedId = toStorageRow(restored).id;
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
        await reloadOperationTarget(target);
      }

      showStatus("Undid the selected change.", "success");
    } catch (error) {
      showStatus(error?.message || "Failed to undo change.", "error");
    } finally {
      undoInProgress = false;
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (state.busy || state.loading) {
      return;
    }
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

  return {
    clearHistory,
    loadRecentChanges,
    recordImportChange,
    recordRecentChange,
    undoRecentChange
  };
}
