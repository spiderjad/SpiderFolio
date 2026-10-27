// Valoraciones de Bian agregadas en la base: una fila por documento citado, valoración y motivo.
// SQL a mano porque Prisma no agrupa por los elementos de una lista. Toda consulta lleva el
// workspaceId del contexto.
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

export interface FeedbackByNode {
  nodeId: string;
  rating: string;
  reason: string | null;
  count: number;
}

export interface FeedbackFilter {
  workspaceId: string;
  since: Date;
  /** Hasta (sin incluir); sin él, hasta hoy. */
  until?: Date | undefined;
  rating?: "UP" | "DOWN" | undefined;
}

const filterSql = (params: FeedbackFilter) => Prisma.sql`
  f."workspaceId" = ${params.workspaceId}
  AND f."createdAt" >= ${params.since}
  ${params.until === undefined ? Prisma.empty : Prisma.sql`AND f."createdAt" < ${params.until}`}
  ${params.rating === undefined ? Prisma.empty : Prisma.sql`AND f."rating" = ${params.rating}`}`;

export async function feedbackByNode(
  prisma: PrismaClient,
  params: FeedbackFilter,
): Promise<FeedbackByNode[]> {
  return prisma.$queryRaw<FeedbackByNode[]>(Prisma.sql`
    SELECT n AS "nodeId", f."rating" AS "rating", f."reason" AS "reason", COUNT(*)::int AS "count"
      FROM "BianFeedback" f, unnest(f."nodeIds") AS n
     WHERE ${filterSql(params)}
     GROUP BY 1, 2, 3`);
}

export async function feedbackTotals(
  prisma: PrismaClient,
  params: FeedbackFilter,
): Promise<{ rating: string; count: number }[]> {
  return prisma.$queryRaw<{ rating: string; count: number }[]>(Prisma.sql`
    SELECT f."rating" AS "rating", COUNT(*)::int AS "count"
      FROM "BianFeedback" f
     WHERE ${filterSql(params)}
     GROUP BY 1`);
}
