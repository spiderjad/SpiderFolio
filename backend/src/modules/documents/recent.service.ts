// «Recientes»: los últimos documentos (páginas y archivos) que abrió cada persona. Se guarda solo la
// última visita por persona y documento, y las 50 más nuevas por persona. Es privado: la consulta
// siempre filtra por la membresía de quien pregunta y ninguna ruta lee las visitas de otra.
import type { NodeType } from "../../generated/prisma/client.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { RecentQuery } from "./documents.schemas.ts";

/** Cuántas visitas se conservan por persona. */
export const KEEP_VISITS = 50;
/** Dentro de este margen, abrir de nuevo el mismo documento no vuelve a escribir. */
const THROTTLE_MS = 60_000;

/** Anota que la persona abrió este documento. No rompe la lectura si falla. */
export async function recordVisit(
  ctx: AdminContext,
  node: { id: string; type: NodeType },
): Promise<void> {
  if (node.type === "FOLDER") return;
  const membershipId = ctx.tenant.membershipId;
  try {
    const current = await ctx.db.documentVisit.findFirst({
      where: { membershipId, nodeId: node.id },
      select: { visitedAt: true },
    });
    if (current !== null && Date.now() - current.visitedAt.getTime() < THROTTLE_MS) return;
    const now = new Date();
    await ctx.db.documentVisit.upsert({
      where: { membershipId_nodeId: { membershipId, nodeId: node.id } },
      create: { membershipId, nodeId: node.id, visitedAt: now },
      update: { visitedAt: now },
    });
    // Se conservan las 50 más nuevas.
    const old = await ctx.db.documentVisit.findMany({
      where: { membershipId },
      orderBy: [{ visitedAt: "desc" }, { id: "asc" }],
      skip: KEEP_VISITS,
      select: { id: true },
    });
    if (old.length > 0) {
      await ctx.db.documentVisit.deleteMany({
        where: { membershipId, id: { in: old.map((visit) => visit.id) } },
      });
    }
  } catch {
    // Los recientes son un detalle: nunca impiden abrir un documento.
  }
}

export interface RecentItem {
  node: {
    id: string;
    name: string;
    type: NodeType;
    spaceId: string;
    spaceName: string;
    mimeType: string | null;
  };
  /** Código si es un documento controlado. */
  code: string | null;
  visitedAt: Date;
}

/** Mis documentos recientes: solo los míos, y solo los que todavía veo. */
export async function recentDocuments(
  ctx: AdminContext,
  query: RecentQuery,
): Promise<Page<RecentItem>> {
  const visits = await ctx.db.documentVisit.findMany({
    where: { membershipId: ctx.tenant.membershipId },
    orderBy: [{ visitedAt: "desc" }, { id: "asc" }],
    take: KEEP_VISITS,
    select: { nodeId: true, visitedAt: true },
  });
  const nodeIds = visits.map((visit) => visit.nodeId);
  const [nodes, access, codes] = await Promise.all([
    ctx.db.node.findMany({
      where: { id: { in: nodeIds }, trashedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        spaceId: true,
        mimeType: true,
        space: { select: { name: true } },
      },
    }),
    accessFor(ctx, { nodeIds }),
    ctx.db.controlledDocument.findMany({
      where: { nodeId: { in: nodeIds } },
      select: { nodeId: true, code: true },
    }),
  ]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const codeOf = new Map(codes.map((row) => [row.nodeId, row.code]));
  const items = visits.flatMap((visit): RecentItem[] => {
    const node = byId.get(visit.nodeId);
    if (node === undefined || !atLeast(access.ofNode(node.id), "VIEW")) return [];
    return [
      {
        node: {
          id: node.id,
          name: node.name,
          type: node.type,
          spaceId: node.spaceId,
          spaceName: node.space.name,
          mimeType: node.mimeType,
        },
        code: codeOf.get(node.id) ?? null,
        visitedAt: visit.visitedAt,
      },
    ];
  });
  const { skip, take } = offsetArgs(query);
  return pageOf(items.slice(skip, skip + take), items.length, query);
}
