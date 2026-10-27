// ZIP grande en segundo plano (worker): arma el ZIP con los permisos de quien lo pidió, lo guarda
// en el bucket de sistema y encola el email con el enlace. A los 7 días se borra (expireExports).
import { Readable } from "node:stream";
import type { Logger } from "pino";
import { ZipExportJobSchema } from "../../jobs/queues.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { AppError } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { randomToken } from "../../lib/crypto.ts";
import type { Storage } from "../../lib/storage.ts";
import { loadTenantContext } from "../../middleware/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { planZipDownload } from "../nodes/nodes-zip.service.ts";
import { zipSize, zipStream } from "../nodes/zip-writer.ts";
import { EXPORT_RETENTION_DAYS } from "./downloads.service.ts";
import { fileMessages } from "../../i18n/index.ts";

export interface ZipExportDeps {
  prisma: PrismaClient;
  logger: Logger;
  storage: Pick<Storage, "stream">;
  systemStorage: Pick<Storage, "putStream" | "delete">;
  jobs: Pick<Jobs, "enqueue">;
}

/** Genera el ZIP de una exportación pendiente. Un job repetido no genera dos veces. */
export async function runZipExport(deps: ZipExportDeps, payload: unknown): Promise<boolean> {
  const { exportId } = ZipExportJobSchema.parse(payload);
  const job = await deps.prisma.zipExport.findUnique({ where: { id: exportId } });
  if (job === null) return false;
  const claimed = await deps.prisma.zipExport.updateMany({
    where: { id: exportId, status: "PENDING" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) return false;

  try {
    const membership = await deps.prisma.membership.findFirst({
      where: { id: job.membershipId, workspaceId: job.workspaceId },
      select: { userId: true },
    });
    const loaded =
      membership === null
        ? null
        : await loadTenantContext(deps.prisma, { id: job.workspaceId }, membership.userId);
    if (membership === null || loaded === null) {
      throw new AppError("NOT_FOUND", { message: fileMessages.zipRequesterGone });
    }
    const ctx: AdminContext = {
      db: loaded.db,
      tenant: loaded.tenant,
      actor: { base: loaded.tenant.role.base, capabilities: loaded.tenant.capabilities },
      info: { actorId: membership.userId, ip: null, userAgent: null },
    };
    const nodeIds = Array.isArray(job.nodeIds)
      ? job.nodeIds.filter((id): id is string => typeof id === "string")
      : [];
    const plan = await planZipDownload(ctx, deps.storage, job.spaceId, nodeIds);
    const size = zipSize(plan.entries);
    const key = `exports/${job.workspaceId}/${job.id}-${randomToken(12)}.zip`;
    await deps.systemStorage.putStream(key, Readable.from(zipStream(plan.entries)), {
      size,
      contentType: "application/zip",
    });
    const now = new Date();
    await deps.prisma.zipExport.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        storageKey: key,
        sizeBytes: BigInt(size),
        fileName: plan.fileName,
        finishedAt: now,
        expiresAt: new Date(now.getTime() + EXPORT_RETENTION_DAYS * 24 * 3600 * 1000),
      },
    });
    await auditAdmin(ctx, {
      action: "node.export_zip_ready",
      entityType: "ZipExport",
      entityId: job.id,
      metadata: { entries: plan.entries.length, bytes: plan.totalBytes },
    });
    await deps.jobs.enqueue("email-send", { kind: "export-ready", exportId: job.id });
    return true;
  } catch (error) {
    deps.logger.error({ err: error, exportId }, "Falló la generación de un ZIP");
    const message =
      error instanceof AppError ? error.message : fileMessages.zipFailed;
    await deps.prisma.zipExport.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    });
    await deps.jobs.enqueue("email-send", { kind: "export-failed", exportId: job.id });
    return false;
  }
}

/** Borra los ZIP vencidos (objeto y fila) y los tokens de descarga que ya no sirven. */
export async function expireExports(
  deps: Pick<ZipExportDeps, "prisma" | "logger" | "systemStorage">,
  now: Date = new Date(),
): Promise<{ exports: number; tokens: number }> {
  const rows = await deps.prisma.zipExport.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, storageKey: true },
    take: 200,
  });
  let exports = 0;
  for (const row of rows) {
    try {
      if (row.storageKey !== null) await deps.systemStorage.delete(row.storageKey);
      await deps.prisma.zipExport.deleteMany({ where: { id: row.id } });
      exports++;
    } catch (error) {
      deps.logger.warn({ err: error, exportId: row.id }, "No se pudo borrar un ZIP vencido");
    }
  }
  const tokens = await deps.prisma.downloadToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 3600 * 1000) } },
  });
  return { exports, tokens: tokens.count };
}
