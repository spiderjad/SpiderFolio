// Jobs de los plugins en el worker (docs/spec/plugins.md): cola «plugin.<id>.<job>» por cada job
// declarado. Un job encolado para un workspace donde el plugin ya no está activo se descarta; los
// programados corren una vez por cada workspace con la licencia vigente.
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Logger } from "pino";
import type { PluginRuntime } from "./runtime.ts";

const WorkspacePayload = z.looseObject({ workspaceId: z.string().min(1) });

export function pluginQueueName(pluginId: string, job: string): string {
  return `plugin.${pluginId}.${job}`;
}

/** Crea las colas de los plugins instalados (idempotente). */
export async function ensurePluginQueues(boss: PgBoss, plugins: PluginRuntime): Promise<void> {
  for (const plugin of plugins.installed) {
    for (const job of plugin.backend?.jobs ?? []) {
      const name = pluginQueueName(plugin.manifest.id, job.name);
      const options = {
        retryLimit: job.options?.retryLimit ?? 2,
        retryDelay: job.options?.retryDelay ?? 30,
        expireInSeconds: job.options?.expireInSeconds ?? 600,
        deleteAfterSeconds: 7 * 24 * 3600,
      };
      if ((await boss.getQueue(name)) === null) await boss.createQueue(name, options);
      else await boss.updateQueue(name, options);
    }
  }
}

/** Registra los handlers y la programación de los jobs de plugins. */
export async function startPluginJobs(
  boss: PgBoss,
  plugins: PluginRuntime,
  logger: Logger,
): Promise<void> {
  await ensurePluginQueues(boss, plugins);
  for (const plugin of plugins.installed) {
    const pluginId = plugin.manifest.id;
    const ctx = plugins.jobContext(pluginId);
    for (const job of plugin.backend?.jobs ?? []) {
      const queue = pluginQueueName(pluginId, job.name);
      await boss.work(queue, async (queued) => {
        for (const item of queued) {
          try {
            if (job.cron !== undefined && !WorkspacePayload.safeParse(item.data).success) {
              // Programado: una vez por workspace activo.
              for (const workspaceId of await ctx.activeWorkspaces()) {
                await job.handler(ctx, job.schema.parse({ workspaceId }));
              }
              continue;
            }
            const { workspaceId } = WorkspacePayload.parse(item.data);
            if (!(await plugins.isActive(workspaceId, pluginId))) continue;
            await job.handler(ctx, job.schema.parse(item.data));
          } catch (error) {
            logger.error({ err: error, plugin: pluginId, queue }, "Job de plugin fallido");
            throw error;
          }
        }
      });
      if (job.cron !== undefined) await boss.schedule(queue, job.cron, {}, { tz: "Europe/Madrid" });
    }
  }
}
