// Installs a verified plugin package (package.ts) into the plugins folder the app can write to: the
// plugins volume in Docker (docs/spec/plugins.md «Subir un plugin desde la app»). It is written to a
// hidden staging folder first and swapped in with a rename, so the folder the loader reads is never
// half-written. It is loaded on the next restart.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compareVersions } from "@spiderfolio/plugin-sdk";
import type { Env } from "../config/env.ts";
import { DEFAULT_PLUGINS_DIR, type InstalledPlugin } from "./loader.ts";
import type { VerifiedPackage } from "./package.ts";

/** Where uploaded plugins go: PLUGIN_INSTALL_DIR, else the last PLUGINS_DIR folder, else plugins/. */
export function pluginInstallDir(env: Pick<Env, "PLUGIN_INSTALL_DIR" | "PLUGINS_DIR">): string {
  return resolve(env.PLUGIN_INSTALL_DIR ?? env.PLUGINS_DIR.at(-1) ?? DEFAULT_PLUGINS_DIR);
}

/** The version of a plugin on disk in that folder (installed, maybe not loaded yet); null if none. */
export function versionOnDisk(installDir: string, pluginId: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(installDir, pluginId, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export type InstallRejection = "downgrade" | "builtIn";

export class InstallError extends Error {
  readonly reason: InstallRejection;
  constructor(reason: InstallRejection) {
    super(reason);
    this.name = "InstallError";
    this.reason = reason;
  }
}

/** Whether a path is strictly inside a folder. */
const isInside = (folder: string, path: string) => {
  const rel = relative(resolve(folder), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

export function installPackage(input: {
  installDir: string;
  pkg: VerifiedPackage;
  loaded: readonly InstalledPlugin[];
}): { id: string; version: string; previousVersion: string | null } {
  const { installDir, pkg } = input;
  const { id, version } = pkg.manifest;
  // A plugin loaded from another folder (built into the image) is updated with the image, never here:
  // the loader would keep using that one.
  const loaded = input.loaded.find((plugin) => plugin.manifest.id === id);
  if (loaded !== undefined && !isInside(installDir, loaded.dir)) throw new InstallError("builtIn");
  const previousVersion = versionOnDisk(installDir, id) ?? loaded?.version ?? null;
  if (previousVersion !== null && compareVersions(version, previousVersion) < 0) {
    throw new InstallError("downgrade");
  }

  mkdirSync(installDir, { recursive: true });
  const staging = join(installDir, `.staging-${id}-${randomUUID()}`);
  const target = join(installDir, id);
  const previous = join(installDir, `.previous-${id}-${randomUUID()}`);
  try {
    for (const [path, data] of pkg.files) {
      const file = resolve(staging, path);
      // package.ts already refuses unsafe paths; this keeps the write inside staging regardless.
      if (!isInside(staging, file)) throw new Error(`Ruta fuera del paquete: ${path}`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    }
    if (existsSync(target)) renameSync(target, previous);
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  return { id, version, previousVersion };
}
