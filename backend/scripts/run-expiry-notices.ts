// Corre a mano el job de avisos de vencimiento de accesos (el mismo que sale a las 8:00 de cada
// empresa), sin esperar al worker y a cualquier hora (todas las empresas). Con --reset borra antes los avisos de vencimiento ya creados (los
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
  const { notified } = await notifyExpiringAccess(
    { prisma, logger: createLogger(env) },
    new Date(),
    { anyHour: true },
  );
  console.log(`Avisos de vencimiento creados: ${String(notified)}`);
} finally {
  await prisma.$disconnect();
}
