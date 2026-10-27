// SQL en crudo: solo en db/raw (regla de ESLint, CLAUDE.md sección 7.4).
// Contador de rate limit en Postgres, compartido entre instancias (sección 12). Un único
// INSERT … ON CONFLICT atómico: suma 1 o, si la ventana venció, la reinicia. La tabla es
// UNLOGGED (ver la migración inicial). Las fechas van en UTC, como las guarda Prisma.
import type { PrismaClient } from "../../lib/prisma.ts";

export interface BucketState {
  hits: number;
  resetAt: Date;
}

export async function incrementBucket(
  prisma: PrismaClient,
  key: string,
  windowMs: number,
): Promise<BucketState> {
  const rows = await prisma.$queryRaw<BucketState[]>`
    INSERT INTO "RateLimitBucket" ("key", "hits", "resetAt")
    VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + ${windowMs} * interval '1 millisecond')
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE
        WHEN "RateLimitBucket"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1
        ELSE "RateLimitBucket"."hits" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN EXCLUDED."resetAt"
        ELSE "RateLimitBucket"."resetAt"
      END
    RETURNING "hits", "resetAt"`;
  const row = rows[0];
  if (row === undefined) throw new Error("El rate limit no devolvió el contador");
  return row;
}

export async function decrementBucket(prisma: PrismaClient, key: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "RateLimitBucket" SET "hits" = GREATEST("hits" - 1, 0) WHERE "key" = ${key}`;
}
