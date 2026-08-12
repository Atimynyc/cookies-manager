function getPartitionKeyParts(partitionKey) {
  if (!partitionKey || typeof partitionKey !== "object") {
    return ["", ""];
  }

  return [
    partitionKey.topLevelSite || "",
    typeof partitionKey.hasCrossSiteAncestor === "boolean"
      ? String(partitionKey.hasCrossSiteAncestor)
      : ""
  ];
}

export function makeCookieId(cookie = {}) {
  return encodeIdParts([
    cookie.storeId || "",
    ...getPartitionKeyParts(cookie.partitionKey),
    cookie.domain || "",
    cookie.path || "",
    cookie.name || ""
  ]);
}

export function makeStorageId(item = {}) {
  return encodeIdParts([
    item.type || "",
    item.origin || "",
    item.key || ""
  ]);
}

function encodeIdParts(parts) {
  return encodeURIComponent(JSON.stringify(parts));
}

export function getSiteDataItemId(kind, item = {}) {
  if (kind === "cookie" || kind === "cookies") {
    return makeCookieId(item);
  }

  if (kind === "localStorage" || kind === "sessionStorage") {
    const type = kind === "localStorage" ? "local" : "session";
    return makeStorageId({ ...item, type: item.type || type });
  }

  if (kind === "local" || kind === "session" || kind === "storage") {
    return makeStorageId({ ...item, type: item.type || kind });
  }

  throw new TypeError(`Unsupported site data kind: ${kind}`);
}
