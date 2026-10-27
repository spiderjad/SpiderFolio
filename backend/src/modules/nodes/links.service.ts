// Enlaces internos y archivos incrustados en las páginas: buscar a qué enlazar y resolver los ids
// que guarda el documento. Ambos respetan los permisos de quien pregunta: lo que no ve no aparece
// en la búsqueda y, al resolver, se muestra como «Documento sin acceso» sin revelar su nombre.
import type { NodeType, Prisma } from "../../generated/prisma/client.ts";
import { decodeOffsetCursor, encodeOffsetCursor, type Page } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { ResolveNodesInput, SearchNodesQuery } from "./links.schemas.ts";

/** Imágenes y PDF: lo único que una página puede mostrar incrustado. */
const EMBEDDABLE_MIME = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/u;

export interface NodeRef {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
  mimeType: string | null;
}

const refSelect = {
  id: true,
  name: true,
  type: true,
  spaceId: true,
  parentId: true,
  mimeType: true,
  space: { select: { name: true } },
} as const;

type RefRow = Prisma.NodeGetPayload<{ select: typeof refSelect }>;

const toRef = (row: RefRow): NodeRef => ({
  id: row.id,
  name: row.name,
  type: row.type,
  spaceId: row.spaceId,
  spaceName: row.space.name,
  parentId: row.parentId,
  mimeType: row.mimeType,
});

const BATCH = 60;
const MAX_BATCHES = 10;

/**
 * Páginas y archivos que la persona ve, por nombre. Se leen por tandas y se descartan los que no ve:
 * nunca se trae todo, y el cursor sigue desde donde quedó la búsqueda.
 */
export async function searchNodes(
  ctx: AdminContext,
  query: SearchNodesQuery,
): Promise<Pick<Page<NodeRef>, "items" | "nextCursor">> {
  const where: Prisma.NodeWhereInput = {
    trashedAt: null,
    type: query.kind === "embed" ? "FILE" : { in: ["PAGE", "FILE"] },
    ...(query.q === "" ? {} : { name: { contains: query.q, mode: "insensitive" } }),
    ...(query.kind === "embed"
      ? {
          mimeType: {
            in: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"],
          },
        }
      : {}),
  };
  let offset = (query.cursor === undefined ? null : decodeOffsetCursor(query.cursor)) ?? 0;
  const items: NodeRef[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await ctx.db.node.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: offset,
      take: BATCH,
      select: refSelect,
    });
    const access = await accessFor(ctx, { nodeIds: rows.map((row) => row.id) });
    for (const [index, row] of rows.entries()) {
      if (!atLeast(access.ofNode(row.id), "VIEW")) continue;
      if (query.kind === "embed" && !EMBEDDABLE_MIME.test(row.mimeType ?? "")) continue;
      items.push(toRef(row));
      if (items.length === query.pageSize) {
        return { items, nextCursor: encodeOffsetCursor(offset + index + 1) };
      }
    }
    offset += rows.length;
    if (rows.length < BATCH) return { items, nextCursor: null };
  }
  return { items, nextCursor: encodeOffsetCursor(offset) };
}

export type ResolvedNode = { id: string; accessible: false } | (NodeRef & { accessible: true });

/** Los ids de un documento: cada uno con sus datos si la persona lo ve, o sin ellos si no. */
export async function resolveNodes(
  ctx: AdminContext,
  input: ResolveNodesInput,
): Promise<{ items: ResolvedNode[] }> {
  const ids = [...new Set(input.ids)];
  const rows = await ctx.db.node.findMany({
    where: { id: { in: ids }, trashedAt: null },
    select: refSelect,
  });
  const access = await accessFor(ctx, { nodeIds: rows.map((row) => row.id) });
  const visible = new Map(
    rows.filter((row) => atLeast(access.ofNode(row.id), "VIEW")).map((row) => [row.id, row]),
  );
  return {
    items: ids.map((id): ResolvedNode => {
      const row = visible.get(id);
      return row === undefined ? { id, accessible: false } : { ...toRef(row), accessible: true };
    }),
  };
}
