// Removing an uploaded plugin from the install folder (plugins/install.ts): only what was uploaded,
// never a plugin built into the image, and nothing half-deleted.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstallError, isUploaded, uninstallPackage } from "../src/plugins/install.ts";
import type { InstalledPlugin } from "../src/plugins/loader.ts";

let root = "";
let installDir = "";
let builtInDir = "";

const plugin = (id: string, dir: string, version = "1.0.0"): InstalledPlugin => {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "package.json"), JSON.stringify({ version }));
  return {
    manifest: { id } as InstalledPlugin["manifest"],
    dir: join(dir, id),
    version,
    backend: null,
    migrations: [],
    frontendBundle: null,
  };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sf-install-"));
  installDir = join(root, "data");
  builtInDir = join(root, "image");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("quitar un plugin subido", () => {
  it("borra su carpeta del todo y sin dejar restos", () => {
    const uploaded = plugin("claude-connector", installDir, "1.0.0");
    expect(isUploaded(installDir, uploaded)).toBe(true);
    expect(uninstallPackage({ installDir, id: "claude-connector", loaded: [uploaded] })).toEqual({
      version: "1.0.0",
    });
    expect(existsSync(join(installDir, "claude-connector"))).toBe(false);
    expect(readdirSync(installDir)).toEqual([]);
  });

  it("un plugin incluido en la imagen no se quita desde la app", () => {
    const builtIn = plugin("audit-rooms", builtInDir);
    expect(isUploaded(installDir, builtIn)).toBe(false);
    expect(() => uninstallPackage({ installDir, id: "audit-rooms", loaded: [builtIn] })).toThrow(
      InstallError,
    );
    expect(existsSync(join(builtInDir, "audit-rooms"))).toBe(true);
  });

  it("uno que no está en la carpeta de subidos responde null", () => {
    mkdirSync(installDir, { recursive: true });
    expect(uninstallPackage({ installDir, id: "nada", loaded: [] })).toBeNull();
  });

  it("un id con ruta nunca sale de la carpeta", () => {
    plugin("otro", root);
    expect(uninstallPackage({ installDir, id: "../otro", loaded: [] })).toBeNull();
    expect(existsSync(join(root, "otro"))).toBe(true);
  });
});
