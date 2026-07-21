const MAX_RECENT_CHANGES = 8;

export function createRecentChange(row, nextValue, host, timestamp = Date.now(), options = {}) {
  const itemKind = options.itemKind || row.kind || "cookie";

  return {
    id: `${timestamp}-${itemKind}-${row.id}`,
    timestamp,
    itemKind,
    itemId: row.id,
    cookieId: row.id,
    storageType: row.type || "",
    origin: row.origin || "",
    action: options.action || "edit",
    host,
    name: row.name,
    domain: row.domain,
    path: row.path,
    storeId: row.storeId || "Default",
    beforeSize: Number.isFinite(options.beforeSize) ? options.beforeSize : row.size,
    afterSize: getCookiePairSize(row.name, nextValue)
  };
}

export function normalizeRecentChanges(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }

  const countsByKind = new Map();

  return changes
    .filter((change) => change && typeof change.name === "string" && Number.isFinite(change.timestamp))
    .map((change) => ({
      ...change,
      cookieId: change.cookieId || "",
      itemId: change.itemId || change.cookieId || "",
      itemKind: change.itemKind || "cookie",
      storageType: change.storageType || "",
      origin: change.origin || "",
      action: change.action || "edit"
    }))
    .filter((change) => {
      const count = countsByKind.get(change.itemKind) || 0;
      if (count >= MAX_RECENT_CHANGES) {
        return false;
      }
      countsByKind.set(change.itemKind, count + 1);
      return true;
    });
}

export function getCookiePairSize(name, value) {
  return new TextEncoder().encode(`${name}=${value}`).length;
}

export function formatBytes(value) {
  return `${Number.isFinite(value) ? value : 0} B`;
}
