import { parseSiteDataPackage } from "../shared/site-data-package.js";
import { parseVariableCaptures } from "../shared/site-profiles.js";
import {
  NETSCAPE_COOKIE_FILE_MIME_TYPE,
  parseNetscapeCookieFile,
  serializeNetscapeCookieFile
} from "../shared/netscape-cookies.js";
import { cancelDialogFromBackdrop } from "./popup-dialogs.js";

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
    profiles: [],
    profileMode: "list",
    applyingProfile: null,
    busy: false,
    exportPreviewRequest: 0,
    exportSelectionExpanded: false,
    exportSelectionIds: new Set()
  };

  bindEvents();

  async function open(initialView = "import") {
    const context = getContext();
    elements.workbenchTarget.textContent = context.targetLabel;
    elements.workbenchTarget.title = context.targetLabel;
    elements.profileScopeSelect.querySelector('option[value="selected"]').disabled = context.selectedCount === 0;
    if (initialView === "import") {
      setFormat(elements.packageImportFormatInputs, "quick");
      resetQuickImport();
      showPackageSource();
      elements.packageImportView.scrollTop = 0;
    }
    if (initialView === "export") {
      state.exportSelectionIds = new Set(context.selectedIds || []);
      state.exportSelectionExpanded = false;
      elements.exportSelectionSearch.value = "";
      setFormat(elements.packageExportFormatInputs, "json");
      elements.currentExportScope.checked = true;
      setFeedback(elements.packageExportFeedback);
    }
    updateQuickImportContext();
    updateImportFormat();
    updateExportFormat();
    updateExportSelectionPanel();
    updateExportSummary();
    state.profileMode = "list";
    setView(initialView);
    dialog.showModal();
    if (initialView === "import") {
      focusQuickImport();
    }
    if (initialView === "export") {
      void updateExportPreview();
    }
    if (initialView !== "profiles") {
      return;
    }
    try {
      state.profiles = await onLoadProfiles();
    } catch {
      state.profiles = [];
    }
    renderProfiles();
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
    for (const radio of elements.exportScopeInputs) {
      radio.addEventListener("change", () => {
        if (radio.value === "selected") {
          state.exportSelectionExpanded = false;
        }
        updateExportSelectionPanel();
        updateExportSummary();
        void updateExportPreview();
      });
    }
    elements.exportSelectionToggleButton.addEventListener("click", toggleExportSelectionPanel);
    for (const input of elements.packageExportFormatInputs) {
      input.addEventListener("change", () => {
        updateExportFormat();
        updateExportSelectionPanel();
        void updateExportPreview();
      });
    }
    elements.exportSelectionSearch.addEventListener("input", renderExportSelectionList);
    elements.exportSelectAllCheckbox.addEventListener("change", toggleAllExportSelection);
    elements.exportSelectionList.addEventListener("change", toggleExportSelectionItem);
    elements.copyPackageButton.addEventListener("click", () => exportPackage("copy"));
    elements.savePackageButton.addEventListener("click", () => exportPackage("save"));
    elements.profileHelpButton.addEventListener("click", showProfileHelp);
    elements.profileHelpCloseButton.addEventListener("click", () => elements.profileHelpDialog.close("close"));
    elements.profileHelpDialog.addEventListener("click", cancelDialogFromBackdrop);
    elements.newProfileButton.addEventListener("click", showProfileForm);
    elements.cancelProfileButton.addEventListener("click", hideProfileForm);
    elements.profileForm.addEventListener("submit", createProfile);
    elements.cancelProfileApplyButton.addEventListener("click", hideProfileApply);
    elements.previewProfileButton.addEventListener("click", previewProfile);
  }

  function setView(view) {
    const normalized = ["import", "export", "profiles"].includes(view) ? view : "import";
    elements.workbenchTitle.textContent = {
      import: "Import",
      export: "Export",
      profiles: "Profiles"
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

  function updateExportFormat() {
    const cookies = getContext().currentKind === "cookies";
    let netscape = getExportFormat() === "netscape";
    if (!cookies && netscape) {
      setFormat(elements.packageExportFormatInputs, "json");
      netscape = false;
    }
    elements.netscapeExportFormatLabel.hidden = !cookies;
    elements.packageExportFormatSwitch.classList.toggle("is-storage", !cookies);
    updateExportScopeAvailability();
    elements.allExportScopeLabel.textContent = netscape ? "All cookies" : "All site data";
    setButtonLabel(elements.copyPackageButton, netscape ? "Copy Netscape" : "Copy JSON");
    setButtonLabel(elements.savePackageButton, netscape ? "Save cookies.txt" : "Save JSON");
    setFeedback(elements.packageExportFeedback);
    updateExportSummary();
  }

  function updateExportScopeAvailability() {
    const context = getContext();
    const netscape = getExportFormat() === "netscape";
    const currentIsCookies = context.currentKind === "cookies";
    const currentViewLabel = {
      cookies: "Cookies",
      localStorage: "Local Storage",
      sessionStorage: "Session Storage"
    }[context.currentKind] || context.currentViewLabel;
    elements.currentExportScopeLabel.textContent = `Current view(${currentViewLabel})`;
    elements.currentExportScope.disabled = netscape && !currentIsCookies;
    elements.selectedExportScope.disabled = netscape && !currentIsCookies;
    if (netscape && !currentIsCookies && getExportScope() !== "all") {
      elements.allExportScope.checked = true;
    }
  }

  function updateExportSelectionPanel() {
    const visible = getExportScope() === "selected";
    elements.exportSelectionPanel.hidden = !visible;
    elements.exportSelectionBody.hidden = !visible || !state.exportSelectionExpanded;
    elements.exportSelectionToggleButton.setAttribute("aria-expanded", String(visible && state.exportSelectionExpanded));
    elements.exportSelectionToggleButton.querySelector("span").textContent = state.exportSelectionExpanded
      ? "Hide items"
      : "Choose items";
    elements.selectedExportScopeCount.textContent = String(getSelectedExportRows().length);
    if (visible) {
      renderExportSelectionList();
    }
  }

  function toggleExportSelectionPanel() {
    state.exportSelectionExpanded = !state.exportSelectionExpanded;
    updateExportSelectionPanel();
    if (state.exportSelectionExpanded) {
      elements.exportSelectionSearch.focus();
    }
  }

  function renderExportSelectionList() {
    if (elements.exportSelectionPanel.hidden) {
      return;
    }

    const rows = getFilteredExportRows();
    const allRows = getContext().currentRows || [];
    const selectedRows = getSelectedExportRows();
    elements.exportSelectionCount.textContent = `${selectedRows.length} of ${allRows.length} selected`;
    elements.exportSelectAllCheckbox.checked = rows.length > 0 && rows.every((row) => state.exportSelectionIds.has(row.id));
    elements.exportSelectAllCheckbox.indeterminate = rows.some((row) => state.exportSelectionIds.has(row.id)) && !elements.exportSelectAllCheckbox.checked;
    elements.exportSelectionList.replaceChildren(...rows.map(createExportSelectionItem));
    elements.exportSelectionEmpty.hidden = rows.length > 0;
  }

  function getFilteredExportRows() {
    const rows = getContext().currentRows || [];
    const query = elements.exportSelectionSearch.value.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) => `${row.name} ${row.location} ${row.kind}`.toLowerCase().includes(query));
  }

  function getSelectedExportRows() {
    const rows = getContext().currentRows || [];
    return rows.filter((row) => state.exportSelectionIds.has(row.id));
  }

  function createExportSelectionItem(row) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    const location = document.createElement("span");
    const kind = document.createElement("span");

    label.className = "export-selection-item";
    label.dataset.exportId = row.id;
    checkbox.type = "checkbox";
    checkbox.checked = state.exportSelectionIds.has(row.id);
    checkbox.dataset.exportId = row.id;
    checkbox.setAttribute("aria-label", `Select ${row.name}`);
    copy.className = "export-selection-item-copy";
    name.textContent = row.name || "(unnamed)";
    location.textContent = row.location || "";
    kind.className = "export-selection-item-kind";
    kind.textContent = KIND_LABELS[row.kind] || row.kind || "Item";
    copy.append(name, location);
    label.append(checkbox, copy, kind);
    return label;
  }

  function toggleExportSelectionItem(event) {
    const input = event.target.closest("input[data-export-id]");
    if (!input) {
      return;
    }
    setExportSelection(input.dataset.exportId, input.checked);
  }

  function toggleAllExportSelection() {
    const checked = elements.exportSelectAllCheckbox.checked;
    getFilteredExportRows().forEach((row) => setExportSelectionValue(row.id, checked));
    notifyExportSelectionChange();
    updateExportSelectionPanel();
    updateExportSummary();
    void updateExportPreview();
  }

  function setExportSelection(id, selected) {
    setExportSelectionValue(id, selected);
    notifyExportSelectionChange();
    updateExportSelectionPanel();
    updateExportSummary();
    void updateExportPreview();
  }

  function setExportSelectionValue(id, selected) {
    if (selected) {
      state.exportSelectionIds.add(id);
    } else {
      state.exportSelectionIds.delete(id);
    }
  }

  function notifyExportSelectionChange() {
    onExportSelectionChange?.([...state.exportSelectionIds]);
  }

  function updateExportSummary() {
    const context = getContext();
    const scope = getExportScope();
    const netscape = getExportFormat() === "netscape";
    const summary = netscape
      ? {
        current: `${context.currentCount} cookies in the current view`,
        selected: `${context.selectedCount} selected cookies`,
        all: "All cookies for the current target"
      }[scope] + ". SameSite, Partitioned/CHIPS, and Cookie store are not represented."
      : {
        current: `${context.currentCount} ${context.currentViewLabel.toLowerCase()} in the current view`,
        selected: `${context.selectedCount} selected ${context.currentViewLabel.toLowerCase()}`,
        all: "Cookies, Local Storage, and Session Storage for the current target"
    }[scope];
    elements.packageExportSummary.textContent = summary;
    elements.packageExportSummary.title = summary;
  }

  async function updateExportPreview() {
    const requestId = ++state.exportPreviewRequest;
    const format = getExportFormat();
    elements.packageExportPreview.value = "Preparing preview...";
    try {
      setBusy(true);
      const dataPackage = await onBuildPackage(getExportScope());
      if (requestId !== state.exportPreviewRequest) {
        return;
      }
      elements.packageExportPreview.value = serializeExport(dataPackage, format);
    } catch (error) {
      if (requestId === state.exportPreviewRequest) {
        elements.packageExportPreview.value = error?.message || "Failed to build export preview.";
      }
    } finally {
      if (requestId === state.exportPreviewRequest) {
        setBusy(false);
      }
    }
  }

  async function exportPackage(mode) {
    setBusy(true);
    setFeedback(elements.packageExportFeedback);
    try {
      const dataPackage = await onBuildPackage(getExportScope());
      const netscape = getExportFormat() === "netscape";
      const text = serializeExport(dataPackage, getExportFormat());
      const count = netscape ? dataPackage.data.cookies.length : countPackageItems(dataPackage);
      if (mode === "copy") {
        await onCopy(text);
        setFeedback(elements.packageExportFeedback, `Copied ${count} ${netscape ? "cookies" : "items"}.`, "success");
      } else {
        if (netscape) {
          await onSaveText(text, createNetscapeFileName(dataPackage), NETSCAPE_COOKIE_FILE_MIME_TYPE);
        } else {
          await onSaveJson(dataPackage, createPackageFileName(dataPackage));
        }
        setFeedback(elements.packageExportFeedback, `Saved ${count} ${netscape ? "cookies" : "items"}.`, "success");
      }
    } catch (error) {
      setFeedback(elements.packageExportFeedback, error?.message || "Failed to export site data.");
    } finally {
      setBusy(false);
    }
  }

  function showProfileForm() {
    state.applyingProfile = null;
    elements.profileForm.reset();
    elements.profileScopeSelect.value = getContext().selectedCount > 0 ? "selected" : "current";
    setFeedback(elements.profileFormError);
    setProfileMode("create");
    elements.profileNameInput.focus();
  }

  function showProfileHelp() {
    const previouslyFocused = document.activeElement;
    elements.profileHelpBody.scrollTop = 0;
    elements.profileHelpDialog.addEventListener("close", () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    }, { once: true });
    elements.profileHelpDialog.showModal();
    elements.profileHelpDialog.focus();
  }

  function hideProfileForm() {
    setProfileMode("list");
  }

  async function createProfile(event) {
    event.preventDefault();
    setFeedback(elements.profileFormError);
    setBusy(true);
    try {
      const variables = parseVariableCaptures(elements.profileVariablesInput.value);
      state.profiles = await onCreateProfile({
        name: elements.profileNameInput.value,
        description: elements.profileDescriptionInput.value,
        tags: elements.profileTagsInput.value,
        scope: elements.profileScopeSelect.value,
        defaultConflictStrategy: elements.profileStrategySelect.value,
        variables
      });
      hideProfileForm();
      renderProfiles();
    } catch (error) {
      setFeedback(elements.profileFormError, error?.message || "Failed to save profile.");
    } finally {
      setBusy(false);
    }
  }

  function renderProfiles() {
    elements.profileCount.textContent = `${state.profiles.length} saved`;
    elements.profileList.replaceChildren(...state.profiles.map(createProfileItem));
    setProfileMode(state.profileMode);
  }

  function setProfileMode(mode) {
    state.profileMode = mode;
    const editing = mode !== "list";
    elements.profileList.hidden = editing || state.profiles.length === 0;
    elements.profileEmpty.hidden = editing || state.profiles.length > 0;
    elements.profileForm.hidden = mode !== "create";
    elements.profileApplyPanel.hidden = mode !== "apply";
  }

  function createProfileItem(profile) {
    const row = document.createElement("article");
    row.className = "profile-item";
    const copy = document.createElement("div");
    copy.className = "profile-item-copy";
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const description = document.createElement("span");
    description.textContent = profile.description || profile.source.origin;
    description.title = description.textContent;
    copy.append(name, description);
    if (profile.tags.length > 0) {
      const tags = document.createElement("span");
      tags.className = "profile-tags";
      tags.textContent = profile.tags.join(" · ");
      copy.append(tags);
    }
    const actions = document.createElement("div");
    actions.className = "profile-item-actions";
    actions.append(
      profileButton("Apply", () => showProfileApply(profile), "primary-button"),
      profileButton("Rename", () => updateProfileList(onRenameProfile(profile))),
      profileButton("Copy", () => updateProfileList(onDuplicateProfile(profile))),
      profileButton("Export", () => exportProfile(profile)),
      profileButton("Delete", () => updateProfileList(onDeleteProfile(profile)), "danger-button")
    );
    row.append(copy, actions);
    return row;
  }

  function profileButton(label, listener, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", listener);
    return button;
  }

  async function updateProfileList(promise) {
    setBusy(true);
    try {
      const profiles = await promise;
      if (profiles) {
        state.profiles = profiles;
        renderProfiles();
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportProfile(profile) {
    setBusy(true);
    try {
      await onExportProfile(profile);
    } finally {
      setBusy(false);
    }
  }

  function showProfileApply(profile) {
    state.applyingProfile = profile;
    elements.profileApplyName.textContent = profile.name;
    elements.profileVariableInputs.replaceChildren(...profile.variables.map((variable) => {
      const label = document.createElement("label");
      label.className = "workbench-field";
      const title = document.createElement("span");
      title.textContent = variable.name;
      const input = document.createElement("input");
      input.name = variable.name;
      input.type = variable.promptOnApply ? "password" : "text";
      input.value = variable.promptOnApply ? "" : variable.defaultValue;
      input.autocomplete = "off";
      input.required = variable.promptOnApply;
      label.append(title, input);
      return label;
    }));
    const crossOrigin = profile.source.origin !== new URL(getContext().targetUrl).origin;
    elements.profileMappingControl.hidden = !crossOrigin;
    elements.profileMappingToggle.checked = false;
    setFeedback(elements.profileApplyError);
    setProfileMode("apply");
    elements.profileVariableInputs.querySelector("input")?.focus();
  }

  function hideProfileApply() {
    state.applyingProfile = null;
    setProfileMode("list");
  }

  async function previewProfile() {
    const profile = state.applyingProfile;
    if (!profile) {
      return;
    }
    const inputs = Object.fromEntries(
      Array.from(elements.profileVariableInputs.querySelectorAll("input")).map((input) => [input.name, input.value])
    );
    setFeedback(elements.profileApplyError);
    setBusy(true);
    try {
      state.dataPackage = await onResolveProfile(profile, inputs);
      elements.packageConflictStrategy.value = profile.defaultConflictStrategy;
      elements.packageMappingToggle.checked = elements.profileMappingToggle.checked;
      setFormat(elements.packageImportFormatInputs, "json");
      updateImportFormat();
      elements.packageTextInput.value = JSON.stringify(state.dataPackage, null, 2);
      hideProfileApply();
      setView("import");
      await refreshPreview();
    } catch (error) {
      setFeedback(elements.profileApplyError, error?.message || "Failed to prepare profile.");
    } finally {
      setBusy(false);
    }
  }

  function getExportScope() {
    return elements.exportScopeInputs.find((input) => input.checked)?.value || "current";
  }

  function getImportFormat() {
    return getFormat(elements.packageImportFormatInputs);
  }

  function getExportFormat() {
    return getFormat(elements.packageExportFormatInputs);
  }

  function serializeExport(dataPackage, format) {
    return format === "netscape"
      ? serializeNetscapeCookieFile(dataPackage)
      : JSON.stringify(dataPackage, null, 2);
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
      updateExportScopeAvailability();
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
    selectedExportScope: byId("selectedExportScope"),
    currentExportScope: byId("currentExportScope"),
    currentExportScopeLabel: byId("currentExportScopeLabel"),
    allExportScope: byId("allExportScope"),
    allExportScopeLabel: byId("allExportScopeLabel"),
    exportScopeInputs: Array.from(dialog.querySelectorAll('input[name="exportScope"]')),
    packageExportFormatInputs: Array.from(dialog.querySelectorAll('input[name="packageExportFormat"]')),
    packageExportFormatSwitch: byId("packageExportFormatSwitch"),
    netscapeImportFormatLabel: byId("netscapeImportFormatLabel"),
    netscapeExportFormatLabel: byId("netscapeExportFormatLabel"),
    packageExportSummary: byId("packageExportSummary"),
    packageExportPreview: byId("packageExportPreview"),
    exportSelectionPanel: byId("exportSelectionPanel"),
    exportSelectionBody: byId("exportSelectionBody"),
    exportSelectionToggleButton: byId("exportSelectionToggleButton"),
    exportSelectionCount: byId("exportSelectionCount"),
    selectedExportScopeCount: byId("selectedExportScopeCount"),
    exportSelectionSearch: byId("exportSelectionSearch"),
    exportSelectAllCheckbox: byId("exportSelectAllCheckbox"),
    exportSelectionList: byId("exportSelectionList"),
    exportSelectionEmpty: byId("exportSelectionEmpty"),
    copyPackageButton: byId("copyPackageButton"),
    savePackageButton: byId("savePackageButton"),
    packageExportFeedback: byId("packageExportFeedback"),
    profileCount: byId("profileCount"),
    profileHelpButton: byId("profileHelpButton"),
    profileHelpDialog: byId("profileHelpDialog"),
    profileHelpBody: byId("profileHelpBody"),
    profileHelpCloseButton: byId("profileHelpCloseButton"),
    newProfileButton: byId("newProfileButton"),
    profileList: byId("profileList"),
    profileEmpty: byId("profileEmpty"),
    profileForm: byId("profileForm"),
    profileNameInput: byId("profileNameInput"),
    profileTagsInput: byId("profileTagsInput"),
    profileDescriptionInput: byId("profileDescriptionInput"),
    profileScopeSelect: byId("profileScopeSelect"),
    profileStrategySelect: byId("profileStrategySelect"),
    profileVariablesInput: byId("profileVariablesInput"),
    profileFormError: byId("profileFormError"),
    cancelProfileButton: byId("cancelProfileButton"),
    profileApplyPanel: byId("profileApplyPanel"),
    profileApplyName: byId("profileApplyName"),
    profileVariableInputs: byId("profileVariableInputs"),
    profileMappingControl: byId("profileMappingControl"),
    profileMappingToggle: byId("profileMappingToggle"),
    profileApplyError: byId("profileApplyError"),
    cancelProfileApplyButton: byId("cancelProfileApplyButton"),
    previewProfileButton: byId("previewProfileButton")
  };
}

function setFeedback(element, message = "", type = "error") {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("is-error", type === "error");
}

function setButtonLabel(button, label) {
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function countPackageItems(dataPackage) {
  return Object.values(dataPackage.data).reduce((count, items) => count + items.length, 0);
}

function createPackageFileName(dataPackage) {
  const host = new URL(dataPackage.source.url).hostname.replace(/[^a-z0-9.-]+/gi, "-");
  return `${host}-site-data-${new Date().toISOString().slice(0, 10)}.json`;
}

function createNetscapeFileName(dataPackage) {
  const host = new URL(dataPackage.source.url).hostname.replace(/[^a-z0-9.-]+/gi, "-");
  return `${host}-cookies-${new Date().toISOString().slice(0, 10)}.txt`;
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
