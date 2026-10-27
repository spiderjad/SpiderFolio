import { describe, expect, it } from "vitest";
import { parseImportPath } from "../src/modules/imports/import-paths.ts";

describe("parseImportPath", () => {
  it("acepta rutas relativas con carpetas", () => {
    expect(parseImportPath("Calidad/Procedimientos/PR-01.pdf", 10)).toEqual({
      ok: true,
      dirs: ["Calidad", "Procedimientos"],
      name: "PR-01.pdf",
    });
    expect(parseImportPath("suelto.txt", 10)).toEqual({ ok: true, dirs: [], name: "suelto.txt" });
  });

  it("normaliza espacios y Unicode de cada nombre", () => {
    expect(parseImportPath("  Café  /a.txt", 5)).toMatchObject({ ok: true, dirs: ["Café"] });
    expect(parseImportPath("Cafe\u0301/a.txt", 5)).toMatchObject({ ok: true, dirs: ["Café"] });
  });

  it("rechaza ..", () => {
    for (const path of ["../a.txt", "a/../b.txt", "a/..", ".."]) {
      expect(parseImportPath(path, 5), path).toEqual({ ok: false, reason: "invalidPath" });
    }
  });

  it("rechaza rutas absolutas, de unidad, con barras invertidas o vacías", () => {
    for (const path of [
      "/etc/passwd",
      "C:/Windows/a.txt",
      "c:a.txt",
      "a\\b.txt",
      "",
      "a//b.txt",
      "a/b/",
    ]) {
      expect(parseImportPath(path, 5), path).toEqual({ ok: false, reason: "invalidPath" });
    }
  });

  it("rechaza nombres con caracteres de control o demasiado largos", () => {
    expect(parseImportPath("a\u0000b.txt", 5).ok).toBe(false);
    expect(parseImportPath(`${"x".repeat(256)}.txt`, 5).ok).toBe(false);
  });

  it("limita la profundidad", () => {
    expect(parseImportPath("a/b/c/d.txt", 3).ok).toBe(true);
    expect(parseImportPath("a/b/c/d/e.txt", 3)).toEqual({ ok: false, reason: "tooDeep" });
  });

  it("omite los archivos que agrega el sistema operativo", () => {
    for (const path of [
      ".DS_Store",
      "a/.DS_Store",
      "a/Thumbs.db",
      "desktop.ini",
      "__MACOSX/a/._x.txt",
    ]) {
      expect(parseImportPath(path, 5), path).toEqual({ ok: false, reason: "systemFile" });
    }
  });
});
