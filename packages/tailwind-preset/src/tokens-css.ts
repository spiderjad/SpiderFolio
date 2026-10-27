// Genera tokens.css a partir de tokens.ts (única fuente de los colores). Lo escribe
// scripts/build-tokens-css.ts y un test falla si el archivo commiteado quedó desactualizado.
import { colorTokenNames, darkTokens, lightTokens, radius, type ThemeTokens } from "./tokens.ts";

const HEADER = `/*
 * Generado a partir de src/tokens.ts. No editar a mano: cambiá src/tokens.ts
 * y corré npm run tokens:css -w @spiderfolio/tailwind-preset.
 */`;

const block = (selector: string, lines: readonly string[]) =>
  `${selector} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;

const variables = (tokens: ThemeTokens) =>
  colorTokenNames.map((name) => `--${name}: ${tokens[name]};`);

export function buildTokensCss(): string {
  return [
    HEADER,
    block(":root", [...variables(lightTokens), `--radius: ${radius};`]),
    block(".dark", variables(darkTokens)),
    // --color-*: initial borra la paleta de Tailwind (bg-purple-600 no existe).
    // inline: la clase usa la variable del elemento, así .dark y el acento por workspace
    // (setProperty sobre <html>) cambian los colores sin recompilar.
    block("@theme inline", [
      "--color-*: initial;",
      ...colorTokenNames.map((name) => `--color-${name}: hsl(var(--${name}));`),
    ]),
  ]
    .join("\n\n")
    .concat("\n");
}
