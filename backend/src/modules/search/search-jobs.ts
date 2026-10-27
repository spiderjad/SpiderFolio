// Tareas de la búsqueda de texto completo: extraer el texto de un PDF o DOCX recién subido y
// reindexar lo que ya existía (o quedó sin indexar). El índice en sí lo mantienen los triggers de la
// base; acá solo se alimentan las tablas de las que lee.
import { contentToBlocks } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import type { Readable } from "node:stream";
import type { Logger } from "pino";
import { nodeIdsAfter, nodesWithoutIndex, refreshNodeSearch } from "../../db/raw/search.ts";
import { forTenant } from "../../db/tenant.ts";
import type { Jobs } from "../../jobs/boss.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Storage } from "../../lib/storage.ts";
import {
  EXTRACTABLE_MIMES,
  extractText,
  isExtractable,
  MAX_EXTRACT_BYTES,
} from "./text-extract.ts";

interface Deps {
  prisma: PrismaClient;
  storage: Pick<Storage, "stream">;
  logger: Pick<Logger, "info" | "warn">;
}

async function toBuffer(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += part.length;
    if (size > max) throw new Error("too large");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

/** Extrae y guarda el texto de una versión de un archivo. Un archivo que no se lee queda marcado. */
export async function extractFileText(
  deps: Deps,
  data: { workspaceId: string; nodeId: string; version: number },
): Promise<"OK" | "EMPTY" | "FAILED" | "SKIPPED"> {
  const db = forTenant(deps.prisma, data.workspaceId);
  const file = await db.fileVersion.findFirst({
    where: { nodeId: data.nodeId, version: data.version, purgedAt: null },
    select: { storageKey: true, mimeType: true, sizeBytes: true },
  });
  if (file === null || !isExtractable(file.mimeType)) return "SKIPPED";
  let text = "";
  let status: "OK" | "EMPTY" | "FAILED";
  if (Number(file.sizeBytes) > MAX_EXTRACT_BYTES) {
    status = "FAILED";
  } else {
    try {
      text = await extractText(
        file.mimeType,
        await toBuffer(await deps.storage.stream(file.storageKey), MAX_EXTRACT_BYTES),
      );
      status = text === "" ? "EMPTY" : "OK";
    } catch (error) {
      deps.logger.warn({ err: error, nodeId: data.nodeId }, "No se pudo extraer el texto");
      status = "FAILED";
    }
  }
  const existing = await db.fileText.findFirst({
    where: { nodeId: data.nodeId, version: data.version },
    select: { id: true },
  });
  if (existing === null) {
    await db.fileText.create({
      data: { nodeId: data.nodeId, version: data.version, text, status },
    });
  } else {
    await db.fileText.update({ where: { id: existing.id }, data: { text, status } });
  }
  return status;
}

const BATCH = 200;

/**
 * Reindexa lo pendiente: nodos sin índice, páginas publicadas sin su texto plano y archivos PDF o DOCX
 * sin texto extraído (se encolan). Con `full`, rehace el índice de todos los nodos. Es seguro repetirlo.
 */
export async function reindexSearch(
  deps: Deps & { jobs: Pick<Jobs, "enqueue"> },
  options: { full?: boolean | undefined } = {},
): Promise<{ indexed: number; filled: number; queued: number }> {
  const { prisma } = deps;
  let indexed = 0;
  let filled = 0;
  let queued = 0;

  // 1. Páginas publicadas: su texto plano sale del contenido guardado.
  for (;;) {
    const rows = await prisma.documentVersion.findMany({
      where: { status: "PUBLISHED", textPlain: null, node: { type: "PAGE" } },
      select: { id: true, content: true },
      take: BATCH,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const text =
        row.content === null ? "" : contentToBlocks(row.content as JSONContent).join("\n");
      await prisma.documentVersion.update({ where: { id: row.id }, data: { textPlain: text } });
      filled += 1;
    }
    if (rows.length < BATCH) break;
  }

  // 2. Archivos PDF y DOCX sin texto extraído: una tarea por versión.
  const files = await prisma.fileVersion.findMany({
    where: { mimeType: { in: [...EXTRACTABLE_MIMES] }, purgedAt: null, node: { trashedAt: null } },
    select: { workspaceId: true, nodeId: true, version: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const done = new Set(
    (
      await prisma.fileText.findMany({
        where: { nodeId: { in: [...new Set(files.map((f) => f.nodeId))] } },
        select: { nodeId: true, version: true },
      })
    ).map((t) => `${t.nodeId}:${String(t.version)}`),
  );
  for (const file of files) {
    if (done.has(`${file.nodeId}:${String(file.version)}`)) continue;
    await deps.jobs.enqueue("text-extract", file);
    queued += 1;
  }

  // 3. Nodos sin índice (o todos, si se pidió).
  const refresh = async (id: string) => {
    await refreshNodeSearch(prisma, id);
    indexed += 1;
  };
  if (options.full === true) {
    let after = "";
    for (;;) {
      const ids = await nodeIdsAfter(prisma, after, BATCH);
      if (ids.length === 0) break;
      for (const id of ids) await refresh(id);
      after = ids.at(-1) ?? after;
    }
  } else {
    for (;;) {
      const ids = await nodesWithoutIndex(prisma, BATCH);
      for (const id of ids) await refresh(id);
      if (ids.length < BATCH) break;
    }
  }
  deps.logger.info({ indexed, filled, queued }, "Reindexado de la búsqueda");
  return { indexed, filled, queued };
}
