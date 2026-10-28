// Finds and loads the installed plugins (docs/spec/plugins.md): every subfolder of the PLUGINS_DIR
// folders with a package.json declaring «spiderfolio», and every npm package listed in PLUGIN_PACKAGES.
// A plugin that doesn't load is logged and skipped: the core keeps working without it.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMMERCIAL_PLUGIN_IDS,
  PLUGIN_API_VERSION,
  PluginCapabilitySchema,
  PluginManifestSchema,
  type BackendPlugin,
  type PluginManifest,
} from "@spiderfolio/plugin-sdk/backend";
import type { Logger } from "pino";
import type { PluginMigration } from "../db/raw/plugins.ts";

/** Default folder: plugins/ at the repository root (or /app/plugins in the image). */
export const DEFAULT_PLUGINS_DIR = fileURLToPath(new URL("../../../plugins/", import.meta.url));

/** The built app of a plugin (frontendBundle): its folder is served at /plugin-assets/<id>/. */
export interface PluginFrontendBundle {
  /** Folder that holds the bundle; only this folder is served. */
  dir: string;
  /** Bundle file, relative to `dir` (forward slashes). */
  script: string;
  styles: string | null;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  /** Package folder. */
  dir: string;
  /** Version from package.json. */
  version: string;
  backend: BackendPlugin | null;
  migrations: PluginMigration[];
  frontendBundle: PluginFrontendBundle | null;
}

export interface DiscoverOptions {
  /** Folders with plugins (each subfolder is one); the default folder if empty. */
  dirs?: readonly string[];
  /** Names of npm packages installed in node_modules (private). */
  packages?: readonly string[];
  logger: Pick<Logger, "info" | "warn" | "error">;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  spiderfolio?: unknown;
}

function readPackage(dir: string): PackageJson | null {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
}

/** Candidate package folders (nothing imported yet), in order: folders first, then npm packages. */
export function pluginDirectories(options: Omit<DiscoverOptions, "logger">): string[] {
  const dirs: string[] = [];
  const roots =
    options.dirs !== undefined && options.dirs.length > 0 ? options.dirs : [DEFAULT_PLUGINS_DIR];
  for (const root of roots.map((dir) => resolve(dir))) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) dirs.push(join(root, entry.name));
    }
  }
  const require = createRequire(join(process.cwd(), "package.json"));
  for (const name of options.packages ?? []) {
    dirs.push(dirname(require.resolve(`${name}/package.json`)));
  }
  return dirs;
}

/** A manifest path resolved inside the package; fails if it points outside. */
function inside(dir: string, path: string): string {
  const full = resolve(dir, path);
  const rel = relative(dir, full);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`Ruta fuera del plugin: ${path}`);
  }
  return full;
}

function readMigrations(dir: string, manifest: PluginManifest): PluginMigration[] {
  if (manifest.migrations === undefined) return [];
  const folder = inside(dir, manifest.migrations);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(folder, file), "utf8");
      return {
        name: file.replace(/\.sql$/u, ""),
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    });
}

/** The built app: the bundle and its styles have to exist, in the same folder. */
function readFrontendBundle(dir: string, manifest: PluginManifest): PluginFrontendBundle | null {
  if (manifest.frontendBundle === undefined) return null;
  const script = inside(dir, manifest.frontendBundle);
  if (!/\.m?js$/u.test(script) || !statSync(script).isFile()) {
    throw new Error(`frontendBundle no es un archivo .js: ${manifest.frontendBundle}`);
  }
  const folder = dirname(script);
  let styles: string | null = null;
  if (manifest.frontendStyles !== undefined) {
    const css = inside(dir, manifest.frontendStyles);
    if (dirname(css) !== folder || !css.endsWith(".css") || !statSync(css).isFile()) {
      throw new Error("frontendStyles tiene que ser un .css en la carpeta de frontendBundle");
    }
    styles = basename(css);
  }
  return { dir: folder, script: basename(script), styles };
}

function validateBackend(manifest: PluginManifest, value: unknown): BackendPlugin {
  const plugin = (value as { default?: unknown }).default as BackendPlugin | undefined;
  if (plugin?.id !== manifest.id) {
    throw new Error("El backend no exporta por defecto un plugin con el id del manifiesto");
  }
  for (const capability of plugin.capabilities ?? []) {
    PluginCapabilitySchema.parse(capability.id);
    if (!capability.id.startsWith(`${manifest.id}:`)) {
      throw new Error(`La capacidad ${capability.id} no empieza con «${manifest.id}:»`);
    }
  }
  for (const route of plugin.routes ?? []) {
    if (!route.path.startsWith("/")) throw new Error(`Ruta inválida: ${route.path}`);
  }
  for (const job of plugin.jobs ?? []) {
    if (!/^[a-z][a-z0-9-]{1,39}$/u.test(job.name)) throw new Error(`Job inválido: ${job.name}`);
  }
  return plugin;
}

/** Loads the installed plugins. Never fails: what doesn't load stays out with a warning. */
export async function discoverPlugins(options: DiscoverOptions): Promise<InstalledPlugin[]> {
  const { logger } = options;
  const found = new Map<string, InstalledPlugin>();
  let dirs: string[];
  try {
    dirs = pluginDirectories(options);
  } catch (error) {
    logger.error({ err: error }, "No se pudieron listar los plugins");
    return [];
  }
  for (const dir of dirs) {
    try {
      const pkg = readPackage(dir);
      if (pkg?.spiderfolio === undefined) continue;
      const manifest = PluginManifestSchema.parse(pkg.spiderfolio);
      if (manifest.distribution === "community" && COMMERCIAL_PLUGIN_IDS.includes(manifest.id)) {
        throw new Error(`«${manifest.id}» es un plugin comercial: no puede declararse community`);
      }
      if (manifest.pluginApi > PLUGIN_API_VERSION) {
        throw new Error(
          `«${manifest.id}» necesita la versión ${String(manifest.pluginApi)} de la API de plugins y ` +
            `este núcleo ofrece la ${String(PLUGIN_API_VERSION)}: actualiza SpiderFolio`,
        );
      }
      if (found.has(manifest.id)) {
        logger.warn({ plugin: manifest.id, dir }, "Plugin repetido: se usa el primero");
        continue;
      }
      const frontendBundle = readFrontendBundle(dir, manifest);
      const backend =
        manifest.backend === undefined
          ? null
          : validateBackend(
              manifest,
              await import(pathToFileURL(inside(dir, manifest.backend)).href),
            );
      found.set(manifest.id, {
        manifest,
        dir,
        version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
        backend,
        migrations: readMigrations(dir, manifest),
        frontendBundle,
      });
      logger.info({ plugin: manifest.id }, "Plugin instalado");
    } catch (error) {
      logger.error({ err: error, dir }, "Plugin no cargado");
    }
  }
  return [...found.values()];
}
