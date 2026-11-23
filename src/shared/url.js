import { t } from "./i18n.js";
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
    return t("Unsupported page");
  }
  return url.host;
}

export function getSiteOrigin(value) {
  return parseHttpUrl(value)?.origin || "";
}

export function getOriginPermissionPattern(value) {
  const url = parseHttpUrl(value);
  if (!url) {
    return null;
  }
  return `${url.protocol}//${url.hostname}/*`;
}

export function getSiteCookiePermissionPatterns(value) {
  const url = parseHttpUrl(value);
  if (!url) return [];

  const host = url.hostname;
  const hosts = [host];
  // Cookie API checks a cookie's own domain and its secure flag, rather than
  // just the selected page URL. Use exact ancestor hosts, never sibling wildcards.
  if (!host.startsWith("[") && !/^\d+(?:\.\d+){3}$/.test(host)) {
    const labels = host.split(".");
    for (let index = 1; index < labels.length - 1; index += 1) {
      hosts.push(labels.slice(index).join("."));
    }
  }
  return hosts.flatMap((domain) => [`http://${domain}/*`, `https://${domain}/*`]);
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
