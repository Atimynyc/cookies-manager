export function getEditorDraftKey(target, kind, itemId) {
  return JSON.stringify([
    target.tabId, target.origin, target.incognito, target.cookieStoreId, kind, itemId
  ]);
}

export function getEditorRowSignature(row) {
  const item = row.raw;
  return JSON.stringify(row.type
    ? [item.type, item.origin, item.key, item.value]
    : [item.name, item.value, item.domain, item.path, item.hostOnly, item.storeId,
      item.session, item.session ? null : item.expirationDate, item.secure, item.httpOnly,
      item.sameSite, item.partitionKey?.topLevelSite, item.partitionKey?.hasCrossSiteAncestor]);
}

export function createEditorDraftStore() {
  const drafts = new Map();

  function capture(key, row, value, expiration, originalExpiration) {
    if (value === row.value && expiration === originalExpiration) {
      drafts.delete(key);
      return;
    }
    drafts.set(key, {
      value,
      expiration,
      baseline: drafts.get(key)?.baseline || getEditorRowSignature(row)
    });
  }

  return {
    capture,
    get: (key) => drafts.get(key),
    remove: (key) => drafts.delete(key),
    hasConflict: (key, row) => Boolean(
      drafts.has(key) && drafts.get(key).baseline !== getEditorRowSignature(row)
    )
  };
}
