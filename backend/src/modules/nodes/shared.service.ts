// «Compartido conmigo»: lo que le dieron a la persona (directo o por sus departamentos) en espacios
// que ella no ve. Se lee de a tandas de carpetas, páginas y archivos con acceso dado y se queda con
// los que de verdad ve, sin repetir lo que ya cuelga de algo compartido más arriba.
import type { AccessLevel, NodeType, Prisma } from "../../generated/prisma/client.ts";
import { bytesToJson } from "@spiderfolio/limits";
import { decodeOffsetCursor, encodeOffsetCursor, type Page } from "../../lib/pagination.ts";
import {
  accessActorOf,
  atLeast,
  expiryFilter,
  levelRank,
  subjectFilter,
} from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { SharedQuery } from "./shared.schemas.ts";

export interface SharedItem {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** El nivel con que lo ve la persona. */
  level: AccessLevel;
  /** Quién se lo compartió (null si ya no es parte del workspace) y cuándo. */
  sharedBy: string | null;
  sharedAt: Date;
  expiresAt: Date | null;
  /** A la persona o a uno de sus departamentos. */
  via: "person" | "department";
  /** Todavía no lo abrió (o se lo volvieron a compartir después de abrirlo). */
  isNew: boolean;
}

const BATCH = 60;
const MAX_BATCHES = 10;

export async function listSharedWithMe(
  ctx: AdminContext,
  query: SharedQuery,
): Promise<Pick<Page<SharedItem>, "items" | "nextCursor">> {
  const actor = accessActorOf(ctx);
  const now = new Date();
  const mine: Prisma.PermissionWhereInput = {
    AND: [subjectFilter(actor, { company: false }), expiryFilter(now)],
  };
  const where: Prisma.NodeWhereInput = {
    trashedAt: null,
    permissions: { some: mine },
    ...(query.q === "" ? {} : { name: { contains: query.q, mode: "insensitive" } }),
  };
  let offset = (query.cursor === undefined ? null : decodeOffsetCursor(query.cursor)) ?? 0;
  const items: SharedItem[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await ctx.db.node.findMany({
      where,
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      skip: offset,
      take: BATCH,
      select: {
        id: true,
        name: true,
        type: true,
        spaceId: true,
        parentId: true,
        mimeType: true,
        sizeBytes: true,
        space: { select: { name: true } },
        permissions: {
          where: mine,
          select: {
            level: true,
            createdAt: true,
            expiresAt: true,
            grantedById: true,
            membershipId: true,
          },
        },
      },
    });
    const access = await accessFor(ctx, {
      nodeIds: rows.flatMap((row) => (row.parentId === null ? [row.id] : [row.id, row.parentId])),
      spaceIds: [...new Set(rows.map((row) => row.spaceId))],
    });
    const visible = rows
      .map((row, index) => ({ row, index }))
      // Solo lo que está fuera de los espacios que ya ve, y lo más alto de cada rama compartida.
      .filter(
        ({ row }) =>
          access.ofSpace(row.spaceId) === null &&
          atLeast(access.ofNode(row.id), "VIEW") &&
          (row.parentId === null || access.ofNode(row.parentId) === null),
      );
    const names = new Map(
      (
        await ctx.db.membership.findMany({
          where: {
            id: {
              in: [
                ...new Set(visible.flatMap(({ row }) => row.permissions.map((p) => p.grantedById))),
              ],
            },
          },
          select: { id: true, user: { select: { name: true } } },
        })
      ).map((m) => [m.id, m.user.name]),
    );
    const seen = new Map(
      (visible.length === 0
        ? []
        : await ctx.db.sharedSeen.findMany({
            where: {
              membershipId: ctx.tenant.membershipId,
              nodeId: { in: visible.map(({ row }) => row.id) },
            },
            select: { nodeId: true, seenAt: true },
          })
      ).map((entry) => [entry.nodeId, entry.seenAt]),
    );
    for (const { row, index } of visible) {
      // El acceso que decide es el más alto; a igual nivel, el más reciente.
      const best = [...row.permissions].sort(
        (a, b) =>
          levelRank[b.level] - levelRank[a.level] || b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
      const level = access.ofNode(row.id);
      if (best === undefined || level === null) continue;
      items.push({
        id: row.id,
        name: row.name,
        type: row.type,
        spaceId: row.spaceId,
        spaceName: row.space.name,
        parentId: row.parentId,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes === null ? null : bytesToJson(row.sizeBytes),
        level,
        sharedBy: names.get(best.grantedById) ?? null,
        sharedAt: best.createdAt,
        expiresAt: best.expiresAt,
        via: best.membershipId === null ? "department" : "person",
        isNew: (seen.get(row.id)?.getTime() ?? 0) < best.createdAt.getTime(),
      });
      if (items.length === query.pageSize) {
        return { items, nextCursor: encodeOffsetCursor(offset + index + 1) };
      }
    }
    offset += rows.length;
    if (rows.length < BATCH) return { items, nextCursor: null };
  }
  return { items, nextCursor: encodeOffsetCursor(offset) };
}

/** Cuántos elementos compartidos todavía no abrió (se cuentan hasta 300). */
export async function countUnseenShared(ctx: AdminContext): Promise<{ unseen: number }> {
  let unseen = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const result = await listSharedWithMe(ctx, {
      q: "",
      pageSize: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    unseen += result.items.filter((item) => item.isNew).length;
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return { unseen };
}

/** Marca un elemento compartido como abierto (si la persona lo ve; si no, no pasa nada). */
export async function markSharedSeen(ctx: AdminContext, nodeId: string): Promise<void> {
  const access = await accessFor(ctx, { nodeIds: [nodeId] });
  if (!atLeast(access.ofNode(nodeId), "VIEW")) return;
  const membershipId = ctx.tenant.membershipId;
  const now = new Date();
  await ctx.db.sharedSeen.upsert({
    where: { membershipId_nodeId: { membershipId, nodeId } },
    create: { membershipId, nodeId, seenAt: now },
    update: { seenAt: now },
  });
}
