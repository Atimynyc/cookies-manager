export function decodeUrlValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Value is not valid URL-encoded text.");
  }
}

export function encodeUrlValue(value) {
  return encodeURIComponent(value);
}

export function formatJsonValue(value) {
  return JSON.stringify(parseJsonCandidate(value), null, 2);
}

export function compactJsonValue(value) {
  return JSON.stringify(parseJsonCandidate(value));
}

const AUTO_VALUE_TOOL_DEFINITIONS = [
  {
    mode: "jwt",
    title: "JWT payload",
    run: decodeJwtPayload
  },
  {
    mode: "jsonFormat",
    title: "Formatted JSON",
    run: formatJsonValue
  },
  {
    mode: "jsonCompact",
    title: "Compacted JSON",
    run: compactJsonValue
  },
  {
    mode: "urlDecode",
    title: "URL decoded value",
    run: decodeUrlValue
  }
];

export function getAutoValueToolOutput(value) {
  const source = String(value ?? "");

  for (const definition of AUTO_VALUE_TOOL_DEFINITIONS) {
    try {
      const text = definition.run(source);
      if (text === source) {
        continue;
      }
      return {
        mode: definition.mode,
        title: definition.title,
        text
      };
    } catch {
      // Try the next helper in the auto-parse order.
    }
  }

  return null;
}

function parseJsonCandidate(value) {
  const candidates = [value.trim()];

  try {
    const decoded = decodeUrlValue(value).trim();
    if (decoded && decoded !== candidates[0]) {
      candidates.push(decoded);
    }
  } catch {
    // The raw value may still be valid JSON.
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }

  throw new Error("Value is not valid JSON.");
}

export function decodeJwtPayload(value) {
  const token = value.trim().replace(/^Bearer\s+/i, "");
  const parts = token.split(".");

  if (parts.length < 2 || !parts[1]) {
    throw new Error("Value is not a JWT.");
  }

  try {
    const payload = decodeBase64Url(parts[1]);
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  } catch {
    throw new Error("JWT payload could not be decoded.");
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
