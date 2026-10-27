// Indexado de Bian: deja en `ContentChunk` los fragmentos de lo que está vigente. Solo se indexa:
//   · documento controlado: la versión PUBLISHED (nunca borradores ni versiones obsoletas);
//   · página sin control: su contenido actual; archivo sin control: el texto de su versión actual.
// Nada de lo que está en la papelera. Reescribe solo los fragmentos cuyo hash cambió.
import type { JSONContent } from "@tiptap/core";
import type { Logger } from "pino";
import { claimDirtyNodes, markAllNodesDirty, markNodeDirty } from "../../db/raw/bian.ts";
import { forTenant } from "../../db/tenant.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import {
  chunkSections,
  diffChunks,
  sectionsOfDoc,
  sectionsOfPlainText,
  type Chunk,
  type Section,
} from "./chunker.ts";

/** Tope de fragmentos por documento (≈ 900.000 caracteres): lo que sobra no se indexa. */
export const MAX_CHUNKS_PER_NODE = 500;
const BATCH = 100;

interface Deps {
  prisma: PrismaClient;
  logger: Pick<Logger, "info" | "warn">;
}

interface Source {
  version: number | null;
  sections: Section[];
}

const isDoc = (value: unknown): value is JSONContent =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Qué texto está vigente hoy para el nodo; null si no hay nada que indexar. */
export async function sourceOf(
  db: ReturnType<typeof forTenant>,
  nodeId: string,
): Promise<Source | null> {
  const node = await db.node.findFirst({
    where: { id: nodeId },
    select: { type: true, trashedAt: true, currentVersion: true },
  });
  if (node === null || node.trashedAt !== null || node.type === "FOLDER") return null;

  const controlled = await db.controlledDocument.findFirst({
    where: { nodeId },
    select: { publishedVersion: true },
  });
  if (controlled !== null) {
    // Sin versión vigente (borrador u obsoleto) no hay nada para Bian.
    if (controlled.publishedVersion === null) return null;
    const version = await db.documentVersion.findFirst({
      where: { nodeId, version: controlled.publishedVersion, status: "PUBLISHED" },
      select: { content: true, fileVersion: true },
    });
    if (version === null) return null;
    if (node.type === "PAGE") {
      return isDoc(version.content)
        ? { version: controlled.publishedVersion, sections: sectionsOfDoc(version.content) }
        : null;
    }
    if (version.fileVersion === null) return null;
    const file = await db.fileText.findFirst({
      where: { nodeId, version: version.fileVersion, status: "OK" },
      select: { text: true },
    });
    return file === null
      ? null
      : { version: controlled.publishedVersion, sections: sectionsOfPlainText(file.text) };
  }

  if (node.type === "PAGE") {
    const page = await db.pageContent.findFirst({ where: { nodeId }, select: { content: true } });
    return page !== null && isDoc(page.content)
      ? { version: null, sections: sectionsOfDoc(page.content) }
      : null;
  }
  const file = await db.fileText.findFirst({
    where: { nodeId, version: node.currentVersion, status: "OK" },
    select: { text: true },
  });
  return file === null ? null : { version: null, sections: sectionsOfPlainText(file.text) };
}

/** Reindexa un nodo. Devuelve cuántos fragmentos escribió. Seguro de repetir. */
export async function indexNode(
  deps: Pick<Deps, "prisma">,
  data: { workspaceId: string; nodeId: string },
): Promise<{ written: number; total: number }> {
  const db = forTenant(deps.prisma, data.workspaceId);
  const source = await sourceOf(db, data.nodeId);
  const chunks: Chunk[] =
    source === null ? [] : chunkSections(source.sections).slice(0, MAX_CHUNKS_PER_NODE);
  const existing = await db.contentChunk.findMany({
    where: { nodeId: data.nodeId },
    select: { id: true, seq: true, contentHash: true, version: true },
  });
  const version = source?.version ?? null;
  // Si cambió la versión vigente, todos los fragmentos se reescriben (llevan su número de versión).
  const versionChanged = existing.some((chunk) => chunk.version !== version);
  const { write, deleteFromSeq } = versionChanged
    ? { write: chunks, deleteFromSeq: chunks.length }
    : diffChunks(existing, chunks);
  if (write.length === 0 && deleteFromSeq === null) return { written: 0, total: chunks.length };

  const idBySeq = new Map(existing.map((chunk) => [chunk.seq, chunk.id]));
  await db.$transaction(async (tx) => {
    if (deleteFromSeq !== null) {
      await tx.contentChunk.deleteMany({
        where: { nodeId: data.nodeId, seq: { gte: deleteFromSeq } },
      });
    }
    for (const chunk of write) {
      const fields = {
        version,
        heading: chunk.heading,
        text: chunk.text,
        contentHash: chunk.contentHash,
        tokens: chunk.tokens,
      };
      const id = idBySeq.get(chunk.seq);
      if (id === undefined || (deleteFromSeq !== null && chunk.seq >= deleteFromSeq)) {
        await tx.contentChunk.create({
          data: { nodeId: data.nodeId, seq: chunk.seq, ...fields },
        });
      } else {
        await tx.contentChunk.update({ where: { id }, data: fields });
      }
    }
  });
  return { written: write.length, total: chunks.length };
}

/**
 * Vacía la cola de nodos sucios (los marcan los triggers de la base). Un nodo que falla vuelve a la
 * cola y se reintenta en la próxima vuelta; un fallo no frena a los demás.
 */
export async function drainBianIndex(
  deps: Deps,
  options: { maxNodes?: number } = {},
): Promise<{ nodes: number; failed: number }> {
  const maxNodes = options.maxNodes ?? 2000;
  let nodes = 0;
  let failed = 0;
  while (nodes + failed < maxNodes) {
    const batch = await claimDirtyNodes(deps.prisma, Math.min(BATCH, maxNodes - nodes - failed));
    if (batch.length === 0) break;
    for (const node of batch) {
      try {
        await indexNode(deps, node);
        nodes += 1;
      } catch (error) {
        failed += 1;
        deps.logger.warn({ err: error, nodeId: node.nodeId }, "Bian: no se pudo indexar un nodo");
        await markNodeDirty(deps.prisma, node);
      }
    }
    // Si todo lo del lote falló, no se insiste en la misma vuelta.
    if (failed >= batch.length && nodes === 0) break;
  }
  if (nodes + failed > 0) deps.logger.info({ nodes, failed }, "Bian: indexado");
  return { nodes, failed };
}

/** Primer encendido: si todavía no hay fragmentos, se marcan todos los nodos para indexarlos. */
export async function backfillBianIndexIfEmpty(deps: Deps): Promise<number> {
  const any = await deps.prisma.contentChunk.findFirst({ select: { id: true } });
  if (any !== null) return 0;
  const marked = await markAllNodesDirty(deps.prisma);
  deps.logger.info({ marked }, "Bian: primer indexado de lo existente");
  return marked;
}
