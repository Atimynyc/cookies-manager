import {
  reloadTab,
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

  async function recordRecentChange(row, nextValue, { savedCookie = null } = {}) {
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

  async function recordImportChange(row, nextValue, previousRow) {
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
      } else if (snapshot.itemKind === "cookie") {
        const restored = await setCookieValue(state.tab.url, snapshot.raw, snapshot.value);
        state.selectedId = toCookieRow(restored).id;
        rememberCurrentSelection();
      } else {
        const restored = await setStorageValue(state.tab.id, state.tab.url, snapshot.storageType, snapshot.key, snapshot.value);
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

  return {
    clearHistory,
    loadRecentChanges,
    recordImportChange,
    recordRecentChange,
    undoRecentChange
  };
}
