import { getSiteDataItemId } from "./item-identity.js";
import {
  areSiteDataItemsEqual,
  serializeCookie,
  serializeStorageItem
} from "./site-data-package.js";

export const IMPORT_CONFLICT_STRATEGIES = new Set([
  "overwrite",
  "skip",
  "add-only",
  "individual"
]);

const PACKAGE_KINDS = ["cookies", "localStorage", "sessionStorage"];

export function buildSiteDataImportPreview(dataPackage, currentData, {
  targetUrl,
  mapSourceToTarget = false
} = {}) {
  const target = parseTargetUrl(targetUrl);
  const source = new URL(dataPackage.source.url);
  const currentByKind = Object.fromEntries(PACKAGE_KINDS.map((kind) => [
    kind,
    new Map((currentData?.[kind] || []).map((item) => [getSiteDataItemId(kind, item), item]))
  ]));
  const seenIds = new Set();
  const items = [];

  for (const kind of PACKAGE_KINDS) {
    for (const sourceItem of dataPackage.data[kind]) {
      const mapped = mapItemToTarget(kind, sourceItem, source, target, mapSourceToTarget);
      const itemId = mapped.item ? getSiteDataItemId(kind, mapped.item) : getSiteDataItemId(kind, sourceItem);
      const previewId = `${kind}:${itemId}`;
      const duplicate = seenIds.has(previewId);
      seenIds.add(previewId);
      const current = mapped.item ? currentByKind[kind].get(itemId) || null : null;
      const classification = classifyPreviewItem(kind, mapped.item, current, {
        unsupportedReason: mapped.reason,
        duplicate
      });

      items.push({
        id: previewId,
        itemId,
        kind,
        name: kind === "cookies" ? sourceItem.name : sourceItem.key,
        incoming: mapped.item || sourceItem,
        original: sourceItem,
        current,
        status: classification.status,
        reason: classification.reason,
        writeable: classification.writeable
      });
    }
  }

  return {
    source: dataPackage.source,
    target: { url: target.href, origin: target.origin },
    mapped: source.origin !== target.origin && mapSourceToTarget,
    requiresMapping: source.origin !== target.origin,
    items,
    counts: countPreviewStatuses(items)
  };
}

export function planSiteDataImport(preview, {
  strategy = "overwrite",
  selectedIds = preview?.items?.filter((item) => item.writeable).map((item) => item.id) || []
} = {}) {
  if (!IMPORT_CONFLICT_STRATEGIES.has(strategy)) {
    throw new TypeError(`Unsupported import conflict strategy: ${strategy}`);
  }

  const selected = new Set(selectedIds);
  const write = [];
  const skipped = [];

  for (const item of preview?.items || []) {
    let reason = "";
    if (!item.writeable) {
      reason = item.reason || "Item is not supported.";
    } else if (!selected.has(item.id)) {
      reason = "Not selected.";
    } else if (item.status === "same") {
      reason = "Already identical.";
    } else if (
      (item.status === "modified" || item.status === "conflict") &&
      (strategy === "skip" || strategy === "add-only")
    ) {
      reason = strategy === "add-only" ? "Only new items are enabled." : "Existing item was kept.";
    } else if (
      (item.status === "modified" || item.status === "conflict") &&
      strategy === "individual" &&
      !selected.has(item.id)
    ) {
      reason = "Conflict was not selected.";
    }

    if (reason) {
      skipped.push({ item, reason });
    } else {
      write.push(item);
    }
  }

  return { write, skipped };
}

export function countPreviewStatuses(items) {
  const counts = {
    new: 0,
    modified: 0,
    same: 0,
    conflict: 0,
    unsupported: 0,
    total: 0
  };

  for (const item of items || []) {
    if (Object.hasOwn(counts, item.status)) {
      counts[item.status] += 1;
    }
    counts.total += 1;
  }
  return counts;
}

function classifyPreviewItem(kind, incoming, current, { unsupportedReason, duplicate }) {
  if (unsupportedReason) {
    return { status: "unsupported", reason: unsupportedReason, writeable: false };
  }
  if (duplicate) {
    return {
      status: "conflict",
      reason: "The package contains the same stable item more than once.",
      writeable: false
    };
  }
  if (!current) {
    return { status: "new", reason: "", writeable: true };
  }
  if (areSiteDataItemsEqual(incoming, current, kind)) {
    return { status: "same", reason: "No changes.", writeable: false };
  }
  if (hasOnlyValueDifference(kind, incoming, current)) {
    return { status: "modified", reason: "Value will change.", writeable: true };
  }
  return { status: "conflict", reason: "Cookie attributes differ from the target.", writeable: true };
}

function hasOnlyValueDifference(kind, incoming, current) {
  const serialize = kind === "cookies" ? serializeCookie : serializeStorageItem;
  const left = serialize(incoming);
  const right = serialize(current);
  delete left.value;
  delete right.value;
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapItemToTarget(kind, item, source, target, mapSourceToTarget) {
  const crossOrigin = source.origin !== target.origin;
  if (crossOrigin && !mapSourceToTarget) {
    return { item: null, reason: `Source origin ${source.origin} does not match ${target.origin}.` };
  }

  if (kind !== "cookies") {
    const itemOrigin = item.origin || source.origin;
    if (itemOrigin !== target.origin && !(mapSourceToTarget && itemOrigin === source.origin)) {
      return { item: null, reason: `Storage origin ${itemOrigin} cannot be written to ${target.origin}.` };
    }
    return { item: { ...item, origin: target.origin }, reason: "" };
  }

  const mapped = { ...item };
  if (mapped.secure && target.protocol !== "https:") {
    return { item: null, reason: "Secure cookies require an HTTPS target." };
  }
  if (mapped.sameSite === "no_restriction" && !mapped.secure) {
    return { item: null, reason: "SameSite=None cookies require Secure." };
  }
  if (mapped.session === false && !Number.isFinite(mapped.expirationDate)) {
    return { item: null, reason: "Persistent cookies require a valid expiration date." };
  }
  if (Number.isFinite(mapped.expirationDate) && mapped.expirationDate <= Date.now() / 1000) {
    return { item: null, reason: "The cookie expiration date is in the past." };
  }
  if (mapped.partitionKey && !isValidPartitionKey(mapped.partitionKey)) {
    return { item: null, reason: "The partition key is not supported." };
  }

  if (!cookieDomainMatchesHost(mapped.domain, target.hostname)) {
    if (!mapSourceToTarget || !cookieDomainMatchesHost(mapped.domain, source.hostname)) {
      return { item: null, reason: `Cookie domain ${mapped.domain} is not valid for ${target.hostname}.` };
    }
    mapped.domain = mapped.hostOnly ? target.hostname : `${mapped.domain.startsWith(".") ? "." : ""}${target.hostname}`;
  }

  return { item: mapped, reason: "" };
}

function cookieDomainMatchesHost(domain, host) {
  const normalized = String(domain || "").replace(/^\./, "").toLowerCase();
  const normalizedHost = String(host || "").toLowerCase();
  return Boolean(normalized) && (normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`));
}

function isValidPartitionKey(partitionKey) {
  if (!partitionKey || typeof partitionKey !== "object" || Array.isArray(partitionKey)) {
    return false;
  }
  if (typeof partitionKey.topLevelSite !== "string") {
    return false;
  }
  if (
    Object.hasOwn(partitionKey, "hasCrossSiteAncestor") &&
    typeof partitionKey.hasCrossSiteAncestor !== "boolean"
  ) {
    return false;
  }
  try {
    const url = new URL(partitionKey.topLevelSite);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseTargetUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
    return url;
  } catch {
    throw new TypeError("A valid HTTP or HTTPS target URL is required.");
  }
}
