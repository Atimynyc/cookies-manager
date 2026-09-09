import { classifyValueType } from "../shared/value-tools.js";

export function renderDataTable({
  tableBody,
  rows,
  selectedId,
  selectedIds,
  favoriteIds,
  onSelect,
  onToggle
}) {
  const fragment = document.createDocumentFragment();

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.dataset.itemId = row.id;
    tr.dataset.cookieId = row.id;
    tr.className = [
      row.id === selectedId ? "is-selected" : "",
      selectedIds.has(row.id) ? "is-checked" : ""
    ].filter(Boolean).join(" ");
    tr.addEventListener("click", () => onSelect(row.id, tr));
    tr.addEventListener("keydown", (event) => {
      if (event.target !== tr) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(row.id, tr);
      }
    });

    tr.append(
      createSelectCell(row, selectedIds, onToggle, tr),
      createNameCell(row, favoriteIds),
      createValueCell(row.value),
      createCell(row.domain, row.domain),
      createCell(row.path, row.path),
      createCell(row.expires, row.expires),
      createFlagCell(row),
      createCell(`${row.size} B`, `${row.size} bytes`)
    );
    fragment.append(tr);
  }

  tableBody.replaceChildren(fragment);
}

function createValueCell(value) {
  const text = String(value ?? "");
  const type = classifyValueType(text);
  const td = document.createElement("td");
  const content = document.createElement("span");
  const valueText = document.createElement("span");

  td.className = "value-cell";
  td.title = text;
  content.className = "value-cell-content";
  valueText.className = "value-cell-text";
  valueText.textContent = text;

  if (type) {
    const label = type === "jwt" ? "JWT value" : "JSON value";
    const indicator = document.createElement("span");
    indicator.className = `value-type-indicator value-type-${type}`;
    indicator.textContent = type === "jwt" ? "JWT" : "JSON";
    indicator.title = label;
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", label);
    content.append(indicator);
  }

  content.append(valueText);
  td.append(content);
  return td;
}

function createNameCell(row, favoriteIds) {
  const td = document.createElement("td");
  const favorite = favoriteIds.has(row.id);
  const content = document.createElement("span");
  const name = document.createElement("span");

  td.className = "name-cell";
  td.title = row.name || "";
  content.className = "name-cell-content";
  name.className = "name-cell-text";
  name.textContent = row.name || "";
  if (favorite) {
    const indicator = document.createElement("span");
    const icon = document.createElement("img");
    indicator.className = "favorite-indicator";
    indicator.title = "Favorite";
    indicator.setAttribute("aria-label", "Favorite");
    icon.className = "favorite-brand-icon";
    icon.src = "../../assets/icon-16.png";
    icon.alt = "";
    icon.width = 20;
    icon.height = 20;
    indicator.append(icon);
    content.append(indicator);
  }
  content.append(name);
  td.append(content);
  return td;
}

function createSelectCell(row, selectedIds, onToggle, rowElement) {
  const td = document.createElement("td");
  const checkbox = document.createElement("input");
  td.className = "select-cell";
  checkbox.type = "checkbox";
  checkbox.checked = selectedIds.has(row.id);
  checkbox.setAttribute("aria-label", `Select ${row.name}`);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => onToggle(row.id, checkbox.checked, rowElement));
  td.append(checkbox);
  return td;
}

function createCell(text, title = text, className = "") {
  const td = document.createElement("td");
  td.textContent = text || "";
  td.title = title || "";
  td.className = className;
  return td;
}

function createFlagCell(row) {
  const td = document.createElement("td");
  const flags = [
    row.httpOnly ? ["Http", "HttpOnly"] : null,
    row.secure ? ["Sec", "Secure"] : null,
    row.partitioned ? ["Part", "Partitioned"] : null
  ].filter(Boolean);

  if (flags.length === 0) {
    td.textContent = "-";
    return td;
  }

  const stack = document.createElement("span");
  stack.className = "flag-stack";
  for (const [label, title] of flags) {
    const badge = document.createElement("span");
    badge.className = "flag";
    badge.textContent = label;
    badge.title = title;
    stack.append(badge);
  }
  td.append(stack);
  return td;
}
