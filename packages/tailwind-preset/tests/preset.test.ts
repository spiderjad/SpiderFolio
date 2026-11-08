// The preset compiled with Tailwind 4, as @tailwindcss/vite does in the app and the web. Colors,
// fonts, radii and shadows come from spider-ui: every SpiderFolio token is an alias of a --sp-* var.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTokensCss, spiderUiAliases } from "../src/tokens-css.ts";
import { colorTokenNames } from "../src/tokens.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("tokens.css", () => {
  it("está al día con src/tokens.ts (si falla: npm run tokens:css -w @spiderfolio/tailwind-preset)", () => {
    const committed = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(buildTokensCss());
  });

  it("cada token es un alias de una variable de spider-ui (--sp-*), sin valores propios", () => {
    const css = buildTokensCss();
    for (const name of colorTokenNames) {
      expect(spiderUiAliases[name]).toMatch(/^var\(--sp-[a-z-]+\)$/u);
      expect(css).toContain(`--${name}: ${spiderUiAliases[name]};`);
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
    expect(css).toContain("--radius: var(--sp-radius);");
    // No color literals: the values live in spider-ui (it switches light and dark itself).
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|hsl\(\d|rgb\(/iu);
    expect(css).not.toContain(".dark {");
  });

  it("las variables a las que apunta existen en spider-ui", () => {
    const spiderUi = readFileSync(
      fileURLToPath(import.meta.resolve("spider-ui/tokens.css")),
      "utf8",
    );
    const used = new Set(
      [...buildTokensCss().matchAll(/var\((--sp-[a-z-]+)\)/gu)].map((match) => match[1]),
    );
    for (const name of used) expect(spiderUi, name).toContain(`${String(name)}:`);
  });
});

describe("preset.css compilado", () => {
  let build: (candidates: string[]) => string;

  beforeAll(async () => {
    const compiler = await compile('@import "tailwindcss";\n@import "./preset.css";', {
      base: root,
      onDependency: () => undefined,
    });
    build = (candidates) => compiler.build(candidates);
  });

  const rule = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return start === -1 ? null : css.slice(start, css.indexOf("}", start) + 1);
  };

  it("genera las clases de cada token, con opacidad", () => {
    const candidates = colorTokenNames.map((name) => `bg-${name}`);
    const css = build([...candidates, "bg-primary/50", "text-success-soft-foreground"]);
    for (const name of colorTokenNames) {
      expect(rule(css, `.bg-${name}`), name).toContain(`var(--${name})`);
    }
    expect(rule(css, String.raw`.bg-primary\/50`)).toContain("var(--primary) 50%");
    expect(rule(css, ".text-success-soft-foreground")).toContain("--success-soft-foreground");
  });

  it("no existe la paleta suelta de Tailwind", () => {
    const css = build([
      "bg-purple-600",
      "text-gray-500",
      "bg-white",
      "text-black",
      "border-red-500",
    ]);
    for (const selector of [".bg-purple-600", ".text-gray-500", ".bg-white", ".text-black"]) {
      expect(css).not.toContain(selector);
    }
    expect(css).not.toMatch(/--color-(red|gray|purple|white|black)/);
  });

  it("mantiene transparent y currentColor", () => {
    const css = build(["bg-transparent", "text-current"]);
    expect(rule(css, ".bg-transparent")).not.toBeNull();
    expect(rule(css, ".text-current")).not.toBeNull();
  });

  it("dark: funciona por clase .dark (no por la preferencia del sistema)", () => {
    const css = build(["dark:bg-surface"]);
    expect(css).toContain(String.raw`.dark\:bg-surface:where(.dark, .dark *)`);
    expect(rule(css, String.raw`.dark\:bg-surface:where(.dark, .dark *)`)).toContain(
      "var(--surface)",
    );
  });

  it("prose usa los tokens, 17 px e interlineado 1.75, por encima del tema del plugin", () => {
    const css = build(["prose"]);
    const plugin = css.indexOf("font-size: 1rem");
    const ours = css.indexOf("font-size: 1.0625rem");
    expect(ours).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(plugin);
    expect(css).toContain("--tw-prose-body: var(--foreground);");
    expect(css).toContain("--tw-prose-links: var(--primary);");
    expect(css).toContain("--tw-prose-pre-bg: var(--muted);");
  });

  it("incluye las animaciones de tw-animate-css", () => {
    const css = build(["animate-in", "fade-in"]);
    expect(rule(css, ".animate-in")).not.toBeNull();
  });

  it("fuentes, radios y sombras de spider-ui", () => {
    const css = build([
      "font-sans",
      "font-mono",
      "rounded-lg",
      "rounded-xl",
      "shadow-card",
      "shadow-pop",
    ]);
    expect(rule(css, ".font-sans")).toContain("var(--sp-font)");
    expect(rule(css, ".font-mono")).toContain("var(--sp-font-mono)");
    // No display font: titles are Inter, like spider-ui (decision 2026-11-08).
    expect(css).not.toContain("Instrument Serif");
    expect(rule(css, ".rounded-lg")).toContain("var(--sp-radius)");
    expect(rule(css, ".rounded-xl")).toContain("var(--sp-radius-lg)");
    expect(rule(css, ".shadow-card")).toContain("var(--sp-shadow)");
    expect(rule(css, ".shadow-pop")).toContain("var(--sp-shadow-md)");
    // spider-ui's own tokens come with the preset.
    expect(css).toContain("--sp-primary:");
  });

  it("estilos base: bordes, cuerpo y movimiento reducido", () => {
    const css = build([]);
    expect(css).toContain("border-color: var(--border);");
    expect(css).toContain("background-color: var(--background);");
    expect(css).toContain("--motion-duration-fast: 150ms;");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
