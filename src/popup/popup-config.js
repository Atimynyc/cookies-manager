import {
  compactJsonValue,
  decodeJwtPayload,
  decodeUrlValue,
  encodeUrlValue,
  formatJsonValue
} from "../shared/value-tools.js";

export const VALUE_TOOL_DEFINITIONS = {
  urlDecode: { title: "URL decoded value", run: decodeUrlValue },
  urlEncode: { title: "URL encoded value", run: encodeUrlValue },
  jsonFormat: { title: "Formatted JSON", run: formatJsonValue },
  jsonCompact: { title: "Compacted JSON", run: compactJsonValue },
  jwt: { title: "JWT payload", run: decodeJwtPayload }
};

export const DATA_VIEWS = {
  cookies: {
    storageType: "",
    singular: "cookie",
    plural: "cookies",
    title: "Cookie",
    emptyMessage: "No cookies for this page",
    unavailableMessage: "Cookies unavailable",
    unsupportedMessage: "Only http:// and https:// pages support cookie operations.",
    readErrorMessage: "Failed to read cookies.",
    exportKey: "cookies",
    pairLabel: "name=value",
    tableLabels: ["Name", "Value", "Domain", "Path", "Expires", "Flags", "Size"],
    metaLabels: ["Domain", "Path", "Expires", "SameSite", "Store", "Size"]
  },
  localStorage: {
    storageType: "local",
    singular: "local storage item",
    plural: "local storage items",
    title: "Local Storage",
    emptyMessage: "No local storage for this page",
    unavailableMessage: "Local storage unavailable",
    unsupportedMessage: "Only http:// and https:// pages support storage operations.",
    readErrorMessage: "Failed to read local storage.",
    exportKey: "items",
    pairLabel: "key=value",
    tableLabels: ["Key", "Value", "Origin", "Storage", "Scope", "Flags", "Size"],
    metaLabels: ["Origin", "Storage", "Scope", "SameSite", "Type", "Size"]
  },
  sessionStorage: {
    storageType: "session",
    singular: "session storage item",
    plural: "session storage items",
    title: "Session Storage",
    emptyMessage: "No session storage for this page",
    unavailableMessage: "Session storage unavailable",
    unsupportedMessage: "Only http:// and https:// pages support storage operations.",
    readErrorMessage: "Failed to read session storage.",
    exportKey: "items",
    pairLabel: "key=value",
    tableLabels: ["Key", "Value", "Origin", "Storage", "Scope", "Flags", "Size"],
    metaLabels: ["Origin", "Storage", "Scope", "SameSite", "Type", "Size"]
  }
};

export const DEFAULT_COLUMN_WIDTHS = [115, 150, 130, 84, 116, 92, 58];
export const MIN_COLUMN_WIDTHS = [76, 110, 104, 64, 102, 76, 54];
export const COLUMN_CSS_VARS = [
  "--cookie-col-name",
  "--cookie-col-value",
  "--cookie-col-domain",
  "--cookie-col-path",
  "--cookie-col-expires",
  "--cookie-col-flags",
  "--cookie-col-size"
];

const VALUE_TOOL_MODES = new Set(["none", ...Object.keys(VALUE_TOOL_DEFINITIONS)]);
const MAX_COLUMN_WIDTH = 360;

export function normalizeValueToolMode(mode) {
  return VALUE_TOOL_MODES.has(mode) ? mode : "none";
}

export function normalizeColumnWidths(widths) {
  if (!Array.isArray(widths)) {
    return [...DEFAULT_COLUMN_WIDTHS];
  }

  return DEFAULT_COLUMN_WIDTHS.map((defaultWidth, index) => {
    const width = Number(widths[index]);
    return Number.isFinite(width) ? clampColumnWidth(width, index) : defaultWidth;
  });
}

export function clampColumnWidth(width, index) {
  return Math.min(Math.max(Math.round(width), MIN_COLUMN_WIDTHS[index]), MAX_COLUMN_WIDTH);
}
