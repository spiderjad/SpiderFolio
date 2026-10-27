// Descargas de ZIP de una selección (archivos y carpetas de un espacio).
//  · Hasta DIRECT_ZIP_MAX_BYTES: descarga directa. El pedido (autenticado) devuelve un token de un
//    solo uso y de muy corta duración; el navegador navega a esa URL (un enlace normal) y el
//    backend transmite el ZIP en flujo. Al canjear, los permisos de quien lo pidió se resuelven de
//    nuevo: si ya no ve algo, no entra.
//  · Más grande: se genera en segundo plano (worker), se guarda en el bucket de sistema 7 días (no
//    cuenta para la cuota) y se avisa por email con un enlace temporal (docs/spec/panel-admin.md, 9.3).
import { AppError, notFound } from "../../lib/errors.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import type { Storage } from "../../lib/storage.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { loadTenantContext } from "../../middleware/tenant.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { auditAdmin } from "../admin/admin-context.ts";
import { planZipDownload, type ZipPlan } from "../nodes/nodes-zip.service.ts";
import { fileMessages } from "../../i18n/index.ts";

export const DIRECT_ZIP_MAX_BYTES = 500 * 1024 ** 2;
/** El token solo tiene que durar lo que tarda el navegador en seguir el enlace. */
export const DOWNLOAD_TOKEN_TTL_MS = 2 * 60_000;
export const EXPORT_RETENTION_DAYS = 7;

export type ZipRequestResult =
  | { mode: "direct"; url: string; expiresInSeconds: number; sizeBytes: number }
  | { mode: "background"; exportId: string; sizeBytes: number };

/** Prepara la descarga: valida permisos y tamaño, y elige descarga directa o segundo plano. */
export async function requestZipDownload(
  ctx: AdminContext,
  deps: { storage: Pick<Storage, "stream">; jobs: Jobs },
  spaceId: string,
  nodeIds: readonly string[],
): Promise<ZipRequestResult> {
  const plan = await planZipDownload(ctx, deps.storage, spaceId, nodeIds);
  if (plan.totalBytes <= DIRECT_ZIP_MAX_BYTES) {
    const token = randomToken();
    await ctx.db.downloadToken.create({
      data: {
        membershipId: ctx.tenant.membershipId,
        spaceId,
        nodeIds: [...nodeIds],
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS),
      },
    });
    return {
      mode: "direct",
      url: `/api/v1/downloads/${token}`,
      expiresInSeconds: DOWNLOAD_TOKEN_TTL_MS / 1000,
      sizeBytes: plan.totalBytes,
    };
  }
  const created = await ctx.db.zipExport.create({
    data: {
      spaceId,
      membershipId: ctx.tenant.membershipId,
      nodeIds: [...nodeIds],
      status: "PENDING",
      fileName: plan.fileName,
    },
    select: { id: true },
  });
  await deps.jobs.enqueue("zip-export", { exportId: created.id });
  await auditAdmin(ctx, {
    action: "node.export_zip_requested",
    entityType: "ZipExport",
    entityId: created.id,
    metadata: { bytes: plan.totalBytes, items: nodeIds.length },
  });
  return { mode: "background", exportId: created.id, sizeBytes: plan.totalBytes };
}

export interface RedeemInfo {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Canjea un token de descarga: se gasta aunque después falle algo (un solo uso). Cualquier motivo
 * de rechazo (no existe, vencido, ya usado, la persona ya no está o no ve nada) es un 404.
 */
export async function redeemDownloadToken(
  { prisma, storage }: { prisma: PrismaClient; storage: Pick<Storage, "stream"> },
  token: string,
  info: RedeemInfo,
  now: Date = new Date(),
): Promise<ZipPlan> {
  const hash = sha256(token);
  const row = await prisma.downloadToken.findUnique({ where: { tokenHash: hash } });
  // Reclamo atómico: dos pedidos a la vez con el mismo token, solo uno pasa.
  const claimed = await prisma.downloadToken.updateMany({
    where: { tokenHash: hash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (row === null || claimed.count === 0) throw notFound();

  const membership = await prisma.membership.findFirst({
    where: { id: row.membershipId, workspaceId: row.workspaceId },
    select: { userId: true },
  });
  if (membership === null) throw notFound();
  const loaded = await loadTenantContext(prisma, { id: row.workspaceId }, membership.userId);
  if (loaded === null || loaded.tenant.membershipId !== row.membershipId) throw notFound();
  const ctx: AdminContext = {
    db: loaded.db,
    tenant: loaded.tenant,
    actor: { base: loaded.tenant.role.base, capabilities: loaded.tenant.capabilities },
    info: { actorId: membership.userId, ...info },
  };
  const nodeIds = Array.isArray(row.nodeIds)
    ? row.nodeIds.filter((id): id is string => typeof id === "string")
    : [];
  const plan = await planZipDownload(ctx, storage, row.spaceId, nodeIds);
  if (plan.totalBytes > DIRECT_ZIP_MAX_BYTES) {
    // Creció desde el pedido: la descarga directa tiene tope.
    throw new AppError("PAYLOAD_TOO_LARGE", {
      message: fileMessages.selectionChanged,
    });
  }
  await auditAdmin(ctx, {
    action: "node.download_zip",
    entityType: "Space",
    entityId: row.spaceId,
    metadata: { entries: plan.entries.length, bytes: plan.totalBytes },
  });
  return plan;
}

/**
 * Enlace del email de un ZIP en segundo plano: lleva a una URL de descarga de 60 s. Sirve varias
 * veces hasta que vence (7 días) y solo mientras la persona siga siendo miembro activa.
 */
export async function resolveExportLink(
  { prisma, systemStorage }: { prisma: PrismaClient; systemStorage: Pick<Storage, "presignGet"> },
  token: string,
  now: Date = new Date(),
): Promise<string> {
  const row = await prisma.zipExport.findUnique({ where: { linkHash: sha256(token) } });
  if (
    row === null ||
    row.status !== "DONE" ||
    row.storageKey === null ||
    row.expiresAt === null ||
    row.expiresAt <= now
  ) {
    throw notFound();
  }
  const membership = await prisma.membership.findFirst({
    where: { id: row.membershipId, workspaceId: row.workspaceId, status: "ACTIVE" },
    select: { id: true },
  });
  if (membership === null) throw notFound();
  return await systemStorage.presignGet(row.storageKey, {
    fileName: row.fileName,
    inline: false,
    contentType: "application/zip",
  });
}
