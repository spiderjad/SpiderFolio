// Reglas de documento controlado que tocan a páginas y archivos al editarlos: mientras se revisa o
// está aprobado, el contenido está congelado; editar uno publicado abre un borrador nuevo y la
// versión vigente no cambia hasta que se publique. Solo usan la base: no dependen de otros servicios.
import type { TenantDb } from "../../db/tenant.ts";
import { contentMessages } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";

type Db = Pick<TenantDb, "controlledDocument" | "documentVersion" | "node">;

/** La versión más nueva del documento (la que se está editando, revisando o la última publicada). */
export async function latestVersion(db: Db, nodeId: string) {
  return await db.documentVersion.findFirst({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true },
  });
}

/** Si el nodo es controlado y su última versión está en revisión o aprobada: no se toca. */
export async function assertNotLocked(db: Db, nodeId: string): Promise<void> {
  const controlled = await db.controlledDocument.findFirst({
    where: { nodeId },
    select: { id: true },
  });
  if (controlled === null) return;
  const latest = await latestVersion(db, nodeId);
  if (latest?.status === "IN_REVIEW" || latest?.status === "APPROVED") {
    throw new AppError("CONFLICT", { message: contentMessages.controlledLocked });
  }
}

/**
 * Antes de cambiar el contenido de un documento controlado: lo bloquea si está en revisión y, si la
 * última versión es la publicada, abre el borrador siguiente. No hace nada con nodos comunes.
 */
export async function ensureDraftVersion(
  db: Db,
  membershipId: string,
  nodeId: string,
  options: { fileVersion?: number } = {},
): Promise<void> {
  const controlled = await db.controlledDocument.findFirst({
    where: { nodeId },
    select: { id: true },
  });
  if (controlled === null) return;
  const latest = await latestVersion(db, nodeId);
  if (latest === null) return;
  if (latest.status === "IN_REVIEW" || latest.status === "APPROVED") {
    throw new AppError("CONFLICT", { message: contentMessages.controlledLocked });
  }
  if (latest.status === "DRAFT") {
    if (options.fileVersion !== undefined) {
      await db.documentVersion.update({
        where: { id: latest.id },
        data: { fileVersion: options.fileVersion },
      });
    }
    return;
  }
  const node = await db.node.findFirst({ where: { id: nodeId }, select: { name: true } });
  await db.documentVersion.create({
    data: {
      nodeId,
      version: latest.version + 1,
      status: "DRAFT",
      title: node?.name ?? "",
      createdById: membershipId,
      ...(options.fileVersion === undefined ? {} : { fileVersion: options.fileVersion }),
    },
  });
}

/** Versión (número de FileVersion) vigente de un archivo controlado; null si no hay o no es controlado. */
export async function publishedFileVersionOf(
  db: Pick<TenantDb, "documentVersion">,
  nodeId: string,
): Promise<number | null> {
  const published = await db.documentVersion.findFirst({
    where: { nodeId, status: "PUBLISHED" },
    select: { fileVersion: true },
  });
  return published?.fileVersion ?? null;
}
