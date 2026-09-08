import {
  reloadTab,
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
import { getDisplayHost, getSiteOrigin, isSupportedPageUrl } from "../shared/url.js";
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
    const dataPackage = await buildPackageForScope(scope);
    const count = Object.values(dataPackage.data)
      .reduce((total, items) => total + items.length, 0);
    return {
      ...dataPackage,
      url: state.tab.url,
      host: getDisplayHost(state.tab.url),
      type: scope === "all" ? "siteData" : state.dataView,
      count
    };
  }

  async function buildPackageForScope(scope) {
    if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
      throw new Error("Open an HTTP or HTTPS page before exporting site data.");
    }

    let rowsByKind;
    if (scope === "all") {
      rowsByKind = await readAllSiteDataRows(state.tab, state.cookieStoreId);
    } else {
      const rows = scope === "selected" ? getSelectedRows() : state.rows;
      if (scope === "selected" && rows.length === 0) {
        throw new Error("Select at least one item before exporting.");
      }
      rowsByKind = { cookies: [], localStorage: [], sessionStorage: [] };
      rowsByKind[state.dataView] = rows;
    }

    return createSiteDataPackage({
      url: state.tab.url,
      origin: getSiteOrigin(state.tab.url),
      cookies: rowsByKind.cookies,
      localStorage: rowsByKind.localStorage,
      sessionStorage: rowsByKind.sessionStorage
    });
  }

  async function previewPackage(dataPackage, options) {
    if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
      throw new Error("Open an HTTP or HTTPS page before importing site data.");
    }
    const rows = await readAllSiteDataRows(state.tab, state.cookieStoreId);
    return buildSiteDataImportPreview(parseSiteDataPackage(dataPackage), {
      cookies: rows.cookies.map((row) => row.raw),
      localStorage: rows.localStorage.map((row) => row.raw),
      sessionStorage: rows.sessionStorage.map((row) => row.raw)
    }, {
      targetUrl: state.tab.url,
      ...options
    });
  }

  async function applyPackage(preview, { strategy, selectedIds, onProgress }) {
    if (!state.tab?.url || !isSupportedPageUrl(state.tab.url)) {
      throw new Error("The target page is no longer available.");
    }

    const plan = planSiteDataImport(preview, { strategy, selectedIds });
    const result = createBatchOperationResult();
    plan.skipped.forEach(({ item, reason }) => addOperationSkip(result, item, reason));
    suppressCookieWatcher(Math.max(1500, plan.write.length * 30));

    const executed = await executeBatchOperation(plan.write, writeImportedItem, {
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
        targetUrl: state.tab.url,
        targetOrigin: getSiteOrigin(state.tab.url),
        tabId: state.tab.id,
        entries
      });
    }

    await refreshData();
    if (state.autoRefreshPage && entries.length > 0) {
      await reloadTab(state.tab.id);
    }
    showBatchImportStatus(result);
    return { result, canUndo: entries.length > 0 };
  }

  async function writeImportedItem(item) {
    if (item.kind === "cookies") {
      return setCookieData(state.tab.url, item.incoming);
    }
    const storageType = item.kind === "sessionStorage" ? "session" : "local";
    return setStorageValue(
      state.tab.id,
      state.tab.url,
      storageType,
      item.incoming.key,
      item.incoming.value
    );
  }

  async function undoLatestBatch({ onProgress } = {}) {
    const snapshot = await getLatestBatchSnapshot();
    if (!snapshot || snapshot.entries.length === 0) {
      throw new Error("No import snapshot is available in this browser session.");
    }
    if (!state.tab?.url || snapshot.tabId !== state.tab.id || snapshot.targetOrigin !== getSiteOrigin(state.tab.url)) {
      throw new Error("Return to the original target tab before undoing this import.");
    }

    suppressCookieWatcher(Math.max(1500, snapshot.entries.length * 30));
    const entries = [...snapshot.entries].reverse();
    const result = await executeBatchOperation(entries, undoImportedItem, {
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
    if (state.autoRefreshPage) {
      await reloadTab(state.tab.id);
    }
    showStatus(
      remainingEntries.length > 0
        ? `Undo restored ${result.success.length} items; ${result.failed.length} failed.`
        : `Undid ${result.success.length} imported items.`,
      remainingEntries.length > 0 ? "error" : "success"
    );
    return { result, complete: remainingEntries.length === 0 };
  }

  async function undoImportedItem(entry) {
    if (entry.before) {
      if (entry.kind === "cookies") {
        return setCookieData(state.tab.url, entry.before);
      }
      return setStorageValue(
        state.tab.id,
        state.tab.url,
        entry.kind === "sessionStorage" ? "session" : "local",
        entry.before.key,
        entry.before.value
      );
    }

    if (entry.kind === "cookies") {
      await removeCookie(state.tab.url, entry.after);
    } else {
      await removeStorageItem(
        state.tab.id,
        state.tab.url,
        entry.kind === "sessionStorage" ? "session" : "local",
        entry.after.key
      );
    }
    return null;
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
