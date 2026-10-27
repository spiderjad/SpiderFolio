// Recarga de desarrollo (scripts/dev-watch.ts): leer un archivo no reinicia; cambiarlo sí.
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isIgnored, recordChange, snapshot } from "../scripts/dev-watch.ts";

describe("dev-watch", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spiderfolio-dev-watch-"));
    file = join(dir, "modulo.ts");
    writeFileSync(file, "export const a = 1;\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("no cuenta como cambio una actualización del último acceso (lo que hace NTFS al leer)", () => {
    // utimes redondea a milisegundos: se fija el mtime antes de la instantánea.
    const { atime, mtime } = statSync(file);
    utimesSync(file, atime, mtime);
    const known = snapshot(dir);
    utimesSync(file, new Date(Date.now() - 3 * 60 * 60 * 1000), mtime);
    expect(recordChange(known, file)).toBe(false);
  });

  it("cuenta como cambio una escritura, un archivo nuevo y uno borrado", () => {
    const known = snapshot(dir);
    writeFileSync(file, "export const a = 22;\n");
    expect(recordChange(known, file)).toBe(true);
    expect(recordChange(known, file)).toBe(false);

    const nuevo = join(dir, "nuevo.ts");
    writeFileSync(nuevo, "export {};\n");
    expect(recordChange(known, nuevo)).toBe(true);

    rmSync(nuevo);
    expect(recordChange(known, nuevo)).toBe(true);
  });

  it("detecta cambios de mtime aunque el tamaño sea el mismo", () => {
    const known = snapshot(dir);
    const { atime, mtime } = statSync(file);
    utimesSync(file, atime, new Date(mtime.getTime() + 5000));
    expect(recordChange(known, file)).toBe(true);
  });

  it("ignora node_modules", () => {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "x.js"), "");
    expect([...snapshot(dir).keys()]).toEqual([file]);
    expect(isIgnored(join(dir, "node_modules", "x.js"))).toBe(true);
  });
});
