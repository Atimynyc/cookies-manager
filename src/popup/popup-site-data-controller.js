import { getBatchOperationCounts } from "../shared/operation-result.js";
import { getOperation, listOperations, runOperation, undoOperation } from "../shared/operation-client.js";
import { operationToBatchResult } from "../shared/operation-presentation.js";
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
  resolveSiteProfileVariables
} from "../shared/site-profiles.js";
import {
  getSiteProfiles,
  addSiteProfile,
  renameStoredSiteProfile,
  duplicateStoredSiteProfile,
  deleteStoredSiteProfile
} from "../shared/site-profile-store.js";
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
  let latestImportId = "";
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
    suppressCookieWatcher(Math.max(1500, plan.write.length * 30));
    const job = await runOperation({
      target, label: `Import ${plan.write.length} items`, source: "package-import",
      items: plan.write.map((item) => ({
        id: item.id, kind: item.kind, name: item.name, before: item.current, after: item.incoming
      })),
      skipped: plan.skipped.map(({ item, reason }) => ({ item: { id: item.id, kind: item.kind, name: item.name }, reason }))
    }, { onProgress });
    latestImportId = job.id;
    const result = operationToBatchResult(job);

    await refreshData();
    if (autoRefreshPage && result.success.length > 0) {
      await reloadOperationTarget(target);
    }
    showBatchImportStatus(result);
    return { result, canUndo: result.success.length > 0 };
  }

  async function undoLatestBatch({ onProgress } = {}) {
    const snapshot = latestImportId ? await getOperation(latestImportId)
      : (await listOperations()).find((job) => job.source === "package-import");
    if (!snapshot || !snapshot.items.some((item) => ["applied", "undo-failed", "undo-conflict"].includes(item.state))) {
      throw new Error("No import snapshot is available in this browser session.");
    }
    const target = await getVerifiedCurrentTarget(snapshot.target,
      "Return to the original target tab, site, and browsing mode before undoing this import.");
    const autoRefreshPage = state.autoRefreshPage;

    suppressCookieWatcher(Math.max(1500, snapshot.items.length * 30));
    const itemIds = snapshot.items.filter((item) => ["applied", "undo-failed", "undo-conflict"].includes(item.state)).map((item) => item.id);
    const job = await undoOperation(snapshot.id, { onProgress, target });
    const result = operationToBatchResult(job, { undo: true, itemIds });

    await refreshData();
    if (autoRefreshPage && result.success.length > 0) {
      await reloadOperationTarget(target);
    }
    showStatus(
      result.failed.length > 0
        ? `Undo restored ${result.success.length} items; ${result.failed.length} failed.`
        : `Undid ${result.success.length} imported items.`,
      result.failed.length > 0 ? "error" : "success"
    );
    return { result, complete: result.failed.length === 0 };
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
    return addSiteProfile(profile);
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
    if (name === null) {
      return getSiteProfiles();
    }
    return renameStoredSiteProfile(profile.id, name);
  }

  async function duplicateSavedProfile(profile) {
    return duplicateStoredSiteProfile(profile.id);
  }

  async function deleteSavedProfile(profile) {
    const confirmed = await requestDeleteConfirmation({
      title: "Delete saved state?",
      message: `"${profile.name}" will be permanently deleted.`,
      detail: profile.source.origin
    });
    if (!confirmed) {
      return getSiteProfiles();
    }
    return deleteStoredSiteProfile(profile.id);
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
