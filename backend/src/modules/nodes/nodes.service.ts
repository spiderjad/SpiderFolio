// Nodos del árbol de un espacio (docs/spec/modelo-de-datos.md, Node): carpetas ahora; archivos y
// páginas se suman en las partes siguientes. Cada operación pregunta a resolveAccess: sin acceso el
// nodo no existe (404); con acceso pero poco nivel, 403. Los nombres no se repiten entre hermanos
// (sin distinguir mayúsculas y con NFC); el índice único parcial lo garantiza aunque dos pedidos
// compitan.
import type { AccessLevel, NodeType, Prisma } from "../../generated/prisma/client.ts";
import { bytesToJson } from "@spiderfolio/limits";
import { contentMessages } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf, numberedName } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { positionBetween } from "../../lib/position.ts";
import {
  accessActorOf,
  atLeast,
  expiryFilter,
  hasFullAccessIn,
  subjectFilter,
} from "../access/access.ts";
import { userMediaUrl } from "../profile-media/profile-media.service.ts";
import { accessFor, levelOfNode, levelOfSpace, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { sharingSummaries, type SharingSummary } from "../access/sharing-summary.ts";
import { recordVisit } from "../documents/recent.service.ts";
import { markSharedSeen } from "./shared.service.ts";
import type {
  CreateFolderInput,
  ListNodesQuery,
  MoveNodeInput,
  UpdateNodeInput,
} from "./nodes.schemas.ts";

/** Niveles de carpetas dentro de un espacio. */
export const MAX_TREE_DEPTH = 30;

export const nodeSelect = {
  id: true,
  spaceId: true,
  parentId: true,
  type: true,
  name: true,
  icon: true,
  cover: true,
  inheritAccess: true,
  currentVersion: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
} as const;

type NodeRow = Prisma.NodeGetPayload<{ select: typeof nodeSelect }>;

export interface NodeView extends Omit<NodeRow, "sizeBytes"> {
  /** Tamaño de la versión vigente (solo archivos). */
  sizeBytes: number | null;
  /** Nivel de quien pide sobre este nodo. */
  level: AccessLevel;
}

/** The app behind a row's last change ("Claude"), or null if a person made it in the app. */
export const viaOf = (row: {
  updatedAt: Date;
  updatedVia: string | null;
  updatedViaAt: Date | null;
}): string | null =>
  row.updatedVia !== null && row.updatedViaAt?.getTime() === row.updatedAt.getTime()
    ? row.updatedVia
    : null;

/** Fila de un listado: además, cuántos elementos tiene la carpeta y quién la modificó. */
export interface NodeListItem extends NodeView {
  /** Elementos dentro (solo carpetas). */
  childCount: number | null;
  /** Subcarpetas directas (solo carpetas): el árbol muestra la flecha solo si hay. */
  folderCount: number | null;
  /** Tamaño de todo lo que contiene (recursivo) y que la persona puede ver; null si no se pudo calcular. */
  totalBytes: number | null;
  updatedBy: { id: string; name: string; avatarUrl: string | null } | null;
  /** The app the last change was made through ("Claude"), or null. */
  updatedVia: string | null;
  /** Con quién está compartido (solo si la persona puede gestionarlo). */
  sharing: SharingSummary | null;
}

export const toView = (row: NodeRow, level: AccessLevel): NodeView => ({
  ...row,
  sizeBytes: row.sizeBytes === null ? null : bytesToJson(row.sizeBytes),
  level,
});

async function loadNode(ctx: AdminContext, id: string) {
  const row = await ctx.db.node.findFirst({
    where: { id, trashedAt: null },
    select: { ...nodeSelect, nameKey: true },
  });
  if (row === null) throw notFound();
  return row;
}

/** Ancestros de un nodo, de la raíz al padre. */
async function ancestorsOf(
  ctx: AdminContext,
  parentId: string | null,
): Promise<{ id: string; name: string; type: NodeType; parentId: string | null }[]> {
  const chain: { id: string; name: string; type: NodeType; parentId: string | null }[] = [];
  let current = parentId;
  while (current !== null && chain.length <= MAX_TREE_DEPTH + 1) {
    const row = await ctx.db.node.findFirst({
      where: { id: current },
      select: { id: true, name: true, type: true, parentId: true },
    });
    if (row === null) break;
    chain.unshift(row);
    current = row.parentId;
  }
  return chain;
}

/** Carpetas primero, después páginas y al final archivos; dentro de cada grupo, el orden pedido. */
const TYPE_ORDER = ["FOLDER", "PAGE", "FILE"] as const;

/**
 * El orden por tipo no es el del enum de la base: se arma la página recorriendo los tres grupos en
 * orden (con sus totales) y pidiendo de cada uno solo la parte que cae en la ventana pedida.
 */
async function pagedByType(
  ctx: AdminContext,
  where: Prisma.NodeWhereInput,
  order: Prisma.NodeOrderByWithRelationInput,
  query: ListNodesQuery,
) {
  const select = {
    ...nodeSelect,
    updatedById: true,
    updatedVia: true,
    updatedViaAt: true,
  } as const;
  const groups = await ctx.db.node.groupBy({ by: ["type"], where, _count: { _all: true } });
  const countOf = (type: (typeof TYPE_ORDER)[number]) =>
    groups.find((group) => group.type === type)?._count._all ?? 0;
  const total = TYPE_ORDER.reduce((sum, type) => sum + countOf(type), 0);
  let offset = offsetArgs(query).skip;
  let remaining = query.pageSize;
  const rows: Prisma.NodeGetPayload<{ select: typeof select }>[] = [];
  for (const type of TYPE_ORDER) {
    const count = countOf(type);
    if (offset >= count) {
      offset -= count;
      continue;
    }
    const slice = await ctx.db.node.findMany({
      where: { AND: [where, { type }] },
      select,
      orderBy: stableOrder(order),
      skip: offset,
      take: remaining,
    });
    rows.push(...slice);
    remaining -= slice.length;
    offset = 0;
    if (remaining <= 0) break;
  }
  return { rows, total };
}

export async function listChildren(
  ctx: AdminContext,
  spaceId: string,
  query: ListNodesQuery,
): Promise<Page<NodeListItem>> {
  const actor = accessActorOf(ctx);
  const parentId = query.parent === "root" ? null : query.parent;
  // Sin acceso a la carpeta (o al espacio) no hay listado: 404.
  const parentLevel =
    parentId === null ? await levelOfSpace(ctx, spaceId) : await levelOfNode(ctx, parentId);
  requireLevel(parentLevel, "VIEW");
  if (parentId !== null) {
    const parent = await ctx.db.node.findFirst({
      where: { id: parentId, spaceId, trashedAt: null, type: { in: ["FOLDER", "PAGE"] } },
      select: { id: true },
    });
    if (parent === null) throw notFound();
  }
  const space = await ctx.db.space.findFirst({
    where: { id: spaceId },
    select: { isConfidential: true },
  });
  if (space === null) throw notFound();

  const now = new Date();
  const where: Prisma.NodeWhereInput = {
    AND: [
      { spaceId, parentId, trashedAt: null },
      query.type === undefined
        ? {}
        : query.type === "CONTAINER"
          ? { type: { in: ["FOLDER", "PAGE"] } }
          : { type: query.type },
      query.kind === "pages"
        ? { type: { in: ["FOLDER", "PAGE"] } }
        : query.kind === "files"
          ? { type: { in: ["FOLDER", "FILE"] } }
          : {},
      query.q === undefined || query.q === "" ? {} : { nameKey: { contains: nameKeyOf(query.q) } },
      // Quien no tiene acceso total solo ve lo que hereda o lo que le dieron a ese nodo.
      hasFullAccessIn(actor, space)
        ? {}
        : {
            OR: [
              { inheritAccess: true },
              { permissions: { some: { AND: [subjectFilter(actor), expiryFilter(now)] } } },
            ],
          },
    ],
  };
  const order: Prisma.NodeOrderByWithRelationInput =
    query.sort === "updatedAt" ? { updatedAt: query.dir } : { nameKey: query.dir };
  const { rows, total } = await pagedByType(ctx, where, order, query);
  const access = await accessFor(ctx, { nodeIds: rows.map((row) => row.id), spaceIds: [spaceId] });
  // Carpetas y páginas pueden tener cosas adentro.
  const folderIds = rows.filter((row) => row.type !== "FILE").map((row) => row.id);
  const [counts, people] = await Promise.all([
    folderIds.length === 0
      ? []
      : ctx.db.node.groupBy({
          by: ["parentId", "type"],
          where: { parentId: { in: folderIds }, trashedAt: null },
          _count: { _all: true },
        }),
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.updatedById))] } },
      select: { id: true, user: { select: { id: true, name: true, avatarKey: true } } },
    }),
  ]);
  const childCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();
  for (const row of counts) {
    if (row.parentId === null) continue;
    childCounts.set(row.parentId, (childCounts.get(row.parentId) ?? 0) + row._count._all);
    if (row.type !== "FILE") {
      folderCounts.set(row.parentId, (folderCounts.get(row.parentId) ?? 0) + row._count._all);
    }
  }
  const totals = await folderTotals(ctx, spaceId, folderIds);
  const sharing = await sharingSummaries(ctx, {
    type: "node",
    ids: rows.filter((row) => access.ofNode(row.id) === "MANAGE").map((row) => row.id),
  });
  const names = new Map(people.map((row) => [row.id, row.user]));
  const items = rows.flatMap((row): NodeListItem[] => {
    const level = access.ofNode(row.id);
    if (level === null) return [];
    const { updatedById, updatedVia, updatedViaAt, ...rest } = row;
    const name = names.get(updatedById);
    return [
      {
        ...toView(rest, level),
        childCount: row.type !== "FILE" ? (childCounts.get(row.id) ?? 0) : null,
        folderCount: row.type !== "FILE" ? (folderCounts.get(row.id) ?? 0) : null,
        totalBytes: row.type !== "FILE" ? (totals.get(row.id) ?? null) : null,
        sharing: sharing.get(row.id) ?? null,
        updatedVia: viaOf({ updatedAt: row.updatedAt, updatedVia, updatedViaAt }),
        updatedBy:
          name === undefined
            ? null
            : {
                id: updatedById,
                name: name.name,
                avatarUrl: userMediaUrl("avatar", name.id, name.avatarKey),
              },
      },
    ];
  });
  return pageOf(items, total, query);
}

/** Tope de elementos que se recorren para sumar tamaños de una página de carpetas. */
const TOTALS_MAX_NODES = 20_000;

/**
 * Tamaño total (recursivo) de cada carpeta, sumando solo los archivos que la persona puede ver.
 * Se recorre el subárbol por niveles (una consulta por nivel para todas las carpetas de la
 * página); si es demasiado grande, esa respuesta es null y la pantalla muestra un guion.
 */
async function folderTotals(
  ctx: AdminContext,
  spaceId: string,
  folderIds: readonly string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>(folderIds.map((id) => [id, 0]));
  if (folderIds.length === 0) return result;
  const rootOf = new Map<string, string>(folderIds.map((id) => [id, id]));
  const files: { id: string; root: string; size: number }[] = [];
  let frontier = [...folderIds];
  let seen = 0;
  for (let depth = 0; frontier.length > 0 && depth <= MAX_TREE_DEPTH + 1; depth += 1) {
    const children = await ctx.db.node.findMany({
      where: { spaceId, parentId: { in: frontier }, trashedAt: null },
      select: { id: true, parentId: true, type: true, sizeBytes: true },
      take: TOTALS_MAX_NODES - seen + 1,
    });
    seen += children.length;
    if (seen > TOTALS_MAX_NODES) return new Map(folderIds.map((id) => [id, null]));
    const next: string[] = [];
    for (const child of children) {
      const root = child.parentId === null ? undefined : rootOf.get(child.parentId);
      if (root === undefined) continue;
      rootOf.set(child.id, root);
      if (child.type !== "FILE") next.push(child.id);
      else if (child.sizeBytes !== null) {
        files.push({ id: child.id, root, size: bytesToJson(child.sizeBytes) });
      }
    }
    frontier = next;
  }
  const access = await accessFor(ctx, {
    nodeIds: files.map((file) => file.id),
    spaceIds: [spaceId],
  });
  for (const file of files) {
    if (access.ofNode(file.id) === null) continue;
    result.set(file.root, (result.get(file.root) ?? 0) + file.size);
  }
  return result;
}

export interface NodeDetail {
  node: NodeView;
  space: { id: string; name: string; archived: boolean };
  /**
   * De la raíz al padre. Se muestran todos los nombres (para ubicarse), pero solo se puede entrar
   * a los que la persona ve (`accessible`).
   */
  ancestors: { id: string; name: string; type: NodeType; accessible: boolean }[];
  /**
   * Si la persona llega acá por un acceso compartido (no ve el espacio o alguna carpeta de arriba): el
   * elemento desde donde puede navegar. null si ve todo el camino.
   */
  shareRoot: { id: string; name: string; type: NodeType } | null;
}

export async function getNode(ctx: AdminContext, id: string): Promise<NodeDetail> {
  const row = await loadNode(ctx, id);
  const level = requireLevel(await levelOfNode(ctx, id), "VIEW");
  const [space, chain] = await Promise.all([
    ctx.db.space.findFirst({
      where: { id: row.spaceId },
      select: { id: true, name: true, archivedAt: true },
    }),
    ancestorsOf(ctx, row.parentId),
  ]);
  if (space === null) throw notFound();
  const [access, spaceLevel] = await Promise.all([
    accessFor(ctx, { nodeIds: chain.map((node) => node.id) }),
    levelOfSpace(ctx, row.spaceId),
  ]);
  const ancestors = chain.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    accessible: atLeast(access.ofNode(node.id), "VIEW"),
  }));
  // Desde donde se navega: lo primero que se ve después del último tramo que no se ve.
  const path = [...ancestors, { id: row.id, name: row.name, type: row.type, accessible: true }];
  const lastHidden = path.findLastIndex((entry) => !entry.accessible);
  const first = path[lastHidden + 1];
  const shareRoot =
    first !== undefined && (lastHidden >= 0 || spaceLevel === null)
      ? { id: first.id, name: first.name, type: first.type }
      : null;
  // Abrir lo compartido (el elemento desde donde llega) lo marca como visto.
  if (shareRoot?.id === id) await markSharedSeen(ctx, id);
  // Para «Recientes» de Mis documentos (solo páginas y archivos).
  await recordVisit(ctx, { id: row.id, type: row.type });
  return {
    node: toView(row, level),
    space: { id: space.id, name: space.name, archived: space.archivedAt !== null },
    ancestors,
    shareRoot,
  };
}

/** El destino existe, es una carpeta del espacio y la persona puede escribir en él. */
export async function assertDestination(
  ctx: AdminContext,
  spaceId: string,
  parentId: string | null,
): Promise<{ depth: number; chainIds: string[] }> {
  await assertSpaceWritable(ctx, spaceId);
  if (parentId === null) {
    requireLevel(await levelOfSpace(ctx, spaceId), "EDIT");
    return { depth: 0, chainIds: [] };
  }
  const parent = await ctx.db.node.findFirst({
    where: { id: parentId, spaceId, trashedAt: null },
    select: { id: true, type: true, parentId: true },
  });
  if (parent === null) throw notFound();
  requireLevel(await levelOfNode(ctx, parentId), "EDIT");
  // Una página también puede tener contenido dentro (subpáginas).
  if (parent.type !== "FOLDER" && parent.type !== "PAGE") {
    throw new AppError("BAD_REQUEST", { message: contentMessages.parentNotFolder });
  }
  const chain = await ancestorsOf(ctx, parentId);
  return { depth: chain.length, chainIds: chain.map((node) => node.id) };
}

export async function assertNameFree(
  ctx: AdminContext,
  spaceId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
) {
  const taken = await ctx.db.node.findFirst({
    where: {
      spaceId,
      parentId,
      nameKey: nameKeyOf(name),
      trashedAt: null,
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
}

/** Posición al final de la carpeta. */
export async function lastPosition(
  ctx: Pick<AdminContext, "db">,
  spaceId: string,
  parentId: string | null,
): Promise<string> {
  const last = await ctx.db.node.findFirst({
    where: { spaceId, parentId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return positionBetween(last?.position ?? null, null);
}

export async function createFolder(
  ctx: AdminContext,
  spaceId: string,
  input: CreateFolderInput,
): Promise<NodeView> {
  const parentId = input.parentId ?? null;
  const { depth } = await assertDestination(ctx, spaceId, parentId);
  if (depth + 1 > MAX_TREE_DEPTH) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.tooDeep });
  }
  const name = cleanName(input.name);
  await assertNameFree(ctx, spaceId, parentId, name);
  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.node.create({
      data: {
        spaceId,
        parentId,
        type: "FOLDER",
        name,
        nameKey: nameKeyOf(name),
        position: await lastPosition({ db: tx }, spaceId, parentId),
        createdById: ctx.tenant.membershipId,
        updatedById: ctx.tenant.membershipId,
      },
      select: nodeSelect,
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "folder.create",
        entityType: "Node",
        entityId: created.id,
        metadata: { spaceId, parentId, name },
      },
    );
    return created;
  });
  const level = await levelOfNode(ctx, row.id);
  return toView(row, level ?? "EDIT");
}

export async function updateNode(
  ctx: AdminContext,
  id: string,
  input: UpdateNodeInput,
): Promise<NodeView> {
  const row = await loadNode(ctx, id);
  const level = requireLevel(await levelOfNode(ctx, id), "EDIT");
  await assertSpaceWritable(ctx, row.spaceId);
  const data: Prisma.NodeUncheckedUpdateInput = { updatedById: ctx.tenant.membershipId };
  let renamedFrom: string | null = null;
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (name !== row.name) {
      await assertNameFree(ctx, row.spaceId, row.parentId, name, id);
      data.name = name;
      data.nameKey = nameKeyOf(name);
      renamedFrom = row.name;
    }
  }
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.cover !== undefined) data.cover = input.cover;
  if (renamedFrom === null && input.icon === undefined && input.cover === undefined) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.noChanges });
  }
  const updated = await ctx.db.$transaction(async (tx) => {
    const result = await tx.node.update({ where: { id }, data, select: nodeSelect });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "node.update",
        entityType: "Node",
        entityId: id,
        metadata: { ...(renamedFrom === null ? {} : { renamedFrom }), nodeType: row.type },
      },
    );
    return result;
  });
  return toView(updated, level);
}

/** Ids de un nodo y todo lo que tiene debajo (también lo que está en la papelera dentro). */
async function subtreeIds(db: AdminContext["db"], rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  for (let depth = 0; frontier.length > 0 && depth <= MAX_TREE_DEPTH + 1; depth += 1) {
    const children = await db.node.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((child) => child.id);
    ids.push(...frontier);
  }
  return ids;
}

const CHUNK = 500;

/**
 * Mover pide EDIT sobre el nodo (origen) y EDIT en el destino, que puede ser otro espacio. Una
 * carpeta se lleva todo su contenido, y todo ocurre en una transacción. Ante un nombre repetido:
 * FAIL, REPLACE (lo que estaba pasa a la papelera; pide MANAGE sobre ello) o KEEP_BOTH (numera).
 */
export async function moveNode(
  ctx: AdminContext,
  id: string,
  input: MoveNodeInput,
): Promise<NodeView> {
  const row = await loadNode(ctx, id);
  const level = requireLevel(await levelOfNode(ctx, id), "EDIT");
  await assertSpaceWritable(ctx, row.spaceId);
  const targetSpaceId = input.spaceId ?? row.spaceId;
  const { depth, chainIds } = await assertDestination(ctx, targetSpaceId, input.parentId);
  if (input.parentId === id || chainIds.includes(id)) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.moveIntoItself });
  }
  if (row.parentId === input.parentId && targetSpaceId === row.spaceId) return toView(row, level);
  if (row.type === "FOLDER" || row.type === "PAGE") {
    // La carpeta (o página) lleva consigo su subárbol: sus niveles más los del destino no pasan el tope.
    const height = await subtreeHeight(ctx, id);
    if (depth + height > MAX_TREE_DEPTH) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.tooDeep });
    }
  }
  const clash = await ctx.db.node.findFirst({
    where: {
      spaceId: targetSpaceId,
      parentId: input.parentId,
      nameKey: nameKeyOf(row.name),
      trashedAt: null,
      NOT: { id },
    },
    select: { id: true },
  });
  let name = row.name;
  let replaceId: string | null = null;
  if (clash !== null) {
    if (input.onConflict === "FAIL") {
      throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
    }
    if (input.onConflict === "REPLACE") {
      requireLevel(await levelOfNode(ctx, clash.id), "MANAGE");
      replaceId = clash.id;
    } else {
      for (let n = 2; ; n += 1) {
        const candidate = numberedName(row.name, n);
        const taken = await ctx.db.node.findFirst({
          where: {
            spaceId: targetSpaceId,
            parentId: input.parentId,
            nameKey: nameKeyOf(candidate),
            trashedAt: null,
          },
          select: { id: true },
        });
        if (taken === null) {
          name = candidate;
          break;
        }
      }
    }
  }
  const updated = await ctx.db.$transaction(async (tx) => {
    if (replaceId !== null) {
      // Lo reemplazado pasa a la papelera con todo lo suyo (se puede restaurar 30 días).
      const now = new Date();
      const doomed = await subtreeIds(tx, replaceId);
      for (let i = 0; i < doomed.length; i += CHUNK) {
        await tx.node.updateMany({
          where: { id: { in: doomed.slice(i, i + CHUNK) }, trashedAt: null },
          data: { trashedAt: now, trashRootId: replaceId, updatedById: ctx.tenant.membershipId },
        });
      }
    }
    if (targetSpaceId !== row.spaceId) {
      // Cambia de espacio: todo el subárbol viaja con la carpeta.
      const moving = await subtreeIds(tx, id);
      for (let i = 0; i < moving.length; i += CHUNK) {
        await tx.node.updateMany({
          where: { id: { in: moving.slice(i, i + CHUNK) } },
          data: { spaceId: targetSpaceId },
        });
      }
    }
    const result = await tx.node.update({
      where: { id },
      data: {
        parentId: input.parentId,
        spaceId: targetSpaceId,
        ...(name === row.name ? {} : { name, nameKey: nameKeyOf(name) }),
        position: await lastPosition({ db: tx }, targetSpaceId, input.parentId),
        updatedById: ctx.tenant.membershipId,
      },
      select: nodeSelect,
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "node.move",
        entityType: "Node",
        entityId: id,
        metadata: {
          from: row.parentId,
          to: input.parentId,
          fromSpace: row.spaceId,
          toSpace: targetSpaceId,
          nodeType: row.type,
          conflict: clash === null ? null : input.onConflict,
        },
      },
    );
    return result;
  });
  return toView(updated, level);
}

/** Niveles que ocupa una carpeta con todo lo que tiene dentro (ella incluida). */
async function subtreeHeight(ctx: AdminContext, rootId: string): Promise<number> {
  let height = 1;
  let frontier = [rootId];
  while (frontier.length > 0 && height <= MAX_TREE_DEPTH + 1) {
    const children = await ctx.db.node.findMany({
      where: { parentId: { in: frontier }, type: { in: ["FOLDER", "PAGE"] } },
      select: { id: true },
    });
    frontier = children.map((child) => child.id);
    if (frontier.length > 0) height++;
  }
  return height;
}
