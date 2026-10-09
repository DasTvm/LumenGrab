/** Theme preference: follow the system or force light/dark. Stored in localStorage, which every app window shares. */

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "lumengrab.theme";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** The `data-theme` value that forces a theme, or `null` to follow the system (tokens.css). */
export function themeAttribute(pref: ThemePreference): "light" | "dark" | null {
  return pref === "system" ? null : pref;
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system"; // storage blocked: follow the system
  }
}

export function applyTheme(pref: ThemePreference): void {
  const attr = themeAttribute(pref);
  const root = document.documentElement;
  if (attr) root.dataset["theme"] = attr;
  else delete root.dataset["theme"];
}

export function saveThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Not persisted, but the change still applies to this window.
  }
  applyTheme(pref);
}

/** Apply the stored preference now and follow changes made in other windows. */
export function initTheme(): void {
  applyTheme(readThemePreference());
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_STORAGE_KEY) applyTheme(parseThemePreference(e.newValue));
  });
}
