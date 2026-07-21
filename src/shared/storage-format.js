const STORAGE_LABELS = {
  local: "Local Storage",
  session: "Session Storage"
};

export function makeStorageId(item) {
  return [
    item.type || "",
    item.origin || "",
    item.key || ""
  ].join("|");
}

export function compareStorageRows(a, b) {
  return (
    a.origin.localeCompare(b.origin) ||
    a.name.localeCompare(b.name)
  );
}

export function toStorageRow(item) {
  const normalized = {
    type: item.type,
    key: String(item.key || ""),
    value: String(item.value || ""),
    origin: item.origin || ""
  };

  return {
    id: makeStorageId(normalized),
    kind: normalized.type === "session" ? "sessionStorage" : "localStorage",
    type: normalized.type,
    name: normalized.key,
    value: normalized.value,
    domain: normalized.origin,
    path: STORAGE_LABELS[normalized.type] || "Storage",
    expires: normalized.type === "session" ? "Tab session" : "Persistent",
    size: getStorageItemSize(normalized.key, normalized.value),
    httpOnly: false,
    secure: false,
    sameSite: "",
    session: normalized.type === "session",
    storeId: STORAGE_LABELS[normalized.type] || "Storage",
    partitioned: false,
    origin: normalized.origin,
    raw: normalized
  };
}

export function getStorageSearchText(row) {
  return [row.name, row.value, row.origin, row.storeId].join("\n").toLowerCase();
}

export function getStorageJson(row) {
  return JSON.stringify(row.raw, null, 2);
}

export function getStorageItemSize(key, value) {
  return new TextEncoder().encode(`${key}=${value}`).length;
}

export function getStorageTypeLabel(type) {
  return STORAGE_LABELS[type] || "Storage";
}
