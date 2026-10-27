// Arranque de los plugins (docs/spec/plugins.md), común a la API y al worker: descubrir, aplicar sus
// migraciones (la API y el worker; un lock evita que se pisen) y armar el runtime. Un plugin cuya migración falla queda afuera; el núcleo arranca igual.
import { pluginSchemaName } from "@spiderfolio/plugin-sdk";
import { providePluginLocale } from "@spiderfolio/plugin-sdk/backend";
import type { Logger } from "pino";
import type { Env } from "../config/env.ts";
import { applyPluginMigrations } from "../db/raw/plugins.ts";
import { currentLocale } from "../i18n/locales.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import { discoverPlugins, type InstalledPlugin } from "./loader.ts";
import { createPluginRuntime, type PluginRuntime, type SendJob } from "./runtime.ts";

export async function setupPlugins(input: {
  env: Pick<Env, "DATABASE_URL" | "PLUGINS_DIR" | "PLUGIN_PACKAGES">;
  prisma: PrismaClient;
  logger: Logger;
  send?: SendJob;
}): Promise<PluginRuntime> {
  const { env, logger } = input;
  // Los textos de los plugins siguen el idioma de la petición o del job (docs/spec/plugins.md).
  providePluginLocale(currentLocale);
  const discovered = await discoverPlugins({
    dir: env.PLUGINS_DIR,
    packages: env.PLUGIN_PACKAGES,
    logger,
  });
  const ready: InstalledPlugin[] = [];
  for (const plugin of discovered) {
    if (plugin.migrations.length === 0) {
      ready.push(plugin);
      continue;
    }
    try {
      const { applied, changed } = await applyPluginMigrations(env.DATABASE_URL, {
        pluginId: plugin.manifest.id,
        schema: pluginSchemaName(plugin.manifest.id),
        migrations: plugin.migrations,
      });
      if (applied.length > 0)
        logger.info({ plugin: plugin.manifest.id, applied }, "Migraciones de plugin aplicadas");
      if (changed.length > 0) {
        logger.warn(
          { plugin: plugin.manifest.id, changed },
          "Migraciones de plugin ya aplicadas cambiaron: no se vuelven a correr",
        );
      }
      ready.push(plugin);
    } catch (error) {
      logger.error(
        { err: error, plugin: plugin.manifest.id },
        "Migración de plugin fallida: el plugin no se carga",
      );
    }
  }
  return createPluginRuntime({
    prisma: input.prisma,
    logger,
    installed: ready,
    ...(input.send === undefined ? {} : { send: input.send }),
  });
}
