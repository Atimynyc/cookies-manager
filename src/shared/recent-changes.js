const MAX_RECENT_CHANGES = 8;

export function createRecentChange(row, nextValue, host, timestamp = Date.now(), options = {}) {
  const itemKind = options.itemKind || row.kind || "cookie";

  const change = {
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

  if (itemKind === "cookie") {
    const raw = row.raw || {};
    change.hasExpirationDetails = true;
    change.beforeSession = Object.hasOwn(options, "beforeSession")
      ? Boolean(options.beforeSession)
      : Boolean(raw.session);
    change.beforeExpirationDate = Object.hasOwn(options, "beforeExpirationDate")
      ? (Number.isFinite(options.beforeExpirationDate) ? options.beforeExpirationDate : null)
      : (Number.isFinite(raw.expirationDate) ? raw.expirationDate : null);
    change.afterSession = Object.hasOwn(options, "afterSession")
      ? Boolean(options.afterSession)
      : change.beforeSession;
    change.afterExpirationDate = Object.hasOwn(options, "afterExpirationDate")
      ? (Number.isFinite(options.afterExpirationDate) ? options.afterExpirationDate : null)
      : change.beforeExpirationDate;
  }

  return change;
}

export function normalizeRecentChanges(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }

  const countsByKind = new Map();

  return changes
    .filter((change) => change && typeof change.name === "string" && Number.isFinite(change.timestamp))
    .map((change) => {
      const normalized = {
        ...change,
        cookieId: change.cookieId || "",
        itemId: change.itemId || change.cookieId || "",
        itemKind: change.itemKind || "cookie",
        storageType: change.storageType || "",
        origin: change.origin || "",
        action: change.action || "edit"
      };

      if (change.hasExpirationDetails) {
        Object.assign(normalized, {
          hasExpirationDetails: true,
          beforeSession: Boolean(change.beforeSession),
          beforeExpirationDate: Number.isFinite(change.beforeExpirationDate) ? change.beforeExpirationDate : null,
          afterSession: Boolean(change.afterSession),
          afterExpirationDate: Number.isFinite(change.afterExpirationDate) ? change.afterExpirationDate : null
        });
      }

      return normalized;
    })
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
