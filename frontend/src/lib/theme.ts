// Tema claro/oscuro por clase .dark en <html> (CLAUDE.md, sección 10.2). La preferencia se
// guarda en localStorage (única excepción a la regla de no usarlo: no es un dato sensible);
// public/compat.js la aplica antes del primer pintado con la misma clave.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "spiderfolio-theme";
const THEME_EVENT = "spiderfolio:theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

function apply(preference: ThemePreference): void {
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Sin almacenamiento (modo privado): el tema vale para esta pestaña.
  }
  apply(preference);
}

/** Sigue los cambios del sistema mientras la preferencia sea "system". */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getThemePreference() === "system") apply("system");
  };
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

/** Avisa cada vez que cambia el tema efectivo (para volver a aplicar el acento). */
export function onThemeChange(listener: () => void): () => void {
  window.addEventListener(THEME_EVENT, listener);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
  };
}
