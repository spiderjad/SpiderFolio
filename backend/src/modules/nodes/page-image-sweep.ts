// Limpieza diaria de imágenes de páginas: borra las pedidas que nunca se confirmaron y las que ya
// no aparecen en el texto de su página (se pegó y se quitó), liberando su cuota. Una imagen recién
// subida espera 24 h antes de revisarse (deshacer, otra pestaña con cambios sin guardar).
import type { Logger } from "pino";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Storage } from "../../lib/storage.ts";
import { RESERVATION_TTL_MS } from "../files/files.service.ts";

const DAY_MS = 24 * 3600 * 1000;
const BATCH = 500;

export interface PageImageSweepResult {
  unconfirmed: number;
  orphans: number;
  kept: number;
}

export async function sweepPageImages(
  deps: { prisma: PrismaClient; logger: Logger; storage: Pick<Storage, "delete"> },
  now: Date = new Date(),
): Promise<PageImageSweepResult> {
  const { prisma, storage } = deps;
  const result: PageImageSweepResult = { unconfirmed: 0, orphans: 0, kept: 0 };

  // 1. Pedidas y nunca confirmadas (no habían tomado cuota).
  const stale = await prisma.pageImage.findMany({
    where: { confirmedAt: null, createdAt: { lt: new Date(now.getTime() - RESERVATION_TTL_MS) } },
    select: { id: true, storageKey: true },
    take: BATCH,
  });
  for (const image of stale) {
    try {
      await storage.delete(image.storageKey);
      await prisma.pageImage.deleteMany({ where: { id: image.id } });
      result.unconfirmed += 1;
    } catch (error) {
      deps.logger.warn(
        { err: error, imageId: image.id },
        "No se pudo borrar una imagen sin confirmar",
      );
    }
  }

  // 2. Confirmadas que ya no están en el texto de su página.
  const candidates = await prisma.pageImage.findMany({
    where: {
      confirmedAt: { not: null },
      createdAt: { lt: new Date(now.getTime() - DAY_MS) },
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } }],
    },
    orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    select: { id: true, nodeId: true, workspaceId: true, storageKey: true, sizeBytes: true },
    take: BATCH,
  });
  const texts = new Map<string, string>();
  for (const image of candidates) {
    let text = texts.get(image.nodeId);
    if (text === undefined) {
      const page = await prisma.pageContent.findUnique({
        where: { nodeId: image.nodeId },
        select: { content: true },
      });
      text = JSON.stringify(page?.content ?? null);
      texts.set(image.nodeId, text);
    }
    if (text.includes(image.id)) {
      await prisma.pageImage.update({ where: { id: image.id }, data: { checkedAt: now } });
      result.kept += 1;
      continue;
    }
    try {
      await prisma.$transaction([
        prisma.pageImage.delete({ where: { id: image.id } }),
        prisma.workspace.update({
          where: { id: image.workspaceId },
          data: { storageUsedBytes: { decrement: image.sizeBytes } },
        }),
      ]);
      await storage.delete(image.storageKey).catch(() => undefined);
      result.orphans += 1;
    } catch (error) {
      deps.logger.warn({ err: error, imageId: image.id }, "No se pudo borrar una imagen sin uso");
    }
  }
  deps.logger.info(result, "Limpieza de imágenes de páginas");
  return result;
}
