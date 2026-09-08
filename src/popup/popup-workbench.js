import { parseSiteDataPackage } from "../shared/site-data-package.js";
import {
  parseNetscapeCookieFile
} from "../shared/netscape-cookies.js";
import { cancelDialogFromBackdrop } from "./popup-dialogs.js";
import { createSiteDataExportView } from "./popup-export-view.js";
import { createSavedStatesView } from "./popup-saved-states-view.js";

const STATUS_LABELS = {
  new: "New",
  modified: "Modified",
  same: "Same",
  conflict: "Conflict",
  unsupported: "Unsupported"
};

const KIND_LABELS = {
  cookies: "Cookie",
  localStorage: "Local",
  sessionStorage: "Session"
};

export function createSiteDataWorkbench({
  dialog,
  getContext,
  onPreview,
  onApply,
  onUndo,
  onQuickImport,
  onBuildPackage,
  onExportSelectionChange,
  onCopy,
  onSaveJson,
  onSaveText,
  onLoadProfiles,
  onCreateProfile,
  onRenameProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onExportProfile,
  onResolveProfile
}) {
  const elements = getElements(dialog);
  const state = {
    dataPackage: null,
    preview: null,
    selectedIds: new Set(),
    busy: false
  };

  const exportView = createSiteDataExportView({
    dialog,
    getContext,
    setWorkbenchBusy: setBusy,
    onBuildPackage,
    onExportSelectionChange,
    onCopy,
    onSaveJson,
    onSaveText
  });

  const savedStatesView = createSavedStatesView({
    dialog,
    getContext,
    setBusy,
    onLoadProfiles,
    onCreateProfile,
    onRenameProfile,
    onDuplicateProfile,
    onDeleteProfile,
    onExportProfile,
    onPrepareProfile: prepareProfile
  });

  bindEvents();

  async function open(initialView = "import") {
    const context = getContext();
    elements.workbenchTarget.textContent = context.targetLabel;
    elements.workbenchTarget.title = context.targetLabel;
    if (initialView === "import") {
      setFormat(elements.packageImportFormatInputs, "quick");
      resetQuickImport();
      showPackageSource();
      elements.packageImportView.scrollTop = 0;
    }
    updateQuickImportContext();
    updateImportFormat();
    setView(initialView);
    dialog.showModal();
    if (initialView === "import") {
      focusQuickImport();
    }
    if (initialView === "export") {
      exportView.open();
    }
    if (initialView !== "profiles") {
      return;
    }
    await savedStatesView.open();
  }

  function bindEvents() {
    elements.workbenchCloseButton.addEventListener("click", () => dialog.close("cancel"));
    dialog.addEventListener("click", cancelDialogFromBackdrop);
    elements.quickImportButton.addEventListener("click", importQuickEntries);
    elements.quickEntryAddButton.addEventListener("click", addQuickEntryRow);
    elements.quickEntryRows.addEventListener("click", removeQuickEntryRow);
    elements.quickEntryRows.addEventListener("input", () => setFeedback(elements.quickImportError));
    elements.choosePackageFileButton.addEventListener("click", () => elements.packageFileInput.click());
    elements.packageFileInput.addEventListener("change", readSelectedFile);
    elements.packageFileDropzone.addEventListener("dragenter", handlePackageFileDrag);
    elements.packageFileDropzone.addEventListener("dragover", handlePackageFileDrag);
    elements.packageFileDropzone.addEventListener("dragleave", handlePackageFileDragLeave);
    elements.packageFileDropzone.addEventListener("drop", importDroppedPackageFile);
    for (const input of elements.packageImportFormatInputs) {
      input.addEventListener("change", updateImportFormat);
    }
    elements.previewPackageButton.addEventListener("click", previewTextPackage);
    elements.changePackageSourceButton.addEventListener("click", showPackageSource);
    elements.packageMappingToggle.addEventListener("change", refreshPreview);
    elements.packageSelectAll.addEventListener("change", toggleAllPreviewItems);
    elements.packageConflictStrategy.addEventListener("change", updateApplyState);
    elements.applyPackageButton.addEventListener("click", applyPreview);
    elements.importAnotherButton.addEventListener("click", resetImport);
    elements.undoPackageButton.addEventListener("click", undoBatch);
  }

  function setView(view) {
    const normalized = ["import", "export", "profiles"].includes(view) ? view : "import";
    elements.workbenchTitle.textContent = {
      import: "Import",
      export: "Export",
      profiles: "Saved States"
    }[normalized];
    for (const view of elements.views) {
      view.hidden = view.dataset.workbenchView !== normalized;
    }
  }

  function resetQuickImport() {
    elements.quickEntryRows.replaceChildren(createQuickEntryRow());
    setFeedback(elements.quickImportError);
    updateQuickEntryRows();
  }

  function createQuickEntryRow() {
    return elements.quickEntryRowTemplate.content.firstElementChild.cloneNode(true);
  }

  function addQuickEntryRow() {
    const row = createQuickEntryRow();
    elements.quickEntryRows.append(row);
    updateQuickEntryRows();
    row.querySelector(".cookie-import-name").focus();
  }

  function removeQuickEntryRow(event) {
    const button = event.target.closest(".cookie-import-remove");
    const row = button?.closest(".cookie-import-row");
    if (!row) {
      return;
    }
    const nextFocus = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    updateQuickEntryRows();
    nextFocus?.querySelector(".cookie-import-name")?.focus();
  }

  function updateQuickEntryRows() {
    const cookies = getContext().currentKind === "cookies";
    const nameLabel = cookies ? "Cookie name" : "Storage key";
    const valueLabel = cookies ? "Cookie value" : "Storage value";
    const rows = Array.from(elements.quickEntryRows.querySelectorAll(".cookie-import-row"));
    rows.forEach((row, index) => {
      const nameInput = row.querySelector(".cookie-import-name");
      const valueInput = row.querySelector(".cookie-import-value");
      nameInput.placeholder = nameLabel;
      valueInput.placeholder = valueLabel;
      nameInput.setAttribute("aria-label", `${nameLabel} ${index + 1}`);
      valueInput.setAttribute("aria-label", `${valueLabel} ${index + 1}`);
      row.querySelector(".cookie-import-remove").hidden = rows.length === 1;
    });
  }

  function readQuickEntryRows() {
    return Array.from(elements.quickEntryRows.querySelectorAll(".cookie-import-row"), (row) => ({
      name: row.querySelector(".cookie-import-name").value,
      value: row.querySelector(".cookie-import-value").value
    }));
  }

  function updateQuickImportContext() {
    const context = getContext();
    const cookies = context.currentKind === "cookies";
    elements.quickEntryTitle.textContent = {
      cookies: "Cookies",
      localStorage: "Local Storage",
      sessionStorage: "Session Storage"
    }[context.currentKind] || context.currentViewLabel;
    elements.quickEntryNameColumn.textContent = cookies ? "Name" : "Key";
    elements.quickEntryValueColumn.textContent = "Value";
    updateQuickEntryRows();
  }

  function focusQuickImport() {
    if (getImportFormat() !== "quick") {
      return;
    }
    elements.quickEntryRows.querySelector(".cookie-import-name")?.focus();
  }

  async function importQuickEntries() {
    const input = readQuickEntryRows();
    setFeedback(elements.quickImportError);
    setBusy(true);
    try {
      await onQuickImport(input);
      dialog.close("imported");
    } catch (error) {
      setFeedback(elements.quickImportError, error?.message || "Enter valid site data.");
      const rows = Array.from(elements.quickEntryRows.querySelectorAll(".cookie-import-row"));
      rows[Number.isInteger(error?.rowIndex) ? error.rowIndex : 0]
        ?.querySelector(".cookie-import-name")?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function readSelectedFile() {
    const [file] = elements.packageFileInput.files || [];
    if (!file) {
      return;
    }
    await loadPackageFile(file);
    elements.packageFileInput.value = "";
  }

  function handlePackageFileDrag(event) {
    if (!isFileDrag(event) || state.busy) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    elements.packageFileDropzone.classList.add("is-dragging");
  }

  function handlePackageFileDragLeave(event) {
    if (event.relatedTarget && elements.packageFileDropzone.contains(event.relatedTarget)) {
      return;
    }
    elements.packageFileDropzone.classList.remove("is-dragging");
  }

  async function importDroppedPackageFile(event) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    elements.packageFileDropzone.classList.remove("is-dragging");
    if (state.busy) {
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) {
      setFeedback(elements.packageInputError, "Drop one import file at a time.");
      return;
    }
    await loadPackageFile(files[0]);
  }

  async function loadPackageFile(file) {
    elements.packageFileName.textContent = file.name;
    elements.packageFileName.title = file.name;
    try {
      const text = await file.text();
      elements.packageTextInput.value = text;
      if (/\.json$/i.test(file.name)) {
        setFormat(elements.packageImportFormatInputs, "json");
      } else if (/^\s*# (?:Netscape HTTP Cookie File|HTTP Cookie File)/i.test(text) || /\t(?:TRUE|FALSE)\t/i.test(text)) {
        if (getContext().currentKind !== "cookies") {
          throw new Error("Netscape / cURL files can only be imported from Cookies.");
        }
        setFormat(elements.packageImportFormatInputs, "netscape");
      }
      updateImportFormat();
      setFeedback(elements.packageInputError);
    } catch (error) {
      setFeedback(elements.packageInputError, error?.message || "Failed to read the selected file.");
    }
  }

  async function previewTextPackage() {
    setFeedback(elements.packageInputError);
    try {
      state.dataPackage = getImportFormat() === "netscape"
        ? parseNetscapeCookieFile(elements.packageTextInput.value, {
          sourceUrl: getContext().targetUrl,
          storeId: getContext().cookieStoreId
        })
        : parseSiteDataPackage(elements.packageTextInput.value);
      elements.packageMappingToggle.checked = false;
      await refreshPreview();
    } catch (error) {
      setFeedback(elements.packageInputError, error?.message || "Invalid site data package.");
    }
  }

  async function refreshPreview() {
    if (!state.dataPackage) {
      return;
    }
    setBusy(true);
    try {
      state.preview = await onPreview(state.dataPackage, {
        mapSourceToTarget: elements.packageMappingToggle.checked
      });
      state.selectedIds = new Set(
        state.preview.items.filter((item) => item.writeable).map((item) => item.id)
      );
      renderPreview();
      elements.packageImportSource.hidden = true;
      elements.packageResult.hidden = true;
      elements.packagePreview.hidden = false;
    } catch (error) {
      showPackageSource();
      setFeedback(elements.packageInputError, error?.message || "Failed to build import preview.");
    } finally {
      setBusy(false);
    }
  }

  function renderPreview() {
    const preview = state.preview;
    elements.packagePreviewSource.textContent = preview.source.origin;
    elements.packagePreviewTarget.textContent = `Target: ${preview.target.origin}`;
    elements.packageMappingControl.hidden = !preview.requiresMapping;
    elements.packagePreviewCounts.replaceChildren(
      ...["new", "modified", "same", "conflict", "unsupported"].map((status) => {
        const count = document.createElement("div");
        count.className = "preview-count";
        const value = document.createElement("strong");
        value.textContent = String(preview.counts[status]);
        const label = document.createElement("span");
        label.textContent = STATUS_LABELS[status];
        count.append(value, label);
        return count;
      })
    );
    const orderedItems = [...preview.items].sort((left, right) => {
      const ranks = { new: 0, modified: 1, conflict: 2, unsupported: 3, same: 4 };
      return ranks[left.status] - ranks[right.status];
    });
    elements.packagePreviewList.replaceChildren(...orderedItems.map(createPreviewItem));
    updatePreviewSelection();
  }

  function createPreviewItem(item) {
    const row = document.createElement("label");
    row.className = "preview-item";
    row.dataset.previewId = item.id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.selectedIds.has(item.id);
    input.disabled = !item.writeable;
    input.addEventListener("change", () => {
      if (input.checked) {
        state.selectedIds.add(item.id);
      } else {
        state.selectedIds.delete(item.id);
      }
      updatePreviewSelection();
    });
    const kind = document.createElement("span");
    kind.className = "preview-item-kind";
    kind.textContent = KIND_LABELS[item.kind];
    const copy = document.createElement("span");
    copy.className = "preview-item-copy";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const detail = document.createElement("span");
    detail.textContent = getPreviewDetail(item);
    detail.title = detail.textContent;
    copy.append(name, detail);
    const status = document.createElement("span");
    status.className = `preview-status is-status-${item.status}`;
    status.textContent = STATUS_LABELS[item.status];
    row.append(input, kind, copy, status);
    return row;
  }

  function getPreviewDetail(item) {
    if (item.reason) {
      return item.reason;
    }
    if (item.current) {
      return `${truncate(item.current.value)} -> ${truncate(item.incoming.value)}`;
    }
    return truncate(item.incoming.value);
  }

  function toggleAllPreviewItems() {
    const writeable = state.preview?.items.filter((item) => item.writeable) || [];
    if (elements.packageSelectAll.checked) {
      writeable.forEach((item) => state.selectedIds.add(item.id));
    } else {
      writeable.forEach((item) => state.selectedIds.delete(item.id));
    }
    for (const input of elements.packagePreviewList.querySelectorAll('input[type="checkbox"]:not(:disabled)')) {
      input.checked = state.selectedIds.has(input.closest(".preview-item").dataset.previewId);
    }
    updatePreviewSelection();
  }

  function updatePreviewSelection() {
    const writeable = state.preview?.items.filter((item) => item.writeable) || [];
    const selectedCount = writeable.filter((item) => state.selectedIds.has(item.id)).length;
    elements.packageSelectionCount.textContent = `${selectedCount} selected`;
    elements.packageSelectAll.checked = writeable.length > 0 && selectedCount === writeable.length;
    elements.packageSelectAll.indeterminate = selectedCount > 0 && selectedCount < writeable.length;
    updateApplyState();
  }

  function updateApplyState() {
    elements.applyPackageButton.disabled = state.busy || state.selectedIds.size === 0;
  }

  async function applyPreview() {
    if (!state.preview || state.selectedIds.size === 0) {
      return;
    }
    setBusy(true);
    elements.packagePreview.hidden = true;
    elements.packageResult.hidden = false;
    elements.packageResultTitle.textContent = "Applying site data";
    elements.packageResultSummary.textContent = "Preparing batch";
    elements.packageResultList.replaceChildren();
    elements.packageProgress.max = 1;
    elements.packageProgress.value = 0;
    elements.undoPackageButton.hidden = true;
    try {
      const outcome = await onApply(state.preview, {
        strategy: elements.packageConflictStrategy.value,
        selectedIds: [...state.selectedIds],
        onProgress: updateProgress
      });
      renderResult(outcome.result, "Import complete");
      elements.undoPackageButton.hidden = !outcome.canUndo;
    } catch (error) {
      elements.packageResultTitle.textContent = "Import failed";
      elements.packageResultSummary.textContent = error?.message || "The batch could not be applied.";
    } finally {
      setBusy(false);
    }
  }

  function updateProgress({ completed, total }) {
    elements.packageProgress.max = Math.max(total, 1);
    elements.packageProgress.value = completed;
    elements.packageResultSummary.textContent = `${completed} of ${total}`;
  }

  function renderResult(result, title) {
    const entries = [
      ...result.success.map((entry) => ({ ...entry, status: "success", message: "Written" })),
      ...result.failed.map((entry) => ({ ...entry, status: "failed", message: entry.error.message })),
      ...result.skipped.map((entry) => ({ ...entry, status: "skipped", message: entry.reason }))
    ];
    const counts = {
      success: result.success.length,
      failed: result.failed.length,
      skipped: result.skipped.length
    };
    elements.packageResultTitle.textContent = title;
    elements.packageResultSummary.textContent = `${counts.success} succeeded, ${counts.failed} failed, ${counts.skipped} skipped`;
    elements.packageProgress.max = Math.max(entries.length, 1);
    elements.packageProgress.value = entries.length;
    elements.packageResultList.replaceChildren(...entries.map(createResultItem));
  }

  function createResultItem(entry) {
    const item = entry.item?.item || entry.item;
    const row = document.createElement("div");
    row.className = "result-item";
    const kind = document.createElement("span");
    kind.className = "result-item-kind";
    kind.textContent = KIND_LABELS[item?.kind] || "Item";
    const copy = document.createElement("span");
    copy.className = "result-item-copy";
    const name = document.createElement("strong");
    name.textContent = item?.name || item?.incoming?.name || item?.incoming?.key || "Site data item";
    const message = document.createElement("span");
    message.textContent = entry.message;
    message.title = entry.message;
    copy.append(name, message);
    const status = document.createElement("span");
    status.className = `result-status is-status-${entry.status}`;
    status.textContent = entry.status;
    row.append(kind, copy, status);
    return row;
  }

  async function undoBatch() {
    setBusy(true);
    elements.packageResultTitle.textContent = "Undoing import";
    try {
      const outcome = await onUndo({ onProgress: updateProgress });
      renderResult(outcome.result, outcome.complete ? "Import undone" : "Undo incomplete");
      elements.undoPackageButton.hidden = outcome.complete;
    } catch (error) {
      elements.packageResultTitle.textContent = "Undo failed";
      elements.packageResultSummary.textContent = error?.message || "The batch could not be undone.";
    } finally {
      setBusy(false);
    }
  }

  function showPackageSource() {
    elements.packageImportSource.hidden = false;
    elements.packagePreview.hidden = true;
    elements.packageResult.hidden = true;
  }

  function resetImport() {
    state.dataPackage = null;
    state.preview = null;
    state.selectedIds.clear();
    elements.packageTextInput.value = "";
    elements.packageFileInput.value = "";
    elements.packageFileName.textContent = "or drop a file here";
    elements.packageFileName.title = "";
    elements.packageFileDropzone.classList.remove("is-dragging");
    elements.packageMappingToggle.checked = false;
    setFeedback(elements.packageInputError);
    showPackageSource();
    updateImportFormat();
  }

  function updateImportFormat() {
    const cookies = getContext().currentKind === "cookies";
    let format = getImportFormat();
    if (!cookies && format === "netscape") {
      setFormat(elements.packageImportFormatInputs, "quick");
      format = "quick";
    }
    const quick = format === "quick";
    const netscape = format === "netscape";
    elements.netscapeImportFormatLabel.hidden = !cookies;
    elements.packageImportFormatSwitch.classList.toggle("is-storage", !cookies);
    elements.quickImportFields.hidden = !quick;
    elements.packageImportFields.hidden = quick;
    elements.packageInputLabel.textContent = netscape ? "Netscape cookie jar" : "Package JSON";
    elements.packageTextInput.placeholder = netscape
      ? "Paste Netscape / cURL cookie data"
      : "Paste a site data package";
    elements.packageFileInput.accept = netscape
      ? "text/plain,.txt,.cookies"
      : "application/json,.json";
    elements.packageImportFormatNote.hidden = !netscape;
    setFeedback(elements.quickImportError);
    setFeedback(elements.packageInputError);
    if (quick && dialog.open) {
      focusQuickImport();
    }
  }

  async function prepareProfile(profile, inputs, mapSourceToTarget) {
    state.dataPackage = await onResolveProfile(profile, inputs);
    elements.packageConflictStrategy.value = profile.defaultConflictStrategy;
    elements.packageMappingToggle.checked = mapSourceToTarget;
    setFormat(elements.packageImportFormatInputs, "json");
    updateImportFormat();
    elements.packageTextInput.value = JSON.stringify(state.dataPackage, null, 2);
    setView("import");
    await refreshPreview();
  }

  function getImportFormat() {
    return getFormat(elements.packageImportFormatInputs);
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const button of dialog.querySelectorAll("button")) {
      if (button === elements.workbenchCloseButton) {
        continue;
      }
      button.disabled = busy;
    }
    if (!busy) {
      updateApplyState();
    }
  }

  return { open };
}

function getElements(dialog) {
  const byId = (id) => dialog.querySelector(`#${id}`);
  return {
    workbenchTitle: byId("workbenchTitle"),
    workbenchTarget: byId("workbenchTarget"),
    workbenchCloseButton: byId("workbenchCloseButton"),
    views: Array.from(dialog.querySelectorAll("[data-workbench-view]")),
    packageImportView: byId("packageImportView"),
    packageImportSource: byId("packageImportSource"),
    packageImportFormatSwitch: byId("packageImportFormatSwitch"),
    packageImportFormatInputs: Array.from(dialog.querySelectorAll('input[name="packageImportFormat"]')),
    quickImportFields: byId("quickImportFields"),
    quickEntryFields: byId("quickEntryFields"),
    quickEntryTitle: byId("quickEntryTitle"),
    quickEntryNameColumn: byId("quickEntryNameColumn"),
    quickEntryValueColumn: byId("quickEntryValueColumn"),
    quickImportButton: byId("quickImportButton"),
    quickImportError: byId("quickImportError"),
    quickEntryAddButton: byId("quickEntryAddButton"),
    quickEntryRows: byId("quickEntryRows"),
    quickEntryRowTemplate: byId("quickEntryRowTemplate"),
    packageImportFields: byId("packageImportFields"),
    packageInputLabel: byId("packageInputLabel"),
    packageImportFormatNote: byId("packageImportFormatNote"),
    packageTextInput: byId("packageTextInput"),
    packageFileInput: byId("packageFileInput"),
    packageFileDropzone: byId("packageFileDropzone"),
    choosePackageFileButton: byId("choosePackageFileButton"),
    packageFileName: byId("packageFileName"),
    previewPackageButton: byId("previewPackageButton"),
    packageInputError: byId("packageInputError"),
    packagePreview: byId("packagePreview"),
    packagePreviewSource: byId("packagePreviewSource"),
    packagePreviewTarget: byId("packagePreviewTarget"),
    changePackageSourceButton: byId("changePackageSourceButton"),
    packageMappingControl: byId("packageMappingControl"),
    packageMappingToggle: byId("packageMappingToggle"),
    packagePreviewCounts: byId("packagePreviewCounts"),
    packageSelectAll: byId("packageSelectAll"),
    packageSelectionCount: byId("packageSelectionCount"),
    packageConflictStrategy: byId("packageConflictStrategy"),
    packagePreviewList: byId("packagePreviewList"),
    applyPackageButton: byId("applyPackageButton"),
    packageResult: byId("packageResult"),
    packageResultTitle: byId("packageResultTitle"),
    packageResultSummary: byId("packageResultSummary"),
    packageProgress: byId("packageProgress"),
    packageResultList: byId("packageResultList"),
    undoPackageButton: byId("undoPackageButton"),
    importAnotherButton: byId("importAnotherButton"),
    netscapeImportFormatLabel: byId("netscapeImportFormatLabel")
  };
}

function setFeedback(element, message = "", type = "error") {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("is-error", type === "error");
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function getFormat(inputs) {
  return inputs.find((input) => input.checked)?.value || "json";
}

function setFormat(inputs, format) {
  const input = inputs.find((item) => item.value === format);
  if (input) {
    input.checked = true;
  }
}

function truncate(value, maxLength = 90) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
