// Corre a mano el job de avisos de vencimiento de accesos (el mismo que el cron diario de las 11:00
// UTC), sin esperar al worker. Con --reset borra antes los avisos de vencimiento ya creados (los
// "expiring" y "expiring_granted") para que se regeneren con los textos actuales. Solo en local.
//   npm run job:expiry-notices -w @spiderfolio/backend [-- --reset]
import { loadEnv } from "../src/config/env.ts";
import { createLogger } from "../src/lib/logger.ts";
import { createPrismaClient } from "../src/lib/prisma.ts";
import { notifyExpiringAccess } from "../src/modules/notifications/expiry-notices.ts";

const env = loadEnv();
// Borrar filas solo contra una base local.
if (process.argv.includes("--reset")) {
  const host = new URL(env.DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error("--reset solo corre contra una base local");
  }
}

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  if (process.argv.includes("--reset")) {
    const { count } = await prisma.notification.deleteMany({
      where: { kind: { in: ["expiring", "expiring_granted"] } },
    });
    console.log(`Avisos de vencimiento borrados: ${String(count)}`);
  }
  const { notified } = await notifyExpiringAccess({ prisma, logger: createLogger(env) });
  console.log(`Avisos de vencimiento creados: ${String(notified)}`);
} finally {
  await prisma.$disconnect();
}
