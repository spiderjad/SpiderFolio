// Folders the module creates in its own space (a supplier's, a product's, the sampling plan's), by the
// system the first time they're needed; an existing folder with the same name is reused.
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { lastPosition } from "../nodes/nodes.service.ts";

export async function ensureFolder(
  ctx: AdminContext,
  spaceId: string,
  parentId: string | null,
  wanted: string,
): Promise<string> {
  const clean = cleanName(wanted.replace(/[/\\]/gu, "-")).slice(0, 120) || "-";
  const existing = await ctx.db.node.findFirst({
    where: { spaceId, parentId, type: "FOLDER", nameKey: nameKeyOf(clean), trashedAt: null },
    select: { id: true },
  });
  if (existing !== null) return existing.id;
  const created = await ctx.db.node.create({
    data: {
      spaceId,
      parentId,
      type: "FOLDER",
      name: clean,
      nameKey: nameKeyOf(clean),
      position: await lastPosition(ctx, spaceId, parentId),
      createdById: ctx.tenant.membershipId,
      updatedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "folder.create",
    entityType: "Node",
    entityId: created.id,
    metadata: { spaceId, parentId, name: clean },
  });
  return created.id;
}

/** A folder that is still alive (not in the trash), or null. */
export async function liveFolder(
  ctx: AdminContext,
  id: string | null,
): Promise<{ id: string; spaceId: string } | null> {
  if (id === null) return null;
  return await ctx.db.node.findFirst({
    where: { id, type: "FOLDER", trashedAt: null },
    select: { id: true, spaceId: true },
  });
}
