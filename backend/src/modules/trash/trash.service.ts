// Papelera (docs/spec/archivos.md): borrar manda un nodo (y todo su subárbol) a la papelera por 30
// días; se puede restaurar o eliminar para siempre. Al eliminar, la fila y sus versiones se borran
// en una transacción, la cuota se libera y un job borra los objetos de S3 (con reintentos). Pasados
// 30 días, un job diario hace lo mismo. Borrar y restaurar piden MANAGE (8.1).
import { bytesToJson } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type { NodeType, Prisma } from "../../generated/prisma/client.ts";
import { contentMessages } from "../../i18n/index.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf, numberedName } from "../../lib/names.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { accessFor, levelOfNode, levelOfSpace, requireLevel } from "../access/access-context.ts";
import { audit, type AuditEntry } from "../audit/audit.service.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { MAX_TREE_DEPTH } from "../nodes/nodes.service.ts";
import type { ListTrashQuery } from "./trash.schemas.ts";

/** Cuánto vive un nodo en la papelera. */
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 1000;
/** Claves por job de borrado de objetos. */
const KEYS_PER_JOB = 200;
/** Raíces de papelera que se consideran por pedido (la retención las mantiene pocas). */
const MAX_TRASH_ROOTS = 500;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** El nodo y todo lo que cuelga de él (por niveles, una consulta por nivel). */
async function subtree(
  db: Pick<TenantDb, "node">,
  rootId: string,
  where: Prisma.NodeWhereInput,
): Promise<{ id: string; type: NodeType; parentId: string | null }[]> {
  const root = await db.node.findFirst({
    where: { id: rootId },
    select: { id: true, type: true, parentId: true },
  });
  if (root === null) return [];
  const all = [root];
  let frontier = [rootId];
  for (let depth = 0; frontier.length > 0 && depth <= MAX_TREE_DEPTH + 1; depth++) {
    const next: typeof all = [];
    for (const ids of chunks(frontier, CHUNK)) {
      next.push(
        ...(await db.node.findMany({
          where: { parentId: { in: ids }, ...where },
          select: { id: true, type: true, parentId: true },
        })),
      );
    }
    all.push(...next);
    frontier = next.map((node) => node.id);
  }
  return all;
}

// ─── Mandar a la papelera ────────────────────────────────────────────────────────────────

export async function trashNode(ctx: AdminContext, id: string): Promise<void> {
  const node = await ctx.db.node.findFirst({
    where: { id, trashedAt: null },
    select: { id: true, spaceId: true, type: true, name: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, id), "MANAGE");
  await assertSpaceWritable(ctx, node.spaceId);
  const now = new Date();
  await ctx.db.$transaction(async (tx) => {
    // Lo que ya estaba en la papelera por su cuenta conserva su propia raíz y su propio plazo.
    const items = await subtree(tx, id, { trashedAt: null });
    for (const ids of chunks(
      items.map((item) => item.id),
      CHUNK,
    )) {
      await tx.node.updateMany({
        where: { id: { in: ids }, trashedAt: null },
        data: { trashedAt: now, trashRootId: id, updatedById: ctx.tenant.membershipId },
      });
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "node.trash",
        entityType: "Node",
        entityId: id,
        metadata: { name: node.name, nodeType: node.type, items: items.length },
      },
    );
  });
}

// ─── Ver la papelera ─────────────────────────────────────────────────────────────────────

export interface TrashItemView {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  /** Cuándo se borró. */
  trashedAt: Date;
  /** Cuándo se elimina para siempre si nadie lo restaura. */
  purgeAt: Date;
  /** Cuántos elementos trae consigo (él incluido). */
  items: number;
  sizeBytes: number | null;
}

/**
 * Lo borrado de un espacio que la persona puede restaurar (MANAGE). Se mira lo más reciente (hasta
 * un tope: la retención lo mantiene chico) y se filtra por acceso antes de paginar.
 */
export async function listTrash(
  ctx: AdminContext,
  spaceId: string,
  query: ListTrashQuery,
): Promise<Page<TrashItemView>> {
  // Sin acceso al espacio, la papelera no existe (404).
  requireLevel(await levelOfSpace(ctx, spaceId), "VIEW");
  const space = await ctx.db.space.findFirst({ where: { id: spaceId }, select: { id: true } });
  if (space === null) throw notFound();
  const groups = await ctx.db.node.groupBy({
    by: ["trashRootId"],
    where: { spaceId, trashedAt: { not: null }, trashRootId: { not: null } },
    _count: { _all: true },
    _max: { trashedAt: true },
    orderBy: { _max: { trashedAt: "desc" } },
    take: MAX_TRASH_ROOTS,
  });
  const rootIds = groups.flatMap((group) =>
    group.trashRootId === null ? [] : [group.trashRootId],
  );
  const roots = await ctx.db.node.findMany({
    where: { id: { in: rootIds }, trashRootId: { not: null } },
    select: { id: true, name: true, type: true, spaceId: true, trashedAt: true, sizeBytes: true },
  });
  const access = await accessFor(ctx, { nodeIds: rootIds, spaceIds: [spaceId] });
  const counts = new Map(groups.map((group) => [group.trashRootId, group._count._all]));
  const visible = roots
    .filter((root) => atLeast(access.ofNode(root.id), "MANAGE") && root.trashedAt !== null)
    .sort((a, b) => (b.trashedAt?.getTime() ?? 0) - (a.trashedAt?.getTime() ?? 0));
  const { skip, take } = offsetArgs(query);
  const items = visible.slice(skip, skip + take).flatMap((root): TrashItemView[] =>
    root.trashedAt === null
      ? []
      : [
          {
            id: root.id,
            name: root.name,
            type: root.type,
            spaceId: root.spaceId,
            trashedAt: root.trashedAt,
            purgeAt: new Date(root.trashedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS),
            items: counts.get(root.id) ?? 1,
            sizeBytes: root.sizeBytes === null ? null : bytesToJson(root.sizeBytes),
          },
        ],
  );
  return pageOf(items, visible.length, query);
}

// ─── Restaurar ───────────────────────────────────────────────────────────────────────────

async function trashedRoot(ctx: AdminContext, id: string) {
  const node = await ctx.db.node.findFirst({
    where: { id, trashedAt: { not: null }, trashRootId: id },
    select: { id: true, name: true, parentId: true, spaceId: true, type: true },
  });
  if (node === null) throw notFound();
  return node;
}

/** Restaura lo borrado con todo su subárbol; si su carpeta ya no está, vuelve a la raíz. */
export async function restoreNode(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; parentId: string | null; name: string }> {
  const node = await trashedRoot(ctx, id);
  requireLevel(await levelOfNode(ctx, id), "MANAGE");
  await assertSpaceWritable(ctx, node.spaceId);
  // La carpeta de origen: si sigue viva se vuelve ahí; si no, a la raíz del espacio.
  let parentId = node.parentId;
  if (parentId !== null) {
    const parent = await ctx.db.node.findFirst({
      where: { id: parentId, trashedAt: null, type: "FOLDER" },
      select: { id: true },
    });
    if (parent === null) parentId = null;
  }
  // El nombre pudo ocuparse mientras estaba en la papelera: se numera ("Informe (2).pdf").
  const taken = async (candidate: string) =>
    (await ctx.db.node.count({
      where: { spaceId: node.spaceId, parentId, nameKey: nameKeyOf(candidate), trashedAt: null },
    })) > 0;
  let name = node.name;
  for (let n = 2; await taken(name); n++) {
    if (n > 1000) throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
    name = numberedName(cleanName(node.name), n);
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.node.update({
      where: { id },
      data: { parentId, name, nameKey: nameKeyOf(name), updatedById: ctx.tenant.membershipId },
    });
    const ids = (await subtree(tx, id, { trashRootId: id })).map((item) => item.id);
    for (const part of chunks(ids, CHUNK)) {
      await tx.node.updateMany({
        where: { id: { in: part }, trashRootId: id },
        data: { trashedAt: null, trashRootId: null },
      });
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "node.restore",
        entityType: "Node",
        entityId: id,
        metadata: { items: ids.length, movedToRoot: parentId !== node.parentId },
      },
    );
  });
  return { id, parentId, name };
}

// ─── Eliminar para siempre ───────────────────────────────────────────────────────────────

export interface PurgeResult {
  nodes: number;
  bytes: number;
}

/**
 * Elimina un nodo de la papelera y su subárbol: borra las filas (las versiones se van en cascada),
 * libera la cuota y encola el borrado de los objetos de S3. Todo en la transacción de `db`.
 * `entry` es el evento de auditoría de quien lo pide (null en la purga automática).
 */
export async function purgeTrashRoot(
  db: TenantDb,
  jobs: Jobs,
  rootId: string,
  entry: Omit<AuditEntry, "action" | "entityType" | "entityId" | "metadata"> | null,
): Promise<PurgeResult> {
  return await db.$transaction(async (tx: TenantDb) => {
    const nodes = await subtree(tx, rootId, { trashRootId: rootId });
    const fileIds = nodes.filter((node) => node.type === "FILE").map((node) => node.id);
    const keys: string[] = [];
    let bytes = 0n;
    for (const ids of chunks(fileIds, CHUNK)) {
      const versions = await tx.fileVersion.findMany({
        where: { nodeId: { in: ids }, purgedAt: null },
        select: { storageKey: true, sizeBytes: true },
      });
      for (const version of versions) {
        keys.push(version.storageKey);
        bytes += version.sizeBytes;
      }
    }
    // Las imágenes de las páginas también se liberan (sus filas se van con la página).
    const pageIds = nodes.filter((node) => node.type === "PAGE").map((node) => node.id);
    for (const ids of chunks(pageIds, CHUNK)) {
      const images = await tx.pageImage.findMany({
        where: { nodeId: { in: ids } },
        select: { storageKey: true, sizeBytes: true, confirmedAt: true },
      });
      for (const image of images) {
        keys.push(image.storageKey);
        if (image.confirmedAt !== null) bytes += image.sizeBytes;
      }
    }
    // Hijos antes que padres (la clave foránea del árbol no admite lo contrario).
    const depth = new Map<string, number>();
    const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
    const depthOf = (id: string): number => {
      const known = depth.get(id);
      if (known !== undefined) return known;
      const parent = parents.get(id) ?? null;
      const value = parent === null || !parents.has(parent) ? 0 : depthOf(parent) + 1;
      depth.set(id, value);
      return value;
    };
    const levels = new Map<number, string[]>();
    for (const node of nodes) {
      const level = depthOf(node.id);
      levels.set(level, [...(levels.get(level) ?? []), node.id]);
    }
    for (const level of [...levels.keys()].sort((a, b) => b - a)) {
      for (const ids of chunks(levels.get(level) ?? [], CHUNK)) {
        await tx.node.deleteMany({ where: { id: { in: ids } } });
      }
    }
    if (bytes > 0n) {
      const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { storageUsedBytes: { decrement: bytes } },
      });
    }
    for (const part of chunks(keys, KEYS_PER_JOB)) {
      await jobs.enqueue("objects-delete", { keys: part }, { tx });
    }
    await audit(tx, {
      ...(entry ?? {}),
      action: "node.purge",
      entityType: "Node",
      entityId: rootId,
      metadata: { nodes: nodes.length, files: fileIds.length, bytes: bytesToJson(bytes) },
    });
    return { nodes: nodes.length, bytes: bytesToJson(bytes) };
  });
}

export async function purgeNode(ctx: AdminContext, jobs: Jobs, id: string): Promise<PurgeResult> {
  await trashedRoot(ctx, id);
  requireLevel(await levelOfNode(ctx, id), "MANAGE");
  return await purgeTrashRoot(ctx.db, jobs, id, ctx.info);
}
