const SAME_SITE_LABELS = {
  no_restriction: "None",
  lax: "Lax",
  strict: "Strict",
  unspecified: "Unspecified"
};

export function makeCookieId(cookie) {
  return [
    cookie.storeId || "",
    cookie.partitionKey?.topLevelSite || "",
    cookie.domain || "",
    cookie.path || "",
    cookie.name || ""
  ].join("|");
}

export function compareCookieRows(a, b) {
  return (
    a.domain.localeCompare(b.domain) ||
    a.path.localeCompare(b.path) ||
    a.name.localeCompare(b.name)
  );
}

export function toCookieRow(cookie) {
  return {
    id: makeCookieId(cookie),
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: formatExpires(cookie),
    size: getCookieSize(cookie),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: formatSameSite(cookie.sameSite),
    session: cookie.session,
    storeId: cookie.storeId,
    partitioned: Boolean(cookie.partitionKey),
    partitionKey: cookie.partitionKey || null,
    partitionTopLevelSite: cookie.partitionKey?.topLevelSite || "",
    raw: cookie
  };
}

export function getCookieSearchText(row) {
  return [row.name, row.value, row.domain, row.path, row.partitionTopLevelSite].join("\n").toLowerCase();
}

export function formatSameSite(value) {
  return SAME_SITE_LABELS[value] || value || "Unspecified";
}

export function formatExpires(cookie) {
  if (cookie.session) {
    return "Session";
  }

  if (!cookie.expirationDate) {
    return "Unknown";
  }

  return new Date(cookie.expirationDate * 1000).toLocaleString();
}

export function getCookieSize(cookie) {
  return new TextEncoder().encode(`${cookie.name}=${cookie.value}`).length;
}

export function getCookieJson(row) {
  return JSON.stringify(row.raw, null, 2);
}
