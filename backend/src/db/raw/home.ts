// Actividad del Inicio agregada en la base: una fila por día y tipo de evento, sin traer los eventos.
// SQL a mano porque Prisma no agrupa por fecha. Toda consulta lleva el workspaceId del contexto.
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

export interface ActivityRow {
  /** Día (UTC) como AAAA-MM-DD. */
  day: string;
  action: string;
  count: number;
}

export async function activityByDay(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    since: Date;
    actions: readonly string[];
    /** Espacios que la persona no ve: la actividad sobre sus elementos no se cuenta. */
    hiddenSpaceIds: readonly string[];
  },
): Promise<ActivityRow[]> {
  const { workspaceId, since } = params;
  const hidden =
    params.hiddenSpaceIds.length === 0
      ? Prisma.empty
      : Prisma.sql`AND NOT EXISTS (
          SELECT 1 FROM "Node" n
           WHERE n."workspaceId" = a."workspaceId"
             AND n."id" = a."entityId"
             AND n."spaceId" = ANY(${[...params.hiddenSpaceIds]}::text[]))`;
  return prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
    SELECT to_char(a."createdAt", 'YYYY-MM-DD') AS "day",
           a."action" AS "action",
           COUNT(*)::int AS "count"
      FROM "AuditLog" a
     WHERE a."workspaceId" = ${workspaceId}
       AND a."createdAt" >= ${since}
       AND a."action" = ANY(${[...params.actions]}::text[])
       ${hidden}
     GROUP BY 1, 2`);
}
