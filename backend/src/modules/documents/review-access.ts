// Quien tiene una aprobación pendiente puede comentar el documento aunque solo lo vea (y aunque el
// texto esté congelado): comentar no cambia el contenido. Fuera de la revisión no se le da nada.
import type { AccessLevel } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { atLeast } from "../access/access.ts";

type Db = Pick<TenantDb, "documentVersion" | "approval">;

/** ¿Está esta persona revisando ahora mismo (aprobación pendiente de la versión en revisión)? */
export async function isReviewing(db: Db, nodeId: string, membershipId: string): Promise<boolean> {
  const latest = await db.documentVersion.findFirst({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: { version: true, status: true, submittedAt: true },
  });
  if (latest?.status !== "IN_REVIEW" || latest.submittedAt === null) return false;
  return (
    (await db.approval.count({
      where: {
        nodeId,
        version: latest.version,
        approverId: membershipId,
        round: latest.submittedAt,
        decision: null,
      },
    })) > 0
  );
}

/** El nivel para comentar: el propio, o COMMENT si quien lo ve está revisándolo. */
export async function commentLevel(
  db: Db,
  nodeId: string,
  membershipId: string,
  level: AccessLevel | null,
): Promise<AccessLevel | null> {
  if (level === null || atLeast(level, "COMMENT")) return level;
  return (await isReviewing(db, nodeId, membershipId)) ? "COMMENT" : level;
}
