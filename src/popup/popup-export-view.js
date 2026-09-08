import {
  NETSCAPE_COOKIE_FILE_MIME_TYPE,
  serializeNetscapeCookieFile
} from "../shared/netscape-cookies.js";

const KIND_LABELS = {
  cookies: "Cookie",
  localStorage: "Local",
  sessionStorage: "Session"
};

export function createSiteDataExportView({
  dialog,
  getContext,
  setWorkbenchBusy,
  onBuildPackage,
  onExportSelectionChange,
  onCopy,
  onSaveJson,
  onSaveText
}) {
  const elements = getElements(dialog);
  const state = {
    previewRequest: 0,
    selectionExpanded: false,
    selectedIds: new Set()
  };

  bindEvents();

  function open() {
    const context = getContext();
    state.selectedIds = new Set(context.selectedIds || []);
    state.selectionExpanded = false;
    elements.exportSelectionSearch.value = "";
    setFormat(elements.packageExportFormatInputs, "json");
    elements.currentExportScope.checked = true;
    setFeedback(elements.packageExportFeedback);
    updateExportFormat();
    updateExportSelectionPanel();
    updateExportSummary();
    void updateExportPreview();
  }

  function bindEvents() {
    for (const radio of elements.exportScopeInputs) {
      radio.addEventListener("change", () => {
        if (radio.value === "selected") {
          state.selectionExpanded = false;
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
    elements.exportSelectionBody.hidden = !visible || !state.selectionExpanded;
    elements.exportSelectionToggleButton.setAttribute("aria-expanded", String(visible && state.selectionExpanded));
    elements.exportSelectionToggleButton.querySelector("span").textContent = state.selectionExpanded
      ? "Hide items"
      : "Choose items";
    elements.selectedExportScopeCount.textContent = String(getSelectedExportRows().length);
    if (visible) {
      renderExportSelectionList();
    }
  }

  function toggleExportSelectionPanel() {
    state.selectionExpanded = !state.selectionExpanded;
    updateExportSelectionPanel();
    if (state.selectionExpanded) {
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
    elements.exportSelectAllCheckbox.checked = rows.length > 0 && rows.every((row) => state.selectedIds.has(row.id));
    elements.exportSelectAllCheckbox.indeterminate = rows.some((row) => state.selectedIds.has(row.id)) && !elements.exportSelectAllCheckbox.checked;
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
    return rows.filter((row) => state.selectedIds.has(row.id));
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
    checkbox.checked = state.selectedIds.has(row.id);
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
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
  }

  function notifyExportSelectionChange() {
    onExportSelectionChange?.([...state.selectedIds]);
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
    const requestId = ++state.previewRequest;
    const format = getExportFormat();
    elements.packageExportPreview.value = "Preparing preview...";
    try {
      setBusy(true);
      const dataPackage = await onBuildPackage(getExportScope());
      if (requestId !== state.previewRequest) {
        return;
      }
      elements.packageExportPreview.value = serializeExport(dataPackage, format);
    } catch (error) {
      if (requestId === state.previewRequest) {
        elements.packageExportPreview.value = error?.message || "Failed to build export preview.";
      }
    } finally {
      if (requestId === state.previewRequest) {
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

  function setBusy(busy) {
    setWorkbenchBusy(busy);
    if (!busy) {
      updateExportScopeAvailability();
    }
  }

  function getExportScope() {
    return elements.exportScopeInputs.find((input) => input.checked)?.value || "current";
  }

  function getExportFormat() {
    return getFormat(elements.packageExportFormatInputs);
  }

  return { open };
}

function getElements(dialog) {
  const byId = (id) => dialog.querySelector(`#${id}`);
  return {
    selectedExportScope: byId("selectedExportScope"),
    currentExportScope: byId("currentExportScope"),
    currentExportScopeLabel: byId("currentExportScopeLabel"),
    allExportScope: byId("allExportScope"),
    allExportScopeLabel: byId("allExportScopeLabel"),
    exportScopeInputs: Array.from(dialog.querySelectorAll('input[name="exportScope"]')),
    packageExportFormatInputs: Array.from(dialog.querySelectorAll('input[name="packageExportFormat"]')),
    packageExportFormatSwitch: byId("packageExportFormatSwitch"),
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
    packageExportFeedback: byId("packageExportFeedback")
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

function serializeExport(dataPackage, format) {
  return format === "netscape"
    ? serializeNetscapeCookieFile(dataPackage)
    : JSON.stringify(dataPackage, null, 2);
}
