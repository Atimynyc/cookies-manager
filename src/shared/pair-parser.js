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

  if (!name || (kind === "cookie" && /[\s;=]/.test(name))) {
    throw new TypeError(kind === "cookie" ? "Cookie name is invalid." : "Storage key is invalid.");
  }

  return { name, value };
}

function getPairLabel(kind) {
  return kind === "cookie" ? "name=value" : "key=value";
}
