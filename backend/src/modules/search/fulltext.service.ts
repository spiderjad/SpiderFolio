// Búsqueda de texto completo: título, código y contenido (páginas y el texto de PDF y DOCX), con la
// palabra resaltada en un fragmento, ordenada por relevancia y paginada. El permiso entra en la
// consulta (espacios que la persona ve y lo compartido con ella); cada resultado se confirma además con
// el motor de acceso, así un corte de herencia o un acceso vencido nunca se cuela.
import { highlightNodes, MARK_END, MARK_START, searchCandidates } from "../../db/raw/search.ts";
import type { NodeType } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { decodeOffsetCursor, encodeOffsetCursor } from "../../lib/pagination.ts";
import { accessActorOf, atLeast, expiryFilter, subjectFilter } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { visibleSpacesWhere } from "../spaces/spaces.service.ts";
import type { FullTextQuery } from "./search.schemas.ts";

/** Cuántos candidatos se piden por vuelta y cuántas vueltas como máximo por página. */
const BATCH = 40;
const MAX_ROUNDS = 8;

/** Un fragmento de texto, con o sin la palabra buscada. */
export interface Segment {
  text: string;
  match: boolean;
}

export interface FullTextHit {
  id: string;
  type: NodeType;
  name: Segment[];
  snippet: Segment[];
  code: string | null;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
}

export interface FullTextPage {
  items: FullTextHit[];
  nextCursor: string | null;
}

/** Parte un texto con marcas en trozos; lo que no es marca se queda tal cual (el cliente lo escapa). */
export function segmentsOf(marked: string): Segment[] {
  const out: Segment[] = [];
  let match = false;
  let buffer = "";
  for (const char of marked) {
    if (char === MARK_START || char === MARK_END) {
      if (buffer !== "") out.push({ text: buffer, match });
      buffer = "";
      match = char === MARK_START;
    } else {
      buffer += char;
    }
  }
  if (buffer !== "") out.push({ text: buffer, match });
  return out;
}

export async function fullTextSearch(
  ctx: AdminContext,
  { prisma }: { prisma: PrismaClient },
  query: FullTextQuery,
): Promise<FullTextPage> {
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

  let offset = (query.cursor === undefined ? null : decodeOffsetCursor(query.cursor)) ?? 0;
  const chosen: { id: string; at: number }[] = [];
  let exhausted = false;
  for (let round = 0; round < MAX_ROUNDS && chosen.length < query.pageSize; round += 1) {
    const candidates = await searchCandidates(prisma, {
      workspaceId: ctx.tenant.workspaceId,
      query: query.q,
      visibleSpaceIds,
      grantedNodeIds,
      offset,
      limit: BATCH,
    });
    if (candidates.length === 0) {
      exhausted = true;
      break;
    }
    const access = await accessFor(ctx, { nodeIds: candidates.map((c) => c.id) });
    for (const [index, candidate] of candidates.entries()) {
      if (chosen.length >= query.pageSize) break;
      if (atLeast(access.ofNode(candidate.id), "VIEW")) {
        chosen.push({ id: candidate.id, at: offset + index + 1 });
      }
    }
    // La próxima página sigue justo después del último candidato que se usó.
    const consumed =
      chosen.length >= query.pageSize ? (chosen.at(-1)?.at ?? offset) : offset + candidates.length;
    if (chosen.length < query.pageSize && candidates.length < BATCH) {
      exhausted = true;
      offset = consumed;
      break;
    }
    offset = consumed;
  }

  const ids = chosen.map((c) => c.id);
  const [rows, marks] = await Promise.all([
    ctx.db.node.findMany({
      where: { id: { in: ids }, trashedAt: null },
      select: {
        id: true,
        type: true,
        name: true,
        spaceId: true,
        parentId: true,
        space: { select: { name: true } },
        controlled: { select: { code: true } },
      },
    }),
    highlightNodes(prisma, ctx.tenant.workspaceId, ids, query.q),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids.flatMap((id): FullTextHit[] => {
    const row = byId.get(id);
    if (row === undefined) return [];
    const mark = marks.get(id);
    return [
      {
        id,
        type: row.type,
        name: mark === undefined ? [{ text: row.name, match: false }] : segmentsOf(mark.title),
        snippet: mark === undefined ? [] : segmentsOf(mark.snippet),
        code: row.controlled?.code ?? null,
        spaceId: row.spaceId,
        spaceName: row.space.name,
        parentId: row.parentId,
      },
    ];
  });
  return { items, nextCursor: exhausted ? null : encodeOffsetCursor(offset) };
}
