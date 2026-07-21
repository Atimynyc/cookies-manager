export function parseHttpUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function isSupportedPageUrl(value) {
  return Boolean(parseHttpUrl(value));
}

export function getDisplayHost(value) {
  const url = parseHttpUrl(value);
  if (!url) {
    return "Unsupported page";
  }
  return url.host;
}

export function getOriginPermissionPattern(value) {
  const url = parseHttpUrl(value);
  if (!url) {
    return null;
  }
  return `${url.protocol}//${url.hostname}/*`;
}

export function getCookieScopedUrl(cookie, fallbackUrl) {
  const fallback = parseHttpUrl(fallbackUrl);
  const protocol = cookie.secure ? "https:" : fallback?.protocol || "https:";
  const host = (cookie.domain || fallback?.hostname || "").replace(/^\./, "");
  const path = normalizeCookiePath(cookie.path);

  if (!host) {
    return fallbackUrl;
  }

  return new URL(path, `${protocol}//${host}`).toString();
}

function normalizeCookiePath(path) {
  if (!path || !path.startsWith("/")) {
    return "/";
  }

  return path;
}
