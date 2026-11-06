// Generates tokens.css. Colors come from spider-ui (--sp-*, the only source of the design
// system): each SpiderFolio token is an alias of a spider-ui token, so the existing classes
// (bg-primary, text-muted-foreground…) keep working. spider-ui switches light/dark itself
// (data-theme on <html>), so there is no .dark block. The values in tokens.ts are only used for
// the per-workspace accent math (contrast against the background).
// scripts/build-tokens-css.ts writes it.
import { colorTokenNames, type ColorToken } from "./tokens.ts";

const HEADER = `/*
 * Generado por src/tokens-css.ts. No editar a mano: cambiá src/tokens-css.ts
 * y corré npm run tokens:css -w @spiderfolio/tailwind-preset.
 * Los valores salen de spider-ui (--sp-*).
 */`;

/** SpiderFolio token → spider-ui token. Monochrome panel: primary is the black (inverse) button. */
export const spiderUiAliases: Readonly<Record<ColorToken, string>> = {
  background: "var(--sp-bg)",
  surface: "var(--sp-bg-subtle)",
  foreground: "var(--sp-text-primary)",
  muted: "var(--sp-bg-muted)",
  "muted-foreground": "var(--sp-text-secondary)",
  border: "var(--sp-border)",
  input: "var(--sp-border)",
  ring: "var(--sp-focus)",
  primary: "var(--sp-inverse)",
  "primary-foreground": "var(--sp-on-inverse)",
  "primary-soft": "var(--sp-bg-muted)",
  "primary-soft-foreground": "var(--sp-text-primary)",
  success: "var(--sp-success)",
  "success-foreground": "var(--sp-bg)",
  "success-soft": "var(--sp-success-light)",
  "success-soft-foreground": "var(--sp-success)",
  warning: "var(--sp-warning)",
  "warning-foreground": "var(--sp-bg)",
  "warning-soft": "var(--sp-warning-light)",
  "warning-soft-foreground": "var(--sp-warning)",
  danger: "var(--sp-danger)",
  "danger-foreground": "var(--sp-bg)",
  "danger-soft": "var(--sp-danger-light)",
  "danger-soft-foreground": "var(--sp-danger-text)",
};

const block = (selector: string, lines: readonly string[]) =>
  `${selector} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;

export function buildTokensCss(): string {
  return [
    HEADER,
    block(":root", [
      ...colorTokenNames.map((name) => `--${name}: ${spiderUiAliases[name]};`),
      "--radius: var(--sp-radius);",
    ]),
    // --color-*: initial removes Tailwind's palette (bg-purple-600 does not exist).
    // inline: the class reads the element's variable, so the theme and the per-workspace
    // accent (setProperty on <html>) change colors without recompiling.
    block("@theme inline", [
      "--color-*: initial;",
      ...colorTokenNames.map((name) => `--color-${name}: var(--${name});`),
    ]),
  ]
    .join("\n\n")
    .concat("\n");
}
