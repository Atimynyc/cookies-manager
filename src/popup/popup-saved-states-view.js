import { parseVariableCaptures } from "../shared/site-profiles.js";
import { cancelDialogFromBackdrop } from "./popup-dialogs.js";

export function createSavedStatesView({
  dialog,
  getContext,
  setBusy,
  onLoadProfiles,
  onCreateProfile,
  onRenameProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onExportProfile,
  onPrepareProfile
}) {
  const elements = getElements(dialog);
  const state = {
    profiles: [],
    mode: "list",
    applyingProfile: null
  };

  bindEvents();

  async function open() {
    elements.profileScopeSelect.querySelector('option[value="selected"]').disabled = getContext().selectedCount === 0;
    state.mode = "list";
    try {
      state.profiles = await onLoadProfiles();
    } catch {
      state.profiles = [];
    }
    renderProfiles();
  }

  function bindEvents() {
    elements.profileHelpButton.addEventListener("click", showProfileHelp);
    elements.profileHelpCloseButton.addEventListener("click", () => elements.profileHelpDialog.close("close"));
    elements.profileHelpDialog.addEventListener("click", cancelDialogFromBackdrop);
    elements.newProfileButton.addEventListener("click", showProfileForm);
    elements.cancelProfileButton.addEventListener("click", hideProfileForm);
    elements.profileForm.addEventListener("submit", createProfile);
    elements.cancelProfileApplyButton.addEventListener("click", hideProfileApply);
    elements.previewProfileButton.addEventListener("click", previewProfile);
  }

  function showProfileForm() {
    state.applyingProfile = null;
    elements.profileForm.reset();
    elements.profileScopeSelect.value = getContext().selectedCount > 0 ? "selected" : "current";
    setFeedback(elements.profileFormError);
    setMode("create");
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
    setMode("list");
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
      setFeedback(elements.profileFormError, error?.message || "Failed to save state.");
    } finally {
      setBusy(false);
    }
  }

  function renderProfiles() {
    elements.profileCount.textContent = `${state.profiles.length} saved`;
    elements.profileList.replaceChildren(...state.profiles.map(createProfileItem));
    setMode(state.mode);
  }

  function setMode(mode) {
    state.mode = mode;
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
    setMode("apply");
    elements.profileVariableInputs.querySelector("input")?.focus();
  }

  function hideProfileApply() {
    state.applyingProfile = null;
    setMode("list");
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
      await onPrepareProfile(profile, inputs, elements.profileMappingToggle.checked);
      hideProfileApply();
    } catch (error) {
      setFeedback(elements.profileApplyError, error?.message || "Failed to prepare saved state.");
    } finally {
      setBusy(false);
    }
  }

  return { open };
}

function getElements(dialog) {
  const byId = (id) => dialog.querySelector(`#${id}`);
  return {
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
