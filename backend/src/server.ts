// The API process. Validates the environment, connects, opens the port and closes in order: on
// SIGTERM/SIGINT, or when an announced restart comes (plugins/restart.ts), exiting so it is started
// again.
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";
import { createBoss, createJobs, ensureQueues } from "./jobs/boss.ts";
import { createLogger } from "./lib/logger.ts";
import { createStorage, createSystemStorage } from "./lib/storage.ts";
import { createPrismaClient } from "./lib/prisma.ts";
import { initSentry } from "./lib/sentry.ts";
import { createPasswords } from "./modules/auth/passwords.ts";
import { setupPlugins } from "./plugins/setup.ts";
import { ensurePluginQueues } from "./plugins/jobs.ts";
import { pluginInstallDir } from "./plugins/install.ts";
import { RESTART_EXIT_CODE, watchRestart } from "./plugins/restart.ts";

/** In-flight requests get this long to finish before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 20_000;

async function main(): Promise<void> {
  const startedAt = new Date();
  const env = loadEnv();
  initSentry(env);
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const boss = createBoss(env.DATABASE_URL, "api");
  boss.on("error", (error) => {
    logger.error({ err: error }, "Error de pg-boss");
  });
  await boss.start();
  await ensureQueues(boss);
  const plugins = await setupPlugins({
    env,
    prisma,
    logger,
    send: async (queue, payload) => {
      await boss.send(queue, payload);
    },
  });
  await ensurePluginQueues(boss, plugins);

  let shutdown: (code: number) => void = () => undefined;
  const restart = watchRestart({
    dir: pluginInstallDir(env),
    startedAt,
    onRestart: () => {
      logger.info("Reinicio programado: cerrando la API");
      shutdown(RESTART_EXIT_CODE);
    },
  });

  const app = createApp({
    env,
    prisma,
    logger,
    restart,
    jobs: createJobs(boss),
    passwords: await createPasswords(),
    plugins,
    storage: createStorage(),
    systemStorage: createSystemStorage(),
    ...(env.BIAN_ENABLED
      ? {
          anthropic: new Anthropic({
            apiKey: env.ANTHROPIC_API_KEY,
            maxRetries: 1,
            timeout: 60_000,
          }),
        }
      : {}),
  });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "API lista");
  });

  let closing = false;
  shutdown = (code) => {
    if (closing) return;
    closing = true;
    logger.info("Cerrando API");
    restart.stop();
    setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS).unref();
    server.close(() => {
      void (async () => {
        await boss.stop({ graceful: true });
        await prisma.$disconnect();
        process.exit(code);
      })();
    });
    // Idle keep-alive connections would hold close() until they time out.
    server.closeIdleConnections();
  };
  process.once("SIGTERM", () => {
    shutdown(0);
  });
  process.once("SIGINT", () => {
    shutdown(0);
  });
}

await main();
