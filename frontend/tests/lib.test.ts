// Utilidades: redirección segura, bytes, fechas, acento por workspace y aviso de compatibilidad.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { applyAccent, clearAccent } from "@/lib/accent";
import {
  formatBytes,
  formatDay,
  formatLongDate,
  formatMonth,
  initials,
  safeNext,
} from "@/lib/utils";

describe("safeNext (open redirect, GHSA-wrjc-x8rr-h8h6)", () => {
  it.each(["/app", "/app/empresa?tab=1", "/app/empresa#x"])("acepta %s", (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "app",
    "/ap\np",
    "",
    null,
    undefined,
  ])("rechaza %j", (next) => {
    expect(safeNext(next)).toBe("/app");
  });
});

describe("formato", () => {
  it("bytes con 1 GB = 1024³", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
    expect(formatBytes(250 * 1024 ** 3)).toBe("250 GB");
  });

  it("iniciales", () => {
    expect(initials("Ana María Ruiz")).toBe("AR");
    expect(initials("ana")).toBe("A");
  });
});

describe("acento por workspace", () => {
  it("aplica las 5 variables con setProperty y cambia con el tema", () => {
    const root = document.createElement("div");
    applyAccent("#0F766E", false, root);
    const light = root.style.getPropertyValue("--primary");
    expect(light).not.toBe("");
    for (const name of [
      "--primary-foreground",
      "--primary-soft",
      "--primary-soft-foreground",
      "--ring",
    ]) {
      expect(root.style.getPropertyValue(name), name).not.toBe("");
    }
    applyAccent("#0F766E", true, root);
    expect(root.style.getPropertyValue("--primary")).not.toBe(light);
  });

  it("null o un valor inválido vuelven al color de la marca", () => {
    const root = document.createElement("div");
    applyAccent("#0f766e", false, root);
    applyAccent(null, false, root);
    expect(root.style.getPropertyValue("--primary")).toBe("");
    applyAccent("#0f766e", false, root);
    applyAccent("red;background:url(x)", false, root);
    expect(root.style.getPropertyValue("--primary")).toBe("");
    applyAccent("#0f766e", false, root);
    clearAccent(root);
    expect(root.getAttribute("style") ?? "").toBe("");
  });
});

describe("public/compat.js (10.10)", () => {
  const source = readFileSync(join(import.meta.dirname, "../public/compat.js"), "utf8");

  /** Corre compat.js en un sandbox con un documento nuevo y un CSS simulado. */
  function load(options: { supports: boolean; registerProperty: boolean; theme?: string }) {
    const doc = document.implementation.createHTMLDocument("SpiderFolio");
    doc.body.innerHTML = "<div id='root'></div>";
    const stored = new Map<string, string>();
    if (options.theme !== undefined) stored.set("spiderfolio-theme", options.theme);
    const sandbox: Record<string, unknown> = {
      document: doc,
      localStorage: { getItem: (key: string) => stored.get(key) ?? null },
      matchMedia: () => ({ matches: false }),
      CSS: {
        supports: () => options.supports,
        ...(options.registerProperty ? { registerProperty: () => undefined } : {}),
      },
    };
    sandbox.window = sandbox;
    runInNewContext(source, sandbox);
    return doc;
  }

  it("en un navegador compatible no toca la página", () => {
    const doc = load({ supports: true, registerProperty: true });
    expect(doc.documentElement.hasAttribute("data-unsupported")).toBe(false);
    expect(doc.getElementById("root")).not.toBeNull();
  });

  it.each([
    ["sin color-mix", { supports: false, registerProperty: true }],
    ["sin @property", { supports: true, registerProperty: false }],
  ])("%s: marca <html> y muestra el aviso con estilos propios", (_name, options) => {
    const doc = load(options);
    expect(doc.documentElement.hasAttribute("data-unsupported")).toBe(true);
    expect(doc.body.textContent).toContain("Tu navegador necesita una actualización");
    expect(doc.body.textContent).toContain("Safari");
    expect(doc.querySelector('link[href="/compat.css"]')).not.toBeNull();
    expect(doc.getElementById("root")).toBeNull();
  });

  it("aplica el tema oscuro guardado antes del primer pintado", () => {
    expect(
      load({
        supports: true,
        registerProperty: true,
        theme: "dark",
      }).documentElement.classList.contains("dark"),
    ).toBe(true);
    expect(
      load({
        supports: true,
        registerProperty: true,
        theme: "light",
      }).documentElement.classList.contains("dark"),
    ).toBe(false);
  });
});

describe("fechas del servidor", () => {
  it("lee los días en UTC, sin correrlos por la zona horaria", () => {
    expect(formatDay("2026-10-01")).toMatch(/^1 oct/);
    expect(formatDay("2026-12-31T00:00:00.000Z")).toMatch(/^31 dic/);
  });

  it("formatea meses y fechas largas", () => {
    expect(formatMonth("2026-01")).toMatch(/^ene/);
    expect(formatLongDate("2026-10-19T00:00:00.000Z")).toBe("19 de octubre de 2026");
  });
});
