// Comparar versiones de un documento controlado (9C.4). Páginas: se comparan sus bloques de texto y,
// dentro de un bloque cambiado, palabra por palabra. Archivos: por ahora solo los datos de cada
// versión (el texto de PDF, DOCX y XLSX se compara más adelante). Las versiones en borrador o en
// revisión las ve quien edita el documento o quien tiene que aprobarlo; el resto, solo las
// publicadas y obsoletas.
import { contentToBlocks } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import { diffArrays, diffWords } from "diff";
import type { DocStatus, NodeType } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { contentMessages } from "../../i18n/index.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { CompareQuery } from "./documents.schemas.ts";

/** Tope de bloques que se comparan (un documento enorme no se compara entero). */
const MAX_BLOCKS = 5000;

export interface WordChange {
  op: "same" | "add" | "remove";
  text: string;
}

export type DiffBlock =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "changed"; words: WordChange[] };

export interface CompareSide {
  version: number;
  status: DocStatus;
  title: string;
  at: Date | null;
}

export interface FileSide {
  fileName: string;
  sizeBytes: number;
  checksum: string;
  uploadedAt: Date;
}

export interface Comparison {
  type: NodeType;
  from: CompareSide | null;
  to: CompareSide;
  /** Páginas. */
  blocks: DiffBlock[];
  stats: { added: number; removed: number; changed: number };
  truncated: boolean;
  /** Archivos: datos de cada versión; el texto no se compara todavía. */
  files: { from: FileSide | null; to: FileSide | null } | null;
}

function words(before: string, after: string): WordChange[] {
  return diffWords(before, after).map((part) => ({
    op: part.added ? "add" : part.removed ? "remove" : "same",
    text: part.value,
  }));
}

/** Compara dos listas de bloques: iguales, agregados, quitados y cambiados (con sus palabras). */
export function diffBlocks(
  before: string[],
  after: string[],
): { blocks: DiffBlock[]; stats: Comparison["stats"] } {
  const blocks: DiffBlock[] = [];
  const stats = { added: 0, removed: 0, changed: 0 };
  const parts = diffArrays(before, after);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) continue;
    if (!part.added && !part.removed) {
      for (const text of part.value) blocks.push({ kind: "same", text });
      continue;
    }
    // Un bloque quitado seguido de uno agregado es, en general, el mismo bloque editado.
    const next = parts[index + 1];
    if (part.removed && next?.added === true) {
      const pairs = Math.min(part.value.length, next.value.length);
      for (let i = 0; i < pairs; i += 1) {
        blocks.push({ kind: "changed", words: words(part.value[i] ?? "", next.value[i] ?? "") });
        stats.changed += 1;
      }
      for (const text of part.value.slice(pairs)) {
        blocks.push({ kind: "removed", text });
        stats.removed += 1;
      }
      for (const text of next.value.slice(pairs)) {
        blocks.push({ kind: "added", text });
        stats.added += 1;
      }
      index += 1;
      continue;
    }
    for (const text of part.value) {
      blocks.push({ kind: part.added ? "added" : "removed", text });
      if (part.added) stats.added += 1;
      else stats.removed += 1;
    }
  }
  return { blocks, stats };
}

/**
 * «Cambios desde tu revisión»: la versión en revisión contra el texto que quien consulta revisó la
 * última vez (la ronda anterior de esta misma versión, que pidió cambios). Solo páginas.
 */
export async function compareSinceReview(ctx: AdminContext, nodeId: string): Promise<Comparison> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, type: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  if (node.type !== "PAGE")
    throw new AppError("BAD_REQUEST", { message: contentMessages.compareOnlyPages });
  const latest = await ctx.db.documentVersion.findFirst({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: { version: true, status: true, title: true, content: true, submittedAt: true },
  });
  if (latest?.status !== "IN_REVIEW" || latest.submittedAt === null) {
    throw new AppError("CONFLICT", { message: contentMessages.notInReview });
  }
  const previous = await ctx.db.approval.findFirst({
    where: {
      nodeId,
      version: latest.version,
      approverId: ctx.tenant.membershipId,
      decision: { not: null },
      round: { lt: latest.submittedAt },
    },
    orderBy: { round: "desc" },
    select: { snapshot: true, round: true, decidedAt: true },
  });
  if (previous?.snapshot == null) throw notFound();
  const blocksOf = (doc: unknown): string[] =>
    doc === null || doc === undefined ? [] : contentToBlocks(doc);
  const before = blocksOf(previous.snapshot);
  const after = blocksOf(latest.content);
  const truncated = before.length > MAX_BLOCKS || after.length > MAX_BLOCKS;
  const result = diffBlocks(before.slice(0, MAX_BLOCKS), after.slice(0, MAX_BLOCKS));
  return {
    type: node.type,
    from: {
      version: latest.version,
      status: "IN_REVIEW",
      title: latest.title,
      at: previous.decidedAt ?? previous.round,
    },
    to: {
      version: latest.version,
      status: "IN_REVIEW",
      title: latest.title,
      at: latest.submittedAt,
    },
    blocks: result.blocks,
    stats: result.stats,
    truncated,
    files: null,
  };
}

export async function compareVersions(
  ctx: AdminContext,
  nodeId: string,
  query: CompareQuery,
): Promise<Comparison> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, type: true },
  });
  if (node === null) throw notFound();
  const level = requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  const controlled = await ctx.db.controlledDocument.findFirst({
    where: { nodeId },
    select: { publishedVersion: true },
  });
  if (controlled === null) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.notControlled });
  }
  const versions = await ctx.db.documentVersion.findMany({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: {
      version: true,
      status: true,
      title: true,
      content: true,
      fileVersion: true,
      publishedAt: true,
      submittedAt: true,
      createdAt: true,
    },
  });
  const latest = versions[0];
  if (latest === undefined) throw notFound();
  const to = query.to === undefined ? latest : versions.find((v) => v.version === query.to);
  // Por defecto, contra la vigente; si no la hay (o es la misma), contra la anterior.
  const from =
    query.from === undefined
      ? (versions.find(
          (v) => v.version === controlled.publishedVersion && v.version !== to?.version,
        ) ?? versions.find((v) => to !== undefined && v.version === to.version - 1))
      : versions.find((v) => v.version === query.from);
  if (to === undefined || (query.from !== undefined && from === undefined)) throw notFound();

  // Quién ve cada versión: las publicadas y obsoletas, todos; el resto, quien edita o aprueba.
  const approver =
    (await ctx.db.approval.count({ where: { nodeId, approverId: ctx.tenant.membershipId } })) > 0;
  const mayDraft = atLeast(level, "EDIT") || approver;
  for (const side of [from, to]) {
    if (
      side !== undefined &&
      side.status !== "PUBLISHED" &&
      side.status !== "OBSOLETE" &&
      !mayDraft
    ) {
      throw forbidden();
    }
  }

  const sideOf = (v: typeof to): CompareSide => ({
    version: v.version,
    status: v.status,
    title: v.title,
    at: v.publishedAt ?? v.submittedAt ?? v.createdAt,
  });

  if (node.type === "FILE") {
    const file = async (fileVersion: number | null): Promise<FileSide | null> => {
      if (fileVersion === null) return null;
      const row = await ctx.db.fileVersion.findFirst({
        where: { nodeId, version: fileVersion },
        select: { fileName: true, sizeBytes: true, checksum: true, createdAt: true },
      });
      return row === null
        ? null
        : {
            fileName: row.fileName,
            sizeBytes: Number(row.sizeBytes),
            checksum: row.checksum,
            uploadedAt: row.createdAt,
          };
    };
    return {
      type: node.type,
      from: from === undefined ? null : sideOf(from),
      to: sideOf(to),
      blocks: [],
      stats: { added: 0, removed: 0, changed: 0 },
      truncated: false,
      files: {
        from: from === undefined ? null : await file(from.fileVersion),
        to: await file(to.fileVersion),
      },
    };
  }

  // El borrador de trabajo de una página es el texto en edición, no una instantánea.
  const page = await ctx.db.pageContent.findFirst({ where: { nodeId }, select: { content: true } });
  const blocksOf = (v: typeof to | undefined): string[] => {
    if (v === undefined) return [];
    const doc = v.status === "DRAFT" && v.version === latest.version ? page?.content : v.content;
    return doc === null || doc === undefined ? [] : contentToBlocks(doc as JSONContent);
  };
  const before = blocksOf(from);
  const after = blocksOf(to);
  const truncated = before.length > MAX_BLOCKS || after.length > MAX_BLOCKS;
  const result = diffBlocks(before.slice(0, MAX_BLOCKS), after.slice(0, MAX_BLOCKS));
  return {
    type: node.type,
    from: from === undefined ? null : sideOf(from),
    to: sideOf(to),
    blocks: result.blocks,
    stats: result.stats,
    truncated,
    files: null,
  };
}
