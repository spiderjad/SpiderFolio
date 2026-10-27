// El preset compilado con Tailwind 4, igual que lo harán @tailwindcss/vite en la app y la web.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTokensCss } from "../src/tokens-css.ts";
import { colorTokenNames, darkTokens, lightTokens } from "../src/tokens.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("tokens.css", () => {
  it("está al día con src/tokens.ts (si falla: npm run tokens:css -w @spiderfolio/tailwind-preset)", () => {
    const committed = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(buildTokensCss());
  });

  it("define cada token en :root y en .dark", () => {
    const css = buildTokensCss();
    for (const name of colorTokenNames) {
      expect(css).toContain(`--${name}: ${lightTokens[name]};`);
      expect(css).toContain(`--${name}: ${darkTokens[name]};`);
      expect(css).toContain(`--color-${name}: hsl(var(--${name}));`);
    }
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
      expect(rule(css, `.bg-${name}`), name).toContain(`hsl(var(--${name}))`);
    }
    expect(rule(css, String.raw`.bg-primary\/50`)).toContain("50%");
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

  it("dark: funciona por clase .dark", () => {
    const css = build(["dark:bg-surface"]);
    expect(css).toContain(String.raw`.dark\:bg-surface:where(.dark, .dark *)`);
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("prose usa los tokens, 17 px e interlineado 1.75, por encima del tema del plugin", () => {
    const css = build(["prose"]);
    const plugin = css.indexOf("font-size: 1rem");
    const ours = css.indexOf("font-size: 1.0625rem");
    expect(ours).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(plugin);
    expect(css).toContain("--tw-prose-body: hsl(var(--foreground));");
    expect(css).toContain("--tw-prose-links: hsl(var(--primary));");
  });

  it("incluye las animaciones de tw-animate-css", () => {
    const css = build(["animate-in", "fade-in"]);
    expect(rule(css, ".animate-in")).not.toBeNull();
  });

  it("fuentes, radios y sombras de la marca", () => {
    const css = build(["font-sans", "font-display", "font-mono", "rounded-lg", "shadow-card"]);
    expect(css).toContain('"Inter Variable"');
    expect(css).toContain('"Instrument Serif"');
    expect(css).toContain('"JetBrains Mono Variable"');
    expect(rule(css, ".rounded-lg")).toContain("var(--radius)");
    expect(rule(css, ".shadow-card")).not.toBeNull();
    expect(css).toContain("--radius: 0.75rem;");
  });

  it("estilos base: bordes, cuerpo y movimiento reducido", () => {
    const css = build([]);
    expect(css).toContain("border-color: hsl(var(--border));");
    expect(css).toContain("background-color: hsl(var(--background));");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
