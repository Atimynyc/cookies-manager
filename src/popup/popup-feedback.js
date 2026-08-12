const COPY_FEEDBACK_DURATION = 2000;
const STATUS_EXIT_DURATION = 120;
const STATUS_DURATIONS = {
  success: 2000,
  info: 3000,
  warning: 5000,
  error: 0
};

export function createStatusController({ statusBar, statusMessage, closeStatusButton }) {
  let statusTimerId = 0;
  let statusHideTimerId = 0;

  function showStatus(message, type = "info") {
    clearTimers();
    const normalizedType = Object.hasOwn(STATUS_DURATIONS, type) ? type : "info";
    const duration = STATUS_DURATIONS[normalizedType];

    statusBar.hidden = false;
    statusMessage.setAttribute("role", normalizedType === "error" ? "alert" : "status");
    statusMessage.setAttribute("aria-live", normalizedType === "error" ? "assertive" : "polite");
    statusMessage.textContent = message;
    closeStatusButton.hidden = duration > 0;
    statusBar.className = `status-bar is-${normalizedType}`;

    if (duration > 0) {
      statusTimerId = window.setTimeout(clearStatus, duration);
    }
  }

  function clearStatus() {
    clearTimers();
    if (statusBar.hidden) {
      resetStatusElement();
      return;
    }

    closeStatusButton.hidden = true;
    statusBar.classList.add("is-leaving");
    const exitDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : STATUS_EXIT_DURATION;
    statusHideTimerId = window.setTimeout(resetStatusElement, exitDuration);
  }

  function clearTimers() {
    window.clearTimeout(statusTimerId);
    window.clearTimeout(statusHideTimerId);
    statusTimerId = 0;
    statusHideTimerId = 0;
  }

  function resetStatusElement() {
    statusHideTimerId = 0;
    statusBar.hidden = true;
    statusMessage.textContent = "";
    statusBar.className = "status-bar";
  }

  return { showStatus, clearStatus };
}

export function createClipboardFeedback(copyAnnouncement) {
  const feedbackStates = new WeakMap();

  function showCopyFeedback(button) {
    const existingState = feedbackStates.get(button);
    if (existingState) {
      window.clearTimeout(existingState.timerId);
    }

    const originalState = existingState?.originalState || {
      ariaLabel: button.getAttribute("aria-label"),
      tooltip: button.hasAttribute("data-tooltip") ? button.dataset.tooltip : null
    };

    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Copied");
    if (button.hasAttribute("data-tooltip")) {
      button.dataset.tooltip = "Copied";
    }

    copyAnnouncement.textContent = "";
    window.requestAnimationFrame(() => {
      copyAnnouncement.textContent = "Copied to clipboard.";
    });

    const timerId = window.setTimeout(() => resetCopyFeedback(button), COPY_FEEDBACK_DURATION);
    feedbackStates.set(button, { originalState, timerId });
  }

  function resetCopyFeedback(button) {
    const feedbackState = feedbackStates.get(button);
    if (!feedbackState) {
      return;
    }

    window.clearTimeout(feedbackState.timerId);
    button.classList.remove("is-copied");
    restoreAttribute(button, "aria-label", feedbackState.originalState.ariaLabel);
    if (feedbackState.originalState.tooltip === null) {
      button.removeAttribute("data-tooltip");
    } else {
      button.dataset.tooltip = feedbackState.originalState.tooltip;
    }
    feedbackStates.delete(button);
  }

  return { showCopyFeedback, resetCopyFeedback };
}

export async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard is unavailable.");
  }
}

function restoreAttribute(element, name, value) {
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}
