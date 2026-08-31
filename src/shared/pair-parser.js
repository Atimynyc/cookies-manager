export function parseNameValuePair(text, { kind = "cookie" } = {}) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);

  if (!line) {
    throw new TypeError(`Enter a valid ${getPairLabel(kind)}.`);
  }

  const pair = kind === "cookie"
    ? line.replace(/^Cookie:\s*/i, "").split(";")[0].trim()
    : line;
  const separatorIndex = pair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new TypeError(`Enter a valid ${getPairLabel(kind)}.`);
  }

  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1);

  if (kind === "cookie") {
    return createCookiePair(name, value);
  }
  return createStoragePair(name, value);
}

export function createCookiePair(name, value = "") {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new TypeError("Enter a cookie name.");
  }
  if (/[\s;=]/.test(normalizedName)) {
    throw new TypeError("Cookie name is invalid.");
  }
  return { name: normalizedName, value: String(value ?? "") };
}

export function createStoragePair(name, value = "") {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new TypeError("Enter a storage key.");
  }
  return { name: normalizedName, value: String(value ?? "") };
}

function getPairLabel(kind) {
  return kind === "cookie" ? "name=value" : "key=value";
}
