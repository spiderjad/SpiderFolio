// Recuperación de fragmentos para Bian. Filtros, en este orden:
//   1. la consulta SQL solo mira los espacios que la persona ve y lo compartido con ella, y busca por
//      texto completo y por trigramas (tolera faltas de ortografía y acentos);
//   2. cada candidato se confirma con el motor de acceso (cortes de herencia, accesos vencidos);
//   3. de un documento controlado solo vale la versión vigente (el fragmento tiene que ser de ella);
//   4. varias secciones por documento, con un tope para no llenar la respuesta con uno solo.
// Después se amplía el contexto: del fragmento encontrado se suman el resto de su sección y los
// fragmentos vecinos (el dato que se busca suele estar en la sección de al lado), hasta un tope de
// texto. Los fragmentos seguidos de una misma sección se entregan juntos, como un solo bloque.
import { searchChunks } from "../../db/raw/bian.ts";
import type { NodeType } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { accessActorOf, atLeast, expiryFilter, subjectFilter } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { visibleSpacesWhere } from "../spaces/spaces.service.ts";
import { documentCards, mentionedDocuments } from "./document-cards.ts";
import { fuzzyWords } from "./query-terms.ts";

const BATCH = 40;
const MAX_ROUNDS = 5;
/** Aciertos que se toman de la búsqueda (después se amplía el contexto alrededor de cada uno). */
export const DEFAULT_FRAGMENTS = 10;
export const MAX_PER_NODE = 5;
/** Tope de texto que se le entrega al modelo (≈ 7.500 tokens). */
export const MAX_CONTEXT_CHARS = 30_000;
/** Fragmentos de una misma sección que se suman a un acierto. */
const MAX_SECTION_SIBLINGS = 4;

export interface Fragment {
  chunkId: string;
  nodeId: string;
  nodeType: NodeType;
  /** Título del documento. */
  title: string;
  /** Código del documento controlado; null si no es controlado. */
  code: string | null;
  /** Versión vigente del documento controlado; null si no es controlado. */
  version: number | null;
  heading: string | null;
  /** Número del primer fragmento (si hay varios seguidos de la sección, el de más arriba). */
  seq: number;
  text: string;
  spaceId: string;
  parentId: string | null;
  /** «Ficha del documento»: sus datos de control, no un fragmento de su texto. */
  card?: boolean;
}

interface ChunkRow {
  id: string;
  nodeId: string;
  seq: number;
  version: number | null;
  heading: string | null;
  text: string;
}

export async function retrieveFragments(
  ctx: AdminContext,
  { prisma }: { prisma: PrismaClient },
  query: string,
  options: { limit?: number } = {},
): Promise<Fragment[]> {
  const limit = options.limit ?? DEFAULT_FRAGMENTS;
  const now = new Date();
  const actor = accessActorOf(ctx);
  const [spaces, grants] = await Promise.all([
    ctx.db.space.findMany({
      where: { AND: [visibleSpacesWhere(ctx, now), { archivedAt: null }] },
      select: { id: true },
    }),
    ctx.db.permission.findMany({
      where: { AND: [subjectFilter(actor), expiryFilter(now), { nodeId: { not: null } }] },
      select: { nodeId: true },
    }),
  ]);
  const visibleSpaceIds = spaces.map((space) => space.id);
  const grantedNodeIds = grants.flatMap((grant) => (grant.nodeId === null ? [] : [grant.nodeId]));
  const words = fuzzyWords(query);
  // Documentos cuyo código nombra la pregunta («¿cuándo se revisa el PRC-CAL-001?»).
  const mentioned = await mentionedDocuments(ctx, query);

  const chosen: string[] = [];
  const perNode = new Map<string, number>();
  let offset = 0;
  for (let round = 0; round < MAX_ROUNDS && chosen.length < limit * 2; round += 1) {
    const candidates = await searchChunks(prisma, {
      workspaceId: ctx.tenant.workspaceId,
      query,
      words,
      visibleSpaceIds,
      grantedNodeIds,
      offset,
      limit: BATCH,
    });
    if (candidates.length === 0) break;
    const access = await accessFor(ctx, { nodeIds: [...new Set(candidates.map((c) => c.nodeId))] });
    for (const candidate of candidates) {
      if (!atLeast(access.ofNode(candidate.nodeId), "VIEW")) continue;
      const count = perNode.get(candidate.nodeId) ?? 0;
      if (count >= MAX_PER_NODE) continue;
      perNode.set(candidate.nodeId, count + 1);
      chosen.push(candidate.id);
    }
    if (candidates.length < BATCH) break;
    offset += candidates.length;
  }
  if (chosen.length === 0) return await withCards(ctx, [], mentioned);

  const hitRows: ChunkRow[] = await ctx.db.contentChunk.findMany({
    where: { id: { in: chosen } },
    select: { id: true, nodeId: true, seq: true, version: true, heading: true, text: true },
  });
  const nodes = await ctx.db.node.findMany({
    where: { id: { in: [...new Set(hitRows.map((chunk) => chunk.nodeId))] }, trashedAt: null },
    select: {
      id: true,
      type: true,
      name: true,
      spaceId: true,
      parentId: true,
      controlled: { select: { code: true, publishedVersion: true } },
    },
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  /** Solo la versión vigente: si el índice todavía no se puso al día, el fragmento viejo no sirve. */
  const isCurrent = (chunk: ChunkRow): boolean => {
    const node = nodeById.get(chunk.nodeId);
    if (node === undefined) return false;
    const controlled = node.controlled;
    return (
      controlled === null ||
      (controlled.publishedVersion !== null && chunk.version === controlled.publishedVersion)
    );
  };

  const rowById = new Map(hitRows.map((chunk) => [chunk.id, chunk]));
  const hits = chosen
    .map((id) => rowById.get(id))
    .filter((chunk): chunk is ChunkRow => chunk !== undefined && isCurrent(chunk))
    .slice(0, limit);
  if (hits.length === 0) return await withCards(ctx, [], mentioned);

  // Contexto: el resto de la sección de cada acierto y los fragmentos vecinos (del mismo documento,
  // que ya se confirmó que la persona puede ver).
  const byNode = new Map<string, { seqs: Set<number>; headings: Set<string> }>();
  for (const hit of hits) {
    const entry = byNode.get(hit.nodeId) ?? {
      seqs: new Set<number>(),
      headings: new Set<string>(),
    };
    entry.seqs.add(hit.seq - 1);
    entry.seqs.add(hit.seq + 1);
    if (hit.heading !== null) entry.headings.add(hit.heading);
    byNode.set(hit.nodeId, entry);
  }
  const contextRows: ChunkRow[] = await ctx.db.contentChunk.findMany({
    where: {
      OR: [...byNode].map(([nodeId, entry]) => ({
        nodeId,
        OR: [{ seq: { in: [...entry.seqs] } }, { heading: { in: [...entry.headings] } }],
      })),
    },
    select: { id: true, nodeId: true, seq: true, version: true, heading: true, text: true },
  });

  // Prioridad: los aciertos primero, después el resto de su sección, al final los vecinos.
  const priority = new Map<string, number>();
  hits.forEach((hit, index) => priority.set(hit.id, index));
  const hitSections = new Set(
    hits.flatMap((hit) => (hit.heading === null ? [] : [`${hit.nodeId}\u0000${hit.heading}`])),
  );
  const siblingsTaken = new Map<string, number>();
  const extras = contextRows
    .filter((chunk) => !priority.has(chunk.id) && isCurrent(chunk))
    .sort((a, b) => a.seq - b.seq);
  let rank = hits.length;
  for (const chunk of extras) {
    const section = chunk.heading === null ? null : `${chunk.nodeId}\u0000${chunk.heading}`;
    if (section !== null && hitSections.has(section)) {
      const taken = siblingsTaken.get(section) ?? 0;
      if (taken >= MAX_SECTION_SIBLINGS) continue;
      siblingsTaken.set(section, taken + 1);
      priority.set(chunk.id, rank);
      rank += 1;
    }
  }
  for (const chunk of extras) {
    if (!priority.has(chunk.id)) {
      priority.set(chunk.id, rank);
      rank += 1;
    }
  }

  const pool = [...hits, ...extras.filter((chunk) => priority.has(chunk.id))].sort(
    (a, b) => (priority.get(a.id) ?? 0) - (priority.get(b.id) ?? 0),
  );
  const kept: ChunkRow[] = [];
  let size = 0;
  for (const chunk of pool) {
    if (size + chunk.text.length > MAX_CONTEXT_CHARS && kept.length > 0) continue;
    kept.push(chunk);
    size += chunk.text.length;
  }

  // Orden de lectura: los documentos según su mejor acierto; dentro de cada uno, por posición.
  const nodeOrder = new Map<string, number>();
  for (const chunk of kept) {
    const best = priority.get(chunk.id) ?? 0;
    nodeOrder.set(chunk.nodeId, Math.min(nodeOrder.get(chunk.nodeId) ?? best, best));
  }
  kept.sort(
    (a, b) =>
      (nodeOrder.get(a.nodeId) ?? 0) - (nodeOrder.get(b.nodeId) ?? 0) ||
      (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) ||
      a.seq - b.seq,
  );

  // Fragmentos seguidos de una misma sección: un solo bloque (la sección entera se puede citar).
  const out: Fragment[] = [];
  let previous: { chunk: ChunkRow; index: number } | null = null;
  for (const chunk of kept) {
    const node = nodeById.get(chunk.nodeId);
    if (node === undefined) continue;
    if (
      previous !== null &&
      previous.chunk.nodeId === chunk.nodeId &&
      previous.chunk.seq + 1 === chunk.seq &&
      previous.chunk.heading === chunk.heading
    ) {
      const merged = out[previous.index];
      if (merged !== undefined) merged.text = `${merged.text}\n${chunk.text}`;
      previous = { chunk, index: previous.index };
      continue;
    }
    out.push({
      chunkId: chunk.id,
      nodeId: node.id,
      nodeType: node.type,
      title: node.name,
      code: node.controlled?.code ?? null,
      version: node.controlled === null ? null : chunk.version,
      heading: chunk.heading,
      seq: chunk.seq,
      text: chunk.text,
      spaceId: node.spaceId,
      parentId: node.parentId,
    });
    previous = { chunk, index: out.length - 1 };
  }
  return await withCards(ctx, out, mentioned);
}

/**
 * Suma la «Ficha del documento» de cada documento controlado del contexto, justo antes de su primer
 * fragmento; los documentos que solo nombra la pregunta van primero.
 */
async function withCards(
  ctx: AdminContext,
  fragments: Fragment[],
  mentioned: readonly string[],
): Promise<Fragment[]> {
  const ids = [...new Set([...mentioned, ...fragments.map((fragment) => fragment.nodeId)])];
  const cards = await documentCards(ctx, ids);
  if (cards.size === 0) return fragments;
  const seen = new Set<string>();
  const result: Fragment[] = [];
  for (const id of mentioned) {
    const card = cards.get(id);
    if (card !== undefined && !seen.has(id)) {
      seen.add(id);
      result.push(card);
    }
  }
  for (const fragment of fragments) {
    if (!seen.has(fragment.nodeId)) {
      seen.add(fragment.nodeId);
      const card = cards.get(fragment.nodeId);
      if (card !== undefined) result.push(card);
    }
    result.push(fragment);
  }
  return result;
}
