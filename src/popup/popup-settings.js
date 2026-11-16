import { getLanguagePreference, onLanguageChanged, setUiLanguage, t } from "../shared/i18n.js";
import { saveUiPreference, UI_LANGUAGES } from "../shared/ui-preferences.js";

export function createSettingsController({ onOpen }) {
  const control = document.querySelector("#settingsControl");
  const button = document.querySelector("#settingsButton");
  const menu = document.querySelector("#settingsMenu");
  const language = document.querySelector("#languageSelect");
  const theme = document.querySelector("#themeToggle");
  const autoRefresh = document.querySelector("#autoRefreshToggle");
  const error = document.querySelector("#settingsError");
  const themeController = globalThis.cookieControllerTheme;
  let changingLanguage = false;
  let changingTheme = false;

  for (const option of UI_LANGUAGES) language.add(new Option(option.label, option.value));
  const sync = () => {
    language.value = getLanguagePreference();
    const dark = themeController.getPreference() === "dark";
    theme.setAttribute("aria-checked", String(dark));
    theme.setAttribute("aria-label", dark ? t("Light theme") : t("Dark theme"));
    theme.title = dark ? t("Light theme") : t("Dark theme");
  };
  sync();
  void themeController.ready.then(() => { sync(); theme.disabled = false; });
  onLanguageChanged(sync);
  themeController.onChanged(sync);

  function setOpen(open, focus = false) {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) { onOpen(); if (focus) language.focus(); }
  }

  button.addEventListener("click", () => setOpen(menu.hidden));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true, true); }
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      const first = language;
      const last = autoRefresh;
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        setOpen(false);
      }
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!control.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      setOpen(false);
      button.focus();
    }
  });

  language.addEventListener("change", async () => {
    if (changingLanguage) return;
    changingLanguage = true;
    language.disabled = true;
    error.hidden = true;
    try { await setUiLanguage(language.value); }
    catch (failure) { error.textContent = failure?.message || t("Could not save settings. Please try again."); error.hidden = false; }
    finally { changingLanguage = false; language.disabled = false; sync(); }
  });
  theme.addEventListener("click", async () => {
    if (changingTheme) return;
    changingTheme = true;
    theme.disabled = true;
    error.hidden = true;
    const scope = themeController.getScope();
    const previous = themeController.getPreference(scope);
    const next = previous === "dark" ? "light" : "dark";
    themeController.setPreference(next, scope);
    try { await saveUiPreference(themeController.getStorageKey(scope), next); }
    catch {
      themeController.setPreference(previous, scope);
      error.textContent = t("Could not save settings. Please try again.");
      error.hidden = false;
    } finally { changingTheme = false; theme.disabled = false; sync(); }
  });
  return { close: () => setOpen(false) };
}
