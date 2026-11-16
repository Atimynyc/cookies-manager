import { t } from "../shared/i18n.js";
import { forgetOperation, retryOperation, undoOperation } from "../shared/operation-client.js";
import { OPERATION_JOURNAL_KEY } from "../shared/operation-journal.js";
import { createOperationContext, getUndoUnavailableReason, reloadOperationTarget } from "../shared/operation-context.js";

const UNDO_STATES = new Set(["applied", "undo-failed", "undo-conflict"]);
const RETRY_STATES = new Set(["failed", "conflict"]);
const STATE_LABELS = {
  get pending() { return t("Queued"); }, get running() { return t("Writing"); }, get applied() { return t("Written"); }, get failed() { return t("Failed"); }, get conflict() { return t("Conflict"); },
  get undoing() { return t("Undoing"); }, get undone() { return t("Undone"); }, get "undo-failed"() { return t("Undo failed"); }, get "undo-conflict"() { return t("Undo conflict"); }
};

export function createOperationsView({ state, loadRecentChanges, refreshData, setBusy, showStatus, requestDeleteConfirmation }) {
  const list = document.querySelector("#operationList");
  const empty = document.querySelector("#operationsEmpty");
  const changesButton = document.querySelector("#changesTabButton");
  const operationsButton = document.querySelector("#operationsTabButton");
  const clearButton = document.querySelector("#clearHistoryButton");
  const openedJobs = new Set();
  let timer;

  function initialize() {
    changesButton.addEventListener("click", () => switchMode("changes"));
    operationsButton.addEventListener("click", () => switchMode("operations"));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "session" || !changes[OPERATION_JOURNAL_KEY]) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await loadRecentChanges();
        if (!state.busy && !state.loading) await refreshData({ preserveStatus: true });
      }, 200);
    });
    render();
  }

  function switchMode(mode) {
    state.historyMode = mode;
    document.querySelector("#historyDetail").hidden = true;
    void loadRecentChanges();
    render();
  }

  function render() {
    const active = state.historyMode === "operations";
    const jobs = state.operationJobs || [];
    changesButton.setAttribute("aria-pressed", String(!active));
    operationsButton.setAttribute("aria-pressed", String(active));
    clearButton.hidden = active;
    list.hidden = !active || jobs.length === 0;
    empty.hidden = !active || jobs.length > 0;
    if (!active) return;
    document.querySelector("#historyList").hidden = true;
    document.querySelector("#historyEmpty").hidden = true;
    document.querySelector("#historyDetail").hidden = true;
    list.replaceChildren(...jobs.map(createJob));
  }

  function createJob(job) {
    const row = document.createElement("li");
    row.dataset.operationId = job.id;
    const title = document.createElement("strong");
    title.textContent = job.label;
    const scope = document.createElement("span");
    scope.className = "operation-scope";
    scope.textContent = t`${job.target.origin} | Tab ${job.target.tabId} | ${job.target.incognito ? t("Incognito") : t("Regular")}`;
    const time = document.createElement("time");
    time.className = "operation-scope";
    time.dateTime = job.createdAt;
    time.textContent = new Date(job.createdAt).toLocaleString();
    const counts = new Map();
    for (const item of job.items) counts.set(item.state, (counts.get(item.state) || 0) + 1);
    const summary = document.createElement("p");
    summary.className = "operation-summary";
    summary.textContent = [...counts].map(([key, count]) => `${count} ${STATE_LABELS[key].toLowerCase()}`)
      .concat(job.skipped?.length ? [t`${job.skipped.length} skipped`] : []).join(", ");
    const actions = document.createElement("div");
    actions.className = "operation-actions";
    const running = job.status !== "completed";
    const blocked = state.busy || state.loading || running;
    const undoItems = job.items.filter((item) => UNDO_STATES.has(item.state));
    const targetReason = undoItems.map((item) => getUndoUnavailableReason({
      target: job.target, raw: item.before || item.after,
      itemKind: item.kind === "cookies" ? "cookie" : item.kind,
      storageType: item.kind === "sessionStorage" ? "session" : item.kind === "localStorage" ? "local" : ""
    }, state.tab, state.cookieStoreId)).find(Boolean);
    if (job.items.some((item) => RETRY_STATES.has(item.state))) {
      actions.append(button(t("Retry failed"), () => act(job, "retry"), blocked));
    }
    if (undoItems.length) {
      const undo = button(t("Undo"), () => act(job, "undo"), blocked || Boolean(targetReason));
      undo.title = targetReason || t("Undo unchanged items in this operation");
      actions.append(undo);
    }
    actions.append(button(t("Remove record"), () => act(job, "forget"), blocked));
    const details = document.createElement("details");
    details.open = openedJobs.has(job.id);
    details.addEventListener("toggle", () => details.open ? openedJobs.add(job.id) : openedJobs.delete(job.id));
    const toggle = document.createElement("summary");
    toggle.textContent = t`Items (${job.items.length + (job.skipped?.length || 0)})`;
    details.append(toggle);
    for (const item of job.items) {
      const detail = document.createElement("div");
      detail.className = "operation-item";
      detail.dataset.state = item.state;
      const name = document.createElement("span");
      name.textContent = `${item.kind === "cookies" ? t("Cookie") : item.kind === "localStorage" ? t("Local") : t("Session")}: ${item.name}`;
      const status = document.createElement("span");
      status.textContent = STATE_LABELS[item.state];
      detail.append(name, status);
      if (item.error) {
        const error = document.createElement("p");
        error.textContent = typeof item.error === "string" ? item.error : item.error.message;
        detail.append(error);
      }
      details.append(detail);
    }
    for (const item of job.skipped || []) {
      const skipped = document.createElement("p");
      skipped.className = "operation-scope";
      skipped.textContent = `${item.item?.name || item.name}: ${item.reason}`;
      details.append(skipped);
    }
    row.append(title, scope, time, summary, actions, details);
    if (job.executionError) {
      const error = document.createElement("p");
      error.className = "operation-error";
      error.textContent = job.executionError.message;
      row.append(error, button(t("Resume"), () => loadRecentChanges(), state.busy));
    }
    return row;
  }

  async function act(job, action) {
    if (state.busy || state.loading) return;
    if (action === "forget" && !await requestDeleteConfirmation({
      title: t("Remove operation record?"), message: t`"${job.label}" will no longer be retryable or undoable.`,
      confirmLabel: t("Remove record"), detail: job.target.origin
    })) return;
    const target = action === "undo" ? createOperationContext(state.tab, job.target.cookieStoreId) : null;
    setBusy(true);
    render();
    try {
      let result;
      if (action === "forget") await forgetOperation(job.id);
      else if (action === "retry") result = await retryOperation(job.id);
      else result = await undoOperation(job.id, { target });
      await loadRecentChanges();
      await refreshData();
      const changed = result?.items.some((item) => item.state !== job.items.find((previous) => previous.id === item.id)?.state
        && ["applied", "undone"].includes(item.state));
      if (state.autoRefreshPage && changed) await reloadOperationTarget(target || job.target);
      const failures = result?.items.filter((item) => RETRY_STATES.has(item.state) || item.state.startsWith("undo-")).length || 0;
      showStatus(action === "forget" ? t("Operation record removed.") : failures
        ? t`${failures} items still need attention.` : action === "undo" ? t("Operation undone.") : t("Retry complete."), failures ? "error" : "success");
    } catch (error) {
      showStatus(error?.message || t("The operation could not be completed."), "error");
    } finally {
      setBusy(false);
      render();
    }
  }

  return { initialize, render };
}

function button(label, action, disabled) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.disabled = Boolean(disabled);
  element.addEventListener("click", action);
  return element;
}
