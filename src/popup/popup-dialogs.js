export function createDialogController(elements) {
  function requestConfirmation({
    title,
    message,
    detail = "",
    confirmLabel = "Delete",
    danger = true,
    selection = null
  }) {
    const previouslyFocused = document.activeElement;
    elements.confirmDialogTitle.textContent = title;
    elements.confirmDialogMessage.textContent = message;
    elements.confirmDialogDetail.textContent = detail;
    elements.confirmDialogDetail.hidden = !detail;
    elements.confirmDialogDeleteButton.textContent = confirmLabel;
    elements.confirmDialogDeleteButton.classList.toggle("confirm-dialog-delete", danger);
    elements.confirmDialogDeleteButton.classList.toggle("primary-button", !danger);
    renderSelectionReview(elements.confirmDialog, selection);
    elements.confirmDialog.returnValue = "cancel";

    return new Promise((resolve) => {
      elements.confirmDialog.addEventListener("close", () => {
        restoreFocus(previouslyFocused);
        resolve(elements.confirmDialog.returnValue === "confirm");
      }, { once: true });
      elements.confirmDialog.showModal();
    });
  }

  function requestTextInput({
    title,
    fieldLabel,
    initialValue = "",
    placeholder = "",
    submitLabel,
    selectValue = false,
    selection = null,
    validate = (value) => value
  }) {
    const previouslyFocused = document.activeElement;
    elements.textInputDialogTitle.textContent = title;
    elements.textInputDialogFieldLabel.textContent = fieldLabel;
    elements.textInputDialogInput.value = initialValue;
    elements.textInputDialogInput.placeholder = placeholder;
    elements.textInputDialogError.textContent = "";
    elements.textInputDialogError.hidden = true;
    elements.textInputDialogSubmitButton.textContent = submitLabel;
    renderSelectionReview(elements.textInputDialog, selection);
    elements.textInputDialog.returnValue = "cancel";

    return new Promise((resolve) => {
      let result = null;
      const handleInput = () => {
        elements.textInputDialogError.hidden = true;
      };
      const handleSubmit = (event) => {
        event.preventDefault();
        try {
          result = validate(elements.textInputDialogInput.value);
          elements.textInputDialog.close("submit");
        } catch (error) {
          elements.textInputDialogError.textContent = error?.message || "Enter a valid value.";
          elements.textInputDialogError.hidden = false;
          elements.textInputDialogInput.focus();
        }
      };
      const handleClose = () => {
        elements.textInputDialogForm.removeEventListener("submit", handleSubmit);
        elements.textInputDialogInput.removeEventListener("input", handleInput);
        restoreFocus(previouslyFocused);
        resolve(elements.textInputDialog.returnValue === "submit" ? result : null);
      };

      elements.textInputDialogForm.addEventListener("submit", handleSubmit);
      elements.textInputDialogInput.addEventListener("input", handleInput);
      elements.textInputDialog.addEventListener("close", handleClose, { once: true });
      elements.textInputDialog.showModal();
      if (selectValue) {
        elements.textInputDialogInput.select();
      } else {
        elements.textInputDialogInput.focus();
      }
    });
  }

  return { requestConfirmation, requestTextInput };
}

function renderSelectionReview(dialog, selection) {
  const review = dialog.querySelector("[data-selection-review]");
  if (!review) {
    return;
  }

  const rows = Array.isArray(selection?.rows) ? selection.rows : [];
  review.hidden = rows.length === 0;
  review.open = rows.length > 0;
  dialog.classList.toggle("has-selection-review", rows.length > 0);
  if (rows.length === 0) {
    review.querySelector("[data-selection-review-list]").replaceChildren();
    return;
  }

  const label = selection?.label || "items";
  review.querySelector("[data-selection-review-label]").textContent = `Selected ${label}`;
  review.querySelector("[data-selection-review-count]").textContent = String(rows.length);
  review.querySelector("[data-selection-review-list]").replaceChildren(
    ...rows.map(createSelectionReviewItem)
  );
}

function createSelectionReviewItem(row) {
  const item = document.createElement("li");
  const name = document.createElement("strong");
  const location = document.createElement("span");
  name.textContent = row.name || "(unnamed)";
  name.title = row.name || "(unnamed)";
  location.textContent = row.location || "";
  location.title = row.location || "";
  item.append(name, location);
  return item;
}

export function cancelDialogFromBackdrop(event) {
  const dialog = event.currentTarget;
  if (!(dialog instanceof HTMLDialogElement) || event.target !== dialog) {
    return;
  }

  const rect = dialog.getBoundingClientRect();
  const isOutside = event.clientX < rect.left || event.clientX > rect.right ||
    event.clientY < rect.top || event.clientY > rect.bottom;
  if (isOutside) {
    dialog.close("cancel");
  }
}

function restoreFocus(element) {
  if (element instanceof HTMLElement) {
    element.focus();
  }
}
