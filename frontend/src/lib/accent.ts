// Acento por workspace (CLAUDE.md, sección 10.2): sobrescribe las variables del primario con
// document.documentElement.style.setProperty (CSSOM, compatible con la CSP; nunca un <style>
// en línea). Valores distintos para claro y oscuro: se vuelven a aplicar al cambiar el tema.
import { accentTokens, normalizeHex } from "@spiderfolio/tailwind-preset/accent";

const ACCENT_VARIABLES = [
  "--primary",
  "--primary-foreground",
  "--primary-soft",
  "--primary-soft-foreground",
  "--ring",
] as const;

export function clearAccent(root: HTMLElement = document.documentElement): void {
  for (const name of ACCENT_VARIABLES) root.style.removeProperty(name);
}

/** null (o un valor inválido) = color de la marca del preset. */
export function applyAccent(
  accentColor: string | null,
  dark: boolean,
  root: HTMLElement = document.documentElement,
): void {
  const hex = accentColor === null ? null : normalizeHex(accentColor);
  if (hex === null) {
    clearAccent(root);
    return;
  }
  const tokens = accentTokens(hex);
  for (const [name, value] of Object.entries(dark ? tokens.dark : tokens.light)) {
    root.style.setProperty(name, value);
  }
}
