// «Compartido por mí»: los accesos que dio la persona (y, si es jefe o subjefe, los que dieron las
// personas de su área), con quién, a qué nivel, desde cuándo y hasta cuándo. Quitar un acceso es
// DELETE /permissions/:id; acá solo se dice si la persona puede hacerlo.
import { contentMessages } from "../../i18n/index.ts";
import type { AccessLevel, NodeType, Prisma } from "../../generated/prisma/client.ts";
import { decodeOffsetCursor, encodeOffsetCursor, type Page } from "../../lib/pagination.ts";
import { atLeast, expiryFilter } from "../access/access.ts";
import { accessFor, canManageSpace } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { SharedQuery } from "./shared.schemas.ts";

export interface SharedByMeItem {
  /** Id del acceso (para quitarlo). */
  id: string;
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
    spaceName: string;
  };
  subject: { type: "person" | "department" | "company"; id: string; name: string };
  level: AccessLevel;
  includeSubareas: boolean;
  sharedAt: Date;
  expiresAt: Date | null;
  grantedBy: string | null;
  /** Lo dio la propia persona (y no alguien de su área). */
  mine: boolean;
  /** Puede gestionar lo compartido: puede quitar el acceso. */
  canRemove: boolean;
}

const BATCH = 50;
const MAX_BATCHES = 10;

export async function listSharedByMe(
  ctx: AdminContext,
  query: SharedQuery,
): Promise<Pick<Page<SharedByMeItem>, "items" | "nextCursor">> {
  const me = ctx.tenant.membershipId;
  // Jefes y subjefes ven también lo que dio su área (el departamento que lideran y sus subáreas).
  const led = [...ctx.tenant.ledScope.keys()];
  const area =
    led.length === 0
      ? []
      : (
          await ctx.db.departmentMember.findMany({
            where: { departmentId: { in: led } },
            select: { membershipId: true },
          })
        ).map((member) => member.membershipId);
  const grantors = [...new Set([me, ...area])];
  const search: Prisma.PermissionWhereInput =
    query.q === ""
      ? {}
      : {
          OR: [
            { node: { name: { contains: query.q, mode: "insensitive" } } },
            { space: { name: { contains: query.q, mode: "insensitive" } } },
            { department: { name: { contains: query.q, mode: "insensitive" } } },
            { membership: { user: { name: { contains: query.q, mode: "insensitive" } } } },
          ],
        };
  const where: Prisma.PermissionWhereInput = {
    AND: [
      { grantedById: { in: grantors } },
      expiryFilter(new Date()),
      { OR: [{ spaceId: { not: null } }, { node: { trashedAt: null } }] },
      search,
    ],
  };
  let offset = (query.cursor === undefined ? null : decodeOffsetCursor(query.cursor)) ?? 0;
  const items: SharedByMeItem[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await ctx.db.permission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: BATCH,
      select: {
        id: true,
        level: true,
        includeSubareas: true,
        createdAt: true,
        expiresAt: true,
        grantedById: true,
        membershipId: true,
        everyone: true,
        space: { select: { id: true, name: true } },
        node: {
          select: {
            id: true,
            name: true,
            type: true,
            spaceId: true,
            space: { select: { name: true } },
          },
        },
        department: { select: { id: true, name: true } },
        membership: { select: { id: true, user: { select: { name: true } } } },
      },
    });
    const access = await accessFor(ctx, {
      nodeIds: rows.flatMap((row) => (row.node === null ? [] : [row.node.id])),
      spaceIds: rows.flatMap((row) => (row.space === null ? [] : [row.space.id])),
    });
    const grantorNames = new Map(
      (
        await ctx.db.membership.findMany({
          where: { id: { in: [...new Set(rows.map((row) => row.grantedById))] } },
          select: { id: true, user: { select: { name: true } } },
        })
      ).map((member) => [member.id, member.user.name]),
    );
    for (const [index, row] of rows.entries()) {
      // El acceso que se da a sí misma quien crea un espacio no es «compartir».
      if (row.membershipId !== null && row.membershipId === row.grantedById) continue;
      const subject = row.everyone
        ? { type: "company" as const, id: "", name: contentMessages.companyName }
        : row.membership !== null
          ? { type: "person" as const, id: row.membership.id, name: row.membership.user.name }
          : row.department !== null
            ? { type: "department" as const, id: row.department.id, name: row.department.name }
            : null;
      const target =
        row.node !== null
          ? {
              type: "node" as const,
              id: row.node.id,
              name: row.node.name,
              nodeType: row.node.type,
              spaceId: row.node.spaceId,
              spaceName: row.node.space.name,
            }
          : row.space !== null
            ? {
                type: "space" as const,
                id: row.space.id,
                name: row.space.name,
                nodeType: null,
                spaceId: row.space.id,
                spaceName: row.space.name,
              }
            : null;
      if (subject === null || target === null) continue;
      items.push({
        id: row.id,
        target,
        subject,
        level: row.level,
        includeSubareas: row.includeSubareas,
        sharedAt: row.createdAt,
        expiresAt: row.expiresAt,
        grantedBy: grantorNames.get(row.grantedById) ?? null,
        mine: row.grantedById === me,
        canRemove:
          target.type === "node"
            ? atLeast(access.ofNode(target.id), "MANAGE")
            : canManageSpace(ctx, access.ofSpace(target.id)),
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
