import {
  removeCookie,
  setCookieData
} from "../shared/cookie-api.js";
import {
  removeStorageItem,
  setStorageValue
} from "../shared/storage-api.js";
import { executeBatchOperation } from "../shared/batch-operations.js";
import {
  addOperationSkip,
  createBatchOperationResult,
  getBatchOperationCounts
} from "../shared/operation-result.js";
import {
  createSiteDataPackage,
  parseSiteDataPackage
} from "../shared/site-data-package.js";
import {
  buildSiteDataImportPreview,
  planSiteDataImport
} from "../shared/site-data-import.js";
import {
  createSiteProfile,
  duplicateSiteProfile,
  renameSiteProfile,
  resolveSiteProfileVariables
} from "../shared/site-profiles.js";
import {
  getSiteProfiles,
  saveSiteProfiles
} from "../shared/site-profile-store.js";
import {
  clearLatestBatchSnapshot,
  getLatestBatchSnapshot,
  saveLatestBatchSnapshot
} from "../shared/batch-snapshot-store.js";
import { getDisplayHost } from "../shared/url.js";
import { assertOperationContext, createOperationContext, reloadOperationTarget } from "../shared/operation-context.js";
import { readAllSiteDataRows } from "./popup-data-service.js";
import { saveJsonFile } from "./popup-downloads.js";

export function createPopupSiteDataController({
  state,
  getSelectedRows,
  refreshData,
  suppressCookieWatcher,
  showStatus,
  requestDeleteConfirmation,
  requestTextInput
}) {
  async function buildExportForScope(scope) {
    const dataView = state.dataView;
    const dataPackage = await buildPackageForScope(scope);
    const count = Object.values(dataPackage.data)
      .reduce((total, items) => total + items.length, 0);
    return {
      ...dataPackage,
      url: dataPackage.source.url,
      host: getDisplayHost(dataPackage.source.url),
      type: scope === "all" ? "siteData" : dataView,
      count
    };
  }

  async function buildPackageForScope(scope) {
    const target = createOperationContext(state.tab, state.cookieStoreId);
    const dataView = state.dataView;

    let rowsByKind;
    if (scope === "all") {
      await assertOperationContext(target);
      rowsByKind = await readAllSiteDataRows(toTargetTab(target), target.cookieStoreId);
      await assertOperationContext(target);
    } else {
      const rows = scope === "selected" ? getSelectedRows() : state.rows;
      if (scope === "selected" && rows.length === 0) {
        throw new Error("Select at least one item before exporting.");
      }
      rowsByKind = { cookies: [], localStorage: [], sessionStorage: [] };
      rowsByKind[dataView] = rows;
      await assertOperationContext(target);
    }

    return createSiteDataPackage({
      url: target.url,
      origin: target.origin,
      cookies: rowsByKind.cookies,
      localStorage: rowsByKind.localStorage,
      sessionStorage: rowsByKind.sessionStorage
    });
  }

  async function previewPackage(dataPackage, options) {
    const target = createOperationContext(state.tab, state.cookieStoreId);
    const parsedPackage = parseSiteDataPackage(dataPackage);
    parsedPackage.data.cookies = parsedPackage.data.cookies.map((cookie) => ({
      ...cookie,
      storeId: cookie.storeId || target.cookieStoreId
    }));
    await assertOperationContext(target);
    const rows = await readAllSiteDataRows(toTargetTab(target), target.cookieStoreId);
    await assertOperationContext(target);
    const preview = buildSiteDataImportPreview(parsedPackage, {
      cookies: rows.cookies.map((row) => row.raw),
      localStorage: rows.localStorage.map((row) => row.raw),
      sessionStorage: rows.sessionStorage.map((row) => row.raw)
    }, {
      ...options,
      targetUrl: target.url
    });
    return { ...preview, operationTarget: target };
  }

  async function applyPackage(preview, { strategy, selectedIds, onProgress }) {
    const target = await getVerifiedCurrentTarget(preview?.operationTarget,
      "The import target changed. Build a new preview before applying this package.");
    const autoRefreshPage = state.autoRefreshPage;

    const plan = planSiteDataImport(preview, { strategy, selectedIds });
    const result = createBatchOperationResult();
    plan.skipped.forEach(({ item, reason }) => addOperationSkip(result, item, reason));
    suppressCookieWatcher(Math.max(1500, plan.write.length * 30));

    const executed = await executeBatchOperation(plan.write, (item) => writeImportedItem(item, target), {
      onProgress,
      yieldEvery: 10
    });
    result.success.push(...executed.success);
    result.failed.push(...executed.failed);

    const entries = executed.success.map((entry, index) => ({
      id: `${Date.now()}-${index}-${entry.item.id}`,
      kind: entry.item.kind,
      name: entry.item.name,
      before: entry.item.current,
      after: entry.value
    }));
    if (entries.length > 0) {
      await saveLatestBatchSnapshot({
        id: `${Date.now()}-site-data-import`,
        createdAt: new Date().toISOString(),
        targetUrl: target.url,
        targetOrigin: target.origin,
        tabId: target.tabId,
        target,
        entries
      });
    }

    await refreshData();
    if (autoRefreshPage && entries.length > 0) {
      await reloadOperationTarget(target);
    }
    showBatchImportStatus(result);
    return { result, canUndo: entries.length > 0 };
  }

  async function writeImportedItem(item, target) {
    await assertOperationContext(target);
    if (item.kind === "cookies") {
      assertCookieStore(item.incoming, target);
      return setCookieData(target.url, item.incoming);
    }
    const storageType = item.kind === "sessionStorage" ? "session" : "local";
    return setStorageValue(
      target.tabId,
      target.url,
      storageType,
      item.incoming.key,
      item.incoming.value
    );
  }

  async function undoLatestBatch({ onProgress } = {}) {
    const snapshot = await getLatestBatchSnapshot();
    if (!snapshot || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
      throw new Error("No import snapshot is available in this browser session.");
    }
    if (!snapshot.target) {
      throw new Error("This older import has no verified target information and cannot be undone.");
    }
    const target = await getVerifiedCurrentTarget(snapshot.target,
      "Return to the original target tab, site, and browsing mode before undoing this import.");
    const autoRefreshPage = state.autoRefreshPage;

    suppressCookieWatcher(Math.max(1500, snapshot.entries.length * 30));
    const entries = [...snapshot.entries].reverse();
    const result = await executeBatchOperation(entries, (entry) => undoImportedItem(entry, target), {
      onProgress,
      yieldEvery: 10
    });
    const failedIds = new Set(result.failed.map((entry) => entry.item.id));
    const remainingEntries = snapshot.entries.filter((entry) => failedIds.has(entry.id));
    if (remainingEntries.length > 0) {
      await saveLatestBatchSnapshot({ ...snapshot, entries: remainingEntries });
    } else {
      await clearLatestBatchSnapshot();
    }

    await refreshData();
    if (autoRefreshPage && result.success.length > 0) {
      await reloadOperationTarget(target);
    }
    showStatus(
      remainingEntries.length > 0
        ? `Undo restored ${result.success.length} items; ${result.failed.length} failed.`
        : `Undid ${result.success.length} imported items.`,
      remainingEntries.length > 0 ? "error" : "success"
    );
    return { result, complete: remainingEntries.length === 0 };
  }

  async function undoImportedItem(entry, target) {
    await assertOperationContext(target);
    if (entry.kind === "cookies") {
      assertCookieStore(entry.before || entry.after, target);
    }
    if (entry.before) {
      if (entry.kind === "cookies") {
        return setCookieData(target.url, entry.before);
      }
      return setStorageValue(
        target.tabId,
        target.url,
        entry.kind === "sessionStorage" ? "session" : "local",
        entry.before.key,
        entry.before.value
      );
    }

    if (entry.kind === "cookies") {
      await removeCookie(target.url, entry.after);
    } else {
      await removeStorageItem(
        target.tabId,
        target.url,
        entry.kind === "sessionStorage" ? "session" : "local",
        entry.after.key
      );
    }
    return null;
  }

  async function getVerifiedCurrentTarget(savedTarget, message) {
    const current = createOperationContext(state.tab, state.cookieStoreId);
    if (!savedTarget || ["tabId", "origin", "cookieStoreId", "incognito"].some(
      (field) => savedTarget[field] !== current[field]
    )) {
      throw new Error(message);
    }
    const target = Object.freeze({ ...savedTarget });
    await assertOperationContext(target);
    return target;
  }

  function assertCookieStore(cookie, target) {
    if (!target.cookieStoreId || cookie?.storeId !== target.cookieStoreId) {
      throw new Error("The imported cookie store does not match the target cookie store.");
    }
  }

  function toTargetTab(target) {
    return { id: target.tabId, url: target.url, incognito: target.incognito };
  }

  function showBatchImportStatus(result) {
    const counts = getBatchOperationCounts(result);
    const summary = `${counts.success} written, ${counts.failed} failed, ${counts.skipped} skipped.`;
    showStatus(summary, counts.failed ? "error" : counts.success ? "success" : "warning");
  }

  async function createProfileFromCurrentSite(options) {
    const dataPackage = await buildPackageForScope(options.scope);
    const profile = createSiteProfile({
      name: options.name,
      description: options.description,
      tags: options.tags,
      dataPackage,
      defaultConflictStrategy: options.defaultConflictStrategy,
      variables: options.variables
    });
    const profiles = await getSiteProfiles();
    return saveSiteProfiles([profile, ...profiles]);
  }

  async function renameSavedProfile(profile) {
    const name = await requestTextInput({
      title: "Rename saved state",
      fieldLabel: "Saved state name",
      initialValue: profile.name,
      submitLabel: "Rename",
      selectValue: true,
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          throw new Error("Enter a saved state name.");
        }
        return trimmed;
      }
    });
    const profiles = await getSiteProfiles();
    if (name === null) {
      return profiles;
    }
    return saveSiteProfiles(profiles.map((item) => item.id === profile.id ? renameSiteProfile(item, name) : item));
  }

  async function duplicateSavedProfile(profile) {
    const profiles = await getSiteProfiles();
    return saveSiteProfiles([duplicateSiteProfile(profile), ...profiles]);
  }

  async function deleteSavedProfile(profile) {
    const confirmed = await requestDeleteConfirmation({
      title: "Delete saved state?",
      message: `"${profile.name}" will be permanently deleted.`,
      detail: profile.source.origin
    });
    const profiles = await getSiteProfiles();
    if (!confirmed) {
      return profiles;
    }
    return saveSiteProfiles(profiles.filter((item) => item.id !== profile.id));
  }

  async function exportSavedProfile(profile) {
    const fileName = `${profile.name.replace(/[^a-z0-9.-]+/gi, "-") || "site-profile"}.json`;
    await saveJsonFile({ profileSchemaVersion: 1, profile }, fileName);
  }

  return {
    applyPackage,
    buildExportForScope,
    createProfileFromCurrentSite,
    deleteSavedProfile,
    duplicateSavedProfile,
    exportSavedProfile,
    getProfiles: getSiteProfiles,
    previewPackage,
    renameSavedProfile,
    resolveProfileVariables: resolveSiteProfileVariables,
    undoLatestBatch
  };
}
