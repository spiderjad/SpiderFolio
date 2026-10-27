// Descubre y carga los plugins instalados (docs/spec/plugins.md): cada subcarpeta de PLUGINS_DIR con un
// package.json que declare «spiderfolio», y cada paquete npm listado en PLUGIN_PACKAGES. Un plugin que
// no carga se registra en el log y se salta: el núcleo sigue funcionando sin él.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMMERCIAL_PLUGIN_IDS,
  PluginCapabilitySchema,
  PluginManifestSchema,
  type BackendPlugin,
  type PluginManifest,
} from "@spiderfolio/plugin-sdk/backend";
import type { Logger } from "pino";
import type { PluginMigration } from "../db/raw/plugins.ts";

/** Carpeta por defecto: plugins/ en la raíz del repositorio (o /app/plugins en la imagen). */
export const DEFAULT_PLUGINS_DIR = fileURLToPath(new URL("../../../plugins/", import.meta.url));

export interface InstalledPlugin {
  manifest: PluginManifest;
  /** Carpeta del paquete. */
  dir: string;
  /** Versión del package.json. */
  version: string;
  backend: BackendPlugin | null;
  migrations: PluginMigration[];
}

export interface DiscoverOptions {
  dir?: string | undefined;
  /** Nombres de paquetes npm instalados con node_modules (privados). */
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

/** Carpetas de paquetes candidatos (sin importar nada todavía). */
export function pluginDirectories(options: Omit<DiscoverOptions, "logger">): string[] {
  const dirs: string[] = [];
  const root = resolve(options.dir ?? DEFAULT_PLUGINS_DIR);
  if (existsSync(root)) {
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

function readMigrations(dir: string, manifest: PluginManifest): PluginMigration[] {
  if (manifest.migrations === undefined) return [];
  const folder = resolve(dir, manifest.migrations);
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

/** Carga los plugins instalados. Nunca falla: lo que no carga queda afuera con un aviso. */
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
      if (found.has(manifest.id)) {
        logger.warn({ plugin: manifest.id, dir }, "Plugin repetido: se usa el primero");
        continue;
      }
      const backend =
        manifest.backend === undefined
          ? null
          : validateBackend(
              manifest,
              await import(pathToFileURL(resolve(dir, manifest.backend)).href),
            );
      found.set(manifest.id, {
        manifest,
        dir,
        version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
        backend,
        migrations: readMigrations(dir, manifest),
      });
      logger.info({ plugin: manifest.id }, "Plugin instalado");
    } catch (error) {
      logger.error({ err: error, dir }, "Plugin no cargado");
    }
  }
  return [...found.values()];
}
