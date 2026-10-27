// Proceso de la API. Valida el entorno, conecta, abre el puerto y cierra ordenadamente.
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

async function main(): Promise<void> {
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

  const app = createApp({
    env,
    prisma,
    logger,
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

  const shutdown = () => {
    logger.info("Cerrando API");
    server.close(() => {
      void (async () => {
        await boss.stop({ graceful: true });
        await prisma.$disconnect();
        process.exit(0);
      })();
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

await main();
