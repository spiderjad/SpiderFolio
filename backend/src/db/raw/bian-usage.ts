// Contador de consultas a Bian por persona y período: misma reserva atómica que el de la empresa
// (dos pedidos a la vez no pasan el límite) y la misma devolución. Toda consulta lleva el
// workspaceId del contexto.
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

/** Suma una consulta a la persona solo si le queda cupo. Devuelve su total, o null si ya llegó al máximo. */
export async function reserveMemberUsage(
  prisma: PrismaClient,
  params: { workspaceId: string; membershipId: string; periodStart: Date; max: number | null },
): Promise<number | null> {
  if (params.max !== null && params.max <= 0) return null;
  const rows = await prisma.$queryRaw<{ aiQueries: number }[]>(Prisma.sql`
    INSERT INTO "UsageCounterMember" ("workspaceId", "membershipId", "periodStart", "aiQueries")
    VALUES (${params.workspaceId}, ${params.membershipId}, ${params.periodStart}, 1)
    ON CONFLICT ("membershipId", "periodStart")
    DO UPDATE SET "aiQueries" = "UsageCounterMember"."aiQueries" + 1
    WHERE ${params.max}::int IS NULL OR "UsageCounterMember"."aiQueries" < ${params.max}::int
    RETURNING "aiQueries"`);
  return rows[0]?.aiQueries ?? null;
}

export async function refundMemberUsage(
  prisma: PrismaClient,
  params: { workspaceId: string; membershipId: string; periodStart: Date },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "UsageCounterMember" SET "aiQueries" = GREATEST("aiQueries" - 1, 0)
     WHERE "workspaceId" = ${params.workspaceId}
       AND "membershipId" = ${params.membershipId}
       AND "periodStart" = ${params.periodStart}`;
}
