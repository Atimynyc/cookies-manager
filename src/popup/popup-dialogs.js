export function createDialogController(elements) {
  function requestConfirmation({ title, message, detail = "" }) {
    const previouslyFocused = document.activeElement;
    elements.confirmDialogTitle.textContent = title;
    elements.confirmDialogMessage.textContent = message;
    elements.confirmDialogDetail.textContent = detail;
    elements.confirmDialogDetail.hidden = !detail;
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
