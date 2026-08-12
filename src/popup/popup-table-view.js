export function renderDataTable({ tableBody, rows, selectedId, selectedIds, onSelect, onToggle }) {
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
    tr.addEventListener("click", () => onSelect(row.id));
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(row.id);
      }
    });

    tr.append(
      createSelectCell(row, selectedIds, onToggle),
      createCell(row.name, row.name),
      createCell(row.value, row.value, "value-cell"),
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

function createSelectCell(row, selectedIds, onToggle) {
  const td = document.createElement("td");
  const checkbox = document.createElement("input");
  td.className = "select-cell";
  checkbox.type = "checkbox";
  checkbox.checked = selectedIds.has(row.id);
  checkbox.setAttribute("aria-label", `Select ${row.name}`);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => onToggle(row.id, checkbox.checked));
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
