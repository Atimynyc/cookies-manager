import { createRecentChange } from "./recent-changes.js";
import { toCookieRow } from "./cookie-format.js";
import { toStorageRow } from "./storage-format.js";
import { getDisplayHost } from "./url.js";

export function projectOperationHistory(jobs) {
  const changes = [];
  const snapshots = {};
  for (const job of jobs) {
    for (let index = job.items.length - 1; index >= 0; index -= 1) {
      const item = job.items[index];
      if (!["applied", "undoing", "undone", "undo-failed", "undo-conflict"].includes(item.state)) continue;
      const raw = item.before || item.after;
      const row = item.kind === "cookies" ? toCookieRow(raw) : toStorageRow(raw);
      const action = !item.after ? "delete" : job.source?.includes("import")
        ? item.before ? "import-overwrite" : "import-create" : "edit";
      const change = createRecentChange(row, item.after?.value || "", getDisplayHost(job.target.url),
        typeof job.createdAt === "number" ? job.createdAt : Date.parse(job.createdAt), {
          action, target: job.target, beforeSize: item.before ? row.size : 0,
          beforeSession: item.before?.session, beforeExpirationDate: item.before?.expirationDate,
          afterSession: item.after?.session, afterExpirationDate: item.after?.expirationDate
        });
      change.id = `${job.id}:${item.id}`;
      change.operationId = job.id;
      change.operationItemIndex = index;
      if (!item.after) change.afterSize = 0;
      changes.push(change);
      if (item.state !== "undone") {
        snapshots[change.id] = {
          itemKind: change.itemKind, target: job.target, raw,
          storageType: row.type || "", key: row.name,
          beforeValue: item.before?.value || "", afterValue: item.after?.value || "",
          operationId: job.id, operationItemId: item.id
        };
      }
    }
  }
  changes.sort(compareRecentChangeOrder);
  return { changes, snapshots };
}

export function compareRecentChangeOrder(a, b) {
  return b.timestamp - a.timestamp || (a.operationId && a.operationId === b.operationId
    ? (b.operationItemIndex || 0) - (a.operationItemIndex || 0) : String(b.id || "").localeCompare(String(a.id || "")));
}
