// Proceso worker (CLAUDE.md, sección 12A.2): procesa las colas y programa las tareas
// periódicas. En producción es otro contenedor con la misma imagen que la API.
import type { JobResult, PgBoss } from "pg-boss";
import { loadEnv } from "./config/env.ts";
import { pluginInstallDir } from "./plugins/install.ts";
import { RESTART_EXIT_CODE, watchRestart } from "./plugins/restart.ts";
import { createBoss, createJobs, ensureQueues } from "./jobs/boss.ts";
import {
  cleanupExpired,
  cleanupExpiredUploads,
  deleteObjects,
  expireTrash,
  reportFailedEmail,
  sendEmailJob,
  type WorkerDeps,
} from "./jobs/handlers.ts";
import {
  ControlledPdfJobSchema,
  SearchReindexJobSchema,
  schedules,
  TextExtractJobSchema,
} from "./jobs/queues.ts";
import { forTenant } from "./db/tenant.ts";
import { ensureControlledPdf } from "./modules/documents/pdf.service.ts";
import { sendReadingReminders } from "./modules/documents/readings.job.ts";
import { notifyExpiringAccess } from "./modules/notifications/expiry-notices.ts";
import { extractFileText, reindexSearch } from "./modules/search/search-jobs.ts";
import { sweepPageImages } from "./modules/nodes/page-image-sweep.ts";
import { runZipExport } from "./modules/downloads/zip-export.ts";
import { runZipImport } from "./modules/imports/zip-import.ts";
import { sweepFileVersions } from "./modules/files/version-retention.ts";
import { pruneAudit } from "./modules/audit/audit-log.service.ts";
import { createLogger } from "./lib/logger.ts";
import { createMailer } from "./lib/mailer.ts";
import { backfillBianIndexIfEmpty, drainBianIndex } from "./modules/bian/indexer.ts";
import { createSecretBox } from "./lib/secret-box.ts";
import { domainProviderFromEnv } from "./modules/email-settings/domain-provider.ts";
import { classifySmtpError } from "./modules/email-settings/smtp.ts";
import {
  isPermanentSmtpError,
  monitorSystemMailer,
} from "./modules/email-settings/system-email.ts";
import { createWorkspaceMailer } from "./modules/email-settings/workspace-mailer.ts";
import { createStorage, createSystemStorage } from "./lib/storage.ts";
import { createPrismaClient } from "./lib/prisma.ts";
import { initSentry } from "./lib/sentry.ts";
import { setupPlugins } from "./plugins/setup.ts";
import { startPluginJobs } from "./plugins/jobs.ts";

// Lotes de hasta 10 jobs con resultado por job: si un email falla, solo ese se reintenta.
// Mientras los lotes llegan llenos, el worker sigue sin esperar el intervalo de sondeo (por
// defecto pg-boss toma 1 job cada 2 s: ~30 emails por minuto).
const BATCH_OPTIONS = {
  batchSize: 10,
  perJobResults: true,
  burstWhenBatchFull: true,
  pollingIntervalSeconds: 1,
} as const;

/** Registra handlers y horarios. Separado de main() para usarlo en los tests. */
export async function startWorker(boss: PgBoss, deps: WorkerDeps): Promise<void> {
  await ensureQueues(boss);

  await boss.work("email-send", BATCH_OPTIONS, async (jobs) =>
    Promise.all(
      jobs.map(async (job): Promise<JobResult> => {
        try {
          await sendEmailJob(deps, job.data);
          return { id: job.id, status: "completed" };
        } catch (error) {
          const { code } = classifySmtpError(error);
          // Wrong credentials or a rejected sender: retrying won't fix it. The job fails at once and
          // goes to email-failed, which notifies the administrators.
          if (isPermanentSmtpError(code)) {
            deps.logger.error(
              { err: error, jobId: job.id, code },
              "Email no enviado: error permanente del SMTP, no se reintenta",
            );
            return { id: job.id, status: "deadletter", output: { code } };
          }
          deps.logger.warn({ err: error, jobId: job.id, code }, "Email no enviado; se reintentará");
          return { id: job.id, status: "failed", output: { code } };
        }
      }),
    ),
  );
  // In batches: after an SMTP outage many emails fail together, and one job every 2 s (pg-boss's
  // default) would delay the administrators' notice by minutes.
  await boss.work("email-failed", { batchSize: 20, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await reportFailedEmail(deps, job.data);
  });
  await boss.work("maintenance-cleanup", async (jobs) => {
    for (const job of jobs) await cleanupExpired(deps, job.data);
  });
  await boss.work("uploads-cleanup", async (jobs) => {
    for (const job of jobs) await cleanupExpiredUploads(deps, job.data);
  });
  await boss.work("zip-import", async (jobs) => {
    for (const job of jobs) await runZipImport(deps, job.data);
  });
  await boss.work("zip-export", async (queued) => {
    for (const job of queued) await runZipExport({ ...deps, jobs: createJobs(boss) }, job.data);
  });
  await boss.work("objects-delete", async (jobs) => {
    for (const job of jobs) await deleteObjects(deps, job.data);
  });
  await boss.work("access-expiry-notices", async () => {
    await notifyExpiringAccess(deps);
  });
  const jobs = createJobs(boss);
  await boss.work("controlled-pdf", async (queued) => {
    // Sin Gotenberg no hay PDF de páginas: se descarta (la app lo avisa al pedirlo).
    if (deps.gotenbergUrl === undefined) return;
    for (const job of queued) {
      const data = ControlledPdfJobSchema.parse(job.data);
      await ensureControlledPdf(
        forTenant(deps.prisma, data.workspaceId),
        { storage: deps.storage, gotenbergUrl: deps.gotenbergUrl },
        data.workspaceId,
        data.nodeId,
        data.version,
      );
    }
  });
  await boss.work("text-extract", async (queued) => {
    for (const job of queued) await extractFileText(deps, TextExtractJobSchema.parse(job.data));
  });
  await boss.work("search-reindex", async (queued) => {
    for (const job of queued) {
      await reindexSearch({ ...deps, jobs }, SearchReindexJobSchema.parse(job.data));
    }
  });
  if (deps.bianEnabled) {
    await backfillBianIndexIfEmpty(deps);
    await boss.work("bian-index", async () => {
      await drainBianIndex(deps);
    });
  }
  await boss.work("reading-reminders", async () => {
    await sendReadingReminders({ prisma: deps.prisma, logger: deps.logger, jobs });
  });
  await boss.work("audit-retention", async () => {
    const { deleted } = await pruneAudit(deps);
    deps.logger.info({ deleted }, "Registro de auditoría recortado");
  });
  await boss.work("trash-expire", async (queued) => {
    for (const job of queued) {
      await expireTrash({ ...deps, jobs }, job.data);
      await sweepPageImages(deps);
      await sweepFileVersions({ ...deps, jobs });
    }
  });

  // Tareas que ya no existen (la prueba de 14 días): se desprograman si quedaron de antes.
  for (const old of ["trial-expiry"]) {
    try {
      await boss.unschedule(old);
    } catch {
      // No estaba programada.
    }
  }
  for (const { queue, cron, tz } of schedules) {
    await boss.schedule(queue, cron, {}, { tz });
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const env = loadEnv();
  initSentry(env);
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const boss = createBoss(env.DATABASE_URL, "worker");
  boss.on("error", (error) => {
    logger.error({ err: error }, "Error de pg-boss");
  });
  await boss.start();
  await startWorker(boss, {
    prisma,
    mailer: createWorkspaceMailer({
      base: monitorSystemMailer(createMailer(env), { prisma, logger }),
      prisma,
      box: env.EMAIL_ENCRYPTION_KEY === undefined ? null : createSecretBox(env),
      domainProvider: domainProviderFromEnv(env),
      env,
      logger,
    }),
    logger,
    appUrl: env.APP_URL,
    storage: createStorage(),
    systemStorage: createSystemStorage(),
    ...(env.GOTENBERG_URL === undefined ? {} : { gotenbergUrl: env.GOTENBERG_URL }),
    bianEnabled: env.BIAN_ENABLED,
  });
  const plugins = await setupPlugins({
    env,
    prisma,
    logger,
    send: async (queue, payload) => {
      await boss.send(queue, payload);
    },
  });
  await startPluginJobs(boss, plugins, logger, prisma);
  logger.info("Worker listo");

  let closing = false;
  const shutdown = async (code: number) => {
    if (closing) return;
    closing = true;
    logger.info("Cerrando worker");
    restart.stop();
    // Running jobs finish (graceful); the supervisor starts the worker again with the new plugins.
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(code);
  };
  // An announced restart (plugins/restart.ts): the same plan the API follows.
  const restart = watchRestart({
    dir: pluginInstallDir(env),
    startedAt,
    onRestart: () => {
      logger.info("Reinicio programado: cerrando el worker");
      void shutdown(RESTART_EXIT_CODE);
    },
  });
  process.once("SIGTERM", () => void shutdown(0));
  process.once("SIGINT", () => void shutdown(0));
}

if (import.meta.main) await main();
