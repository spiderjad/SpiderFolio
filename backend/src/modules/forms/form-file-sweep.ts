// Daily sweep of form photos and signatures that never reached a record: requested and never
// uploaded, or uploaded and then the form wasn't sent (closed the phone, went back). A day's wait
// before (someone may still be filling it in). The confirmed ones give their quota back.
import type { Logger } from "pino";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Storage } from "../../lib/storage.ts";

const DAY_MS = 24 * 3600 * 1000;
const BATCH = 500;

export async function sweepFormFiles(
  deps: { prisma: PrismaClient; logger: Logger; storage: Pick<Storage, "delete"> },
  now: Date = new Date(),
): Promise<{ removed: number }> {
  const stale = await deps.prisma.formFile.findMany({
    where: { recordId: null, createdAt: { lt: new Date(now.getTime() - DAY_MS) } },
    select: { id: true, workspaceId: true, storageKey: true, sizeBytes: true, confirmedAt: true },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  let removed = 0;
  for (const file of stale) {
    try {
      await deps.prisma.$transaction([
        deps.prisma.formFile.deleteMany({ where: { id: file.id, recordId: null } }),
        ...(file.confirmedAt === null
          ? []
          : [
              deps.prisma.workspace.update({
                where: { id: file.workspaceId },
                data: { storageUsedBytes: { decrement: file.sizeBytes } },
              }),
            ]),
      ]);
      await deps.storage.delete(file.storageKey).catch(() => undefined);
      removed += 1;
    } catch (error) {
      deps.logger.warn(
        { err: error, fileId: file.id },
        "No se pudo borrar un adjunto sin registro",
      );
    }
  }
  return { removed };
}
