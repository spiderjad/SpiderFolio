// Versiones guardadas (fileVersionsKept, si la empresa lo fija; por defecto sin límite): al superar el límite, la versión más antigua de un
// archivo común pasa a la papelera de versiones (se oculta del historial; no se pierde hasta que
// vence). Nunca se tocan la versión vigente ni los archivos de documentos controlados: sus versiones
// son parte del historial de control. Las que llevan 30 días en la papelera se eliminan para siempre.
import { forTenant, type TenantDb } from "../../db/tenant.ts";
import type { Jobs } from "../../jobs/boss.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { audit } from "../audit/audit.service.ts";
import { workspaceLimits } from "../limits/limits.service.ts";

const DAY_MS = 24 * 3600 * 1000;
/** Los mismos 30 días que la papelera de elementos. */
export const VERSION_TRASH_DAYS = 30;
const KEYS_PER_JOB = 200;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/**
 * Manda a la papelera las versiones de un archivo que exceden `keep` (las más antiguas primero).
 * Devuelve cuántas movió. `keep` null: sin límite.
 */
export async function trashOldVersions(
  db: TenantDb,
  nodeId: string,
  keep: number | null,
  now: Date = new Date(),
): Promise<number> {
  if (keep === null) return 0;
  const node = await db.node.findFirst({
    where: { id: nodeId, type: "FILE" },
    select: { currentVersion: true },
  });
  if (node === null) return 0;
  if ((await db.controlledDocument.count({ where: { nodeId } })) > 0) return 0;
  const active = await db.fileVersion.findMany({
    where: { nodeId, purgedAt: null, trashedAt: null },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });
  // Se conservan las `keep` más nuevas y, además, la vigente (puede ser una anterior si se restauró).
  const excess = active.slice(keep).filter((row) => row.version !== node.currentVersion);
  if (excess.length === 0) return 0;
  await db.fileVersion.updateMany({
    where: { id: { in: excess.map((row) => row.id) } },
    data: { trashedAt: now },
  });
  await audit(db, {
    action: "file.versions.trash",
    entityType: "Node",
    entityId: nodeId,
    metadata: { versions: excess.map((row) => row.version).sort((a, b) => a - b), keep },
  });
  return excess.length;
}

/** El límite de versiones guardadas del workspace (null: sin límite). */
export async function versionsKept(db: TenantDb): Promise<number | null> {
  return (await workspaceLimits(db)).fileVersionsKept;
}

/**
 * Recorte diario: aplica el límite a los archivos que lo exceden (por ejemplo, tras bajarlo) y
 * elimina para siempre las versiones que llevan 30 días en la papelera (libera la cuota y encola el
 * borrado de los objetos de S3).
 */
export async function sweepFileVersions(
  deps: { prisma: PrismaClient; jobs: Jobs },
  now: Date = new Date(),
): Promise<{ trashed: number; purged: number }> {
  let trashed = 0;
  const workspaces = await deps.prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const { id } of workspaces) {
    const db = forTenant(deps.prisma, id);
    const keep = await versionsKept(db).catch(() => null);
    if (keep === null) continue;
    const groups = await deps.prisma.fileVersion.groupBy({
      by: ["nodeId"],
      where: { workspaceId: id, purgedAt: null, trashedAt: null },
      having: { nodeId: { _count: { gt: keep } } },
      orderBy: { nodeId: "asc" },
      take: 500,
    });
    for (const group of groups) trashed += await trashOldVersions(db, group.nodeId, keep, now);
  }

  const cutoff = new Date(now.getTime() - VERSION_TRASH_DAYS * DAY_MS);
  let purged = 0;
  const due = await deps.prisma.fileVersion.groupBy({
    by: ["workspaceId"],
    where: { trashedAt: { lt: cutoff }, purgedAt: null },
    orderBy: { workspaceId: "asc" },
  });
  for (const { workspaceId } of due) {
    purged += await forTenant(deps.prisma, workspaceId).$transaction(async (tx: TenantDb) => {
      const rows = await tx.fileVersion.findMany({
        where: { trashedAt: { lt: cutoff }, purgedAt: null },
        select: { id: true, storageKey: true, sizeBytes: true },
        take: 1000,
      });
      if (rows.length === 0) return 0;
      await tx.fileVersion.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { purgedAt: now },
      });
      const bytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0n);
      const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { storageUsedBytes: { decrement: bytes } },
      });
      for (const part of chunks(
        rows.map((row) => row.storageKey),
        KEYS_PER_JOB,
      )) {
        await deps.jobs.enqueue("objects-delete", { keys: part }, { tx });
      }
      return rows.length;
    });
  }
  return { trashed, purged };
}
