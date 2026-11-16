import { t } from "../shared/i18n.js";
import { formatBytes } from "../shared/recent-changes.js";
import { getStorageTypeLabel } from "../shared/storage-format.js";
import { getUndoUnavailableReason } from "../shared/operation-context.js";

export function createHistoryView({
  state,
  elements,
  getHistoryItemKind,
  onSelectHistoryView,
  onUndo
}) {
  function renderHistory() {
    if (!elements.historyList) {
      return;
    }

    const visibleChanges = getVisibleRecentChanges();
    updateHistoryBadge(syncUnreadHistory(visibleChanges));
    elements.historyList.replaceChildren(...visibleChanges.map(createHistoryItem));
    elements.historyList.hidden = visibleChanges.length === 0;
    elements.historyEmpty.hidden = visibleChanges.length > 0;
    if (state.historyMode === "operations") {
      elements.historyList.hidden = true;
      elements.historyEmpty.hidden = true;
      elements.historyDetail.hidden = true;
    }
    elements.clearHistoryButton.disabled = Boolean(state.busy || state.loading || visibleChanges.length === 0);

    if (state.selectedHistoryId && !visibleChanges.some((change) => change.id === state.selectedHistoryId)) {
      clearHistoryDetail();
    }
  }

  function getVisibleRecentChanges() {
    const itemKind = getHistoryItemKind();
    return state.recentChanges.filter((change) => change.itemKind === itemKind);
  }

  function updateHistoryButtonState(unreadCount = null) {
    const isHistoryView = state.activeDetailView === "history";
    const visibleBadgeCount = elements.historyCountBadge.hidden ? 0 : elements.historyCountBadge.textContent;
    const count = unreadCount === null ? visibleBadgeCount : unreadCount;
    const label = isHistoryView
      ? t("Back to details")
      : count
        ? t`${count} unread changes`
        : t("Recent changes");
    elements.historyViewButton.title = label;
    elements.historyViewButton.setAttribute("aria-label", label);
  }

  function clearHistoryDetail() {
    const expandedItem = elements.historyDetail.closest("li");
    if (expandedItem) {
      expandedItem.classList.remove("is-expanded");
      expandedItem.querySelector(".history-detail-button")?.setAttribute("aria-expanded", "false");
    }

    state.selectedHistoryId = "";
    elements.historyDetail.hidden = true;
    elements.historyDetailTitle.textContent = t("Change detail");
    elements.historyDetailGrid.replaceChildren();
    elements.historyBeforeValue.replaceChildren();
    elements.historyAfterValue.replaceChildren();
    elements.historyValueDetail.hidden = true;
    elements.historyDetailNote.hidden = true;
    elements.historyDetailNote.textContent = "";
    elements.historyPanel.append(elements.historyDetail);
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
    updateHistoryButtonState(count);
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
    detailButton.textContent = t("Details");
    detailButton.setAttribute("aria-controls", "historyDetail");
    detailButton.setAttribute("aria-expanded", String(state.selectedHistoryId === change.id));
    detailButton.addEventListener("click", () => showHistoryDetail(change.id));

    name.textContent = change.name || getChangeItemLabel(change);
    name.title = change.name || "";
    time.textContent = formatHistoryTime(change.timestamp);
    time.dateTime = new Date(change.timestamp).toISOString();

    const location = getChangeLocation(change);
    scope.textContent = location || t("Unknown scope");
    scope.title = location || "";
    delta.textContent = `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`;

    main.append(name, time);
    sub.append(scope, delta, detailButton);
    if (state.undoSnapshots.has(change.id)) {
      const undoButton = document.createElement("button");
      const unavailableReason = getUndoUnavailableReason(state.undoSnapshots.get(change.id), state.tab, state.cookieStoreId);
      undoButton.type = "button";
      undoButton.className = "history-undo-button";
      undoButton.textContent = t("Undo");
      undoButton.disabled = Boolean(state.busy || state.loading || unavailableReason);
      undoButton.title = unavailableReason || t("Undo this change");
      undoButton.setAttribute("aria-label", unavailableReason || t("Undo this change"));
      undoButton.addEventListener("click", () => onUndo(change.id));
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

    onSelectHistoryView();
    const snapshot = state.undoSnapshots.get(change.id);
    state.selectedHistoryId = change.id;
    elements.historyDetailTitle.textContent = `${formatChangeAction(change.action)}: ${change.name || getChangeItemLabel(change)}`;
    renderHistoryDetailGrid(change);
    renderHistoryValueDetail(change, snapshot);
    elements.historyDetail.hidden = false;
    attachHistoryDetail(change.id);
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
      [t("Action"), formatChangeAction(change.action)],
      [t("Cookie"), change.name || ""],
      [t("Domain"), change.domain || ""],
      [t("Path"), change.path || ""],
      ...(change.hasExpirationDetails ? [
        [t("Before expiration"), formatHistoryExpiration(change.beforeSession, change.beforeExpirationDate)],
        [t("After expiration"), formatHistoryExpiration(change.afterSession, change.afterExpirationDate)]
      ] : []),
      [t("Store"), change.storeId || t("Default")],
      [t("Origin"), change.origin || ""],
      [t("Host"), change.host || ""],
      [t("Changed"), formatFullHistoryTime(change.timestamp)],
      [t("Size"), `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`],
      [t("Cookie ID"), change.cookieId || ""]
    ] : [
      [t("Action"), formatChangeAction(change.action)],
      [t("Key"), change.name || ""],
      [t("Storage"), getStorageTypeLabel(change.storageType)],
      [t("Origin"), change.origin || ""],
      [t("Host"), change.host || ""],
      [t("Changed"), formatFullHistoryTime(change.timestamp)],
      [t("Size"), `${formatBytes(change.beforeSize)} -> ${formatBytes(change.afterSize)}`],
      [t("Item ID"), change.itemId || ""]
    ];

    if (Number.isInteger(change.targetTabId)) {
      rows.push([t("Original tab"), String(change.targetTabId)]);
      rows.push([t("Browsing mode"), change.targetIncognito ? t("Incognito") : t("Regular")]);
    }

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

  function renderHistoryValueDetail(change, snapshot) {
    if (snapshot && "beforeValue" in snapshot && "afterValue" in snapshot) {
      renderValueDiff(elements.historyBeforeValue, elements.historyAfterValue, snapshot.beforeValue || "", snapshot.afterValue || "");
      elements.historyValueDetail.hidden = false;
      const unavailableReason = getUndoUnavailableReason(snapshot, state.tab, state.cookieStoreId);
      elements.historyDetailNote.hidden = !unavailableReason;
      elements.historyDetailNote.textContent = unavailableReason;
      return;
    }

    elements.historyBeforeValue.replaceChildren();
    elements.historyAfterValue.replaceChildren();
    elements.historyValueDetail.hidden = true;
    elements.historyDetailNote.hidden = false;
    elements.historyDetailNote.textContent =
      t("Value snapshots are only available during the current browser session.");
  }

  return {
    clearHistoryDetail,
    getVisibleRecentChanges,
    renderHistory,
    localize() {
      renderHistory();
      if (state.selectedHistoryId && !elements.historyDetail.hidden) showHistoryDetail(state.selectedHistoryId);
    },
    updateHistoryButtonState
  };
}

function formatHistoryExpiration(session, expirationDate) {
  if (session) {
    return t("Session");
  }
  if (!Number.isFinite(expirationDate)) {
    return t("Unknown");
  }
  return new Date(expirationDate * 1000).toLocaleString();
}

function isCookieChange(change) {
  return (change.itemKind || "cookie") === "cookie";
}

function getChangeItemLabel(change) {
  return isCookieChange(change) ? t("Cookie") : getStorageTypeLabel(change.storageType);
}

function getChangeLocation(change) {
  if (isCookieChange(change)) {
    return `${change.host || ""} ${change.domain || ""}${change.path || ""}`.trim();
  }
  return `${change.host || ""} ${change.origin || ""} ${getStorageTypeLabel(change.storageType)}`.trim();
}

function renderValueDiff(beforeElement, afterElement, beforeValue, afterValue) {
  const diff = getSingleRangeDiff(beforeValue, afterValue);
  beforeElement.replaceChildren(...createDiffNodes(beforeValue, diff.beforeStart, diff.beforeEnd, "diff-removed"));
  afterElement.replaceChildren(...createDiffNodes(afterValue, diff.afterStart, diff.afterEnd, "diff-added"));
}

export function getSingleRangeDiff(beforeValue, afterValue) {
  const beforeLength = beforeValue.length;
  const afterLength = afterValue.length;
  let prefixLength = 0;
  while (prefixLength < beforeLength && prefixLength < afterLength && beforeValue[prefixLength] === afterValue[prefixLength]) {
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
    edit: t("Edit"),
    delete: t("Delete"),
    "import-create": t("Import create"),
    "import-overwrite": t("Import overwrite")
  }[action] || t("Change");
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
