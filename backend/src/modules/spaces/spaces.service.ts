// Espacios (docs/spec/modelo-de-datos.md, Space): la raíz de cada árbol de contenido. Quién ve cada
// espacio lo decide resolveAccess; "Miembros del espacio" da acceso a departamentos (lo principal)
// o a personas. Cada cambio queda en el AuditLog.
import type { Prisma } from "../../generated/prisma/client.ts";
import type { AccessLevel } from "../../generated/prisma/client.ts";
import { contentMessages } from "../../i18n/index.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { peopleScopeOf } from "../people/people-scope.ts";
import {
  accessActorOf,
  type AccessActor,
  type AccessReason,
  type AccessResolver,
  expiryFilter,
  hasFullAccess,
  subjectFilter,
} from "../access/access.ts";
import { sharingSummaries, type SharingSummary } from "../access/sharing-summary.ts";
import { accessFor, canManageSpace, levelOfSpace, requireLevel } from "../access/access-context.ts";
import type {
  CreateSpaceInput,
  ListSpaceMembersQuery,
  ListSpacesQuery,
  UpdateSpaceInput,
} from "./spaces.schemas.ts";

export interface SpaceView {
  id: string;
  name: string;
  icon: string | null;
  /** Color propio (#rrggbb); null = el del departamento o el de marca. */
  color: string | null;
  description: string | null;
  isPrivate: boolean;
  /** Confidencial (implica privado): los administradores no entran solos. */
  isConfidential: boolean;
  archived: boolean;
  /** Nivel de quien pide sobre la raíz del espacio. */
  level: AccessLevel;
  /** Puede cambiarlo, archivarlo y dar acceso. */
  canManage: boolean;
  /** Departamento dueño del espacio (null = espacio de la empresa). */
  department: { id: string; name: string; color: string | null } | null;
  /** Nivel de los miembros del departamento (solo en espacios de departamento). */
  departmentLevel: "EDIT" | "VIEW";
  /** El acceso de miembros llega también a los subdepartamentos. */
  includeSubareas: boolean;
  /** Por qué la persona tiene ese nivel ("Jefe de Finanzas", "Administrador"…). */
  reason: SpaceReasonView | null;
  /** Marcado como favorito por quien pide. */
  favorite: boolean;
  /** Con quién está compartido (solo si la persona puede gestionarlo). */
  sharing: SharingSummary | null;
  /** Archivos vigentes (sin papelera) y última modificación de cualquier elemento. */
  fileCount: number;
  lastModifiedAt: Date | null;
  createdAt: Date;
}

export type SpaceReasonView =
  | { kind: "owner" | "admin" | "bypass" | "grant" | "company" }
  /** `superior`: lidera un área por encima del departamento del espacio. */
  | {
      kind: "leader";
      rank: "HEAD" | "DEPUTY";
      department: { id: string; name: string };
      superior: boolean;
    }
  | { kind: "member"; department: { id: string; name: string }; subareas: boolean }
  | { kind: "visible"; department: { id: string; name: string } };

const spaceSelect = {
  id: true,
  name: true,
  icon: true,
  color: true,
  description: true,
  isPrivate: true,
  isConfidential: true,
  archivedAt: true,
  createdAt: true,
  departmentId: true,
  departmentLevel: true,
  includeSubareas: true,
  department: { select: { id: true, name: true, color: true } },
} as const;

type SpaceRow = Prisma.SpaceGetPayload<{ select: typeof spaceSelect }>;

/** El nivel y el motivo de cada espacio, con los nombres de los departamentos que aparecen. */
async function viewsOf(
  ctx: AdminContext,
  rows: readonly SpaceRow[],
  access: AccessResolver,
): Promise<SpaceView[]> {
  const known = new Map<string, string>();
  for (const row of rows)
    if (row.department !== null) known.set(row.department.id, row.department.name);
  // Un jefe de un departamento padre aparece con el nombre del padre, que puede no estar en la lista.
  const reasons = new Map<string, AccessReason | null>(
    rows.map((row) => [row.id, access.reasonOfSpace(row.id)]),
  );
  const missing = [
    ...new Set(
      [...reasons.values()].flatMap((reason) =>
        reason !== null &&
        "departmentId" in reason &&
        typeof reason.departmentId === "string" &&
        !known.has(reason.departmentId)
          ? [reason.departmentId]
          : [],
      ),
    ),
  ];
  if (missing.length > 0) {
    const found = await ctx.db.department.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true },
    });
    for (const department of found) known.set(department.id, department.name);
  }
  const named = (id: string) => ({ id, name: known.get(id) ?? "" });
  const ids = rows.map((row) => row.id);
  const [states, usage] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          ctx.db.spaceUserState.findMany({
            where: { spaceId: { in: ids }, membershipId: ctx.tenant.membershipId },
            select: { spaceId: true, favorite: true },
          }),
          ctx.db.node.groupBy({
            by: ["spaceId", "type"],
            where: { spaceId: { in: ids }, trashedAt: null },
            _count: { _all: true },
            _max: { updatedAt: true },
          }),
        ]);
  const favorites = new Set(states.filter((state) => state.favorite).map((state) => state.spaceId));
  const sharing = await sharingSummaries(ctx, {
    type: "space",
    ids: ids.filter((id) => canManageSpace(ctx, access.ofSpace(id))),
  });
  const files = new Map<string, number>();
  const modified = new Map<string, Date>();
  for (const group of usage) {
    if (group.type === "FILE") files.set(group.spaceId, group._count._all);
    const last = group._max.updatedAt;
    const known = modified.get(group.spaceId);
    if (last !== null && (known === undefined || last > known)) modified.set(group.spaceId, last);
  }
  return rows.flatMap((row) => {
    const level = access.ofSpace(row.id);
    if (level === null) return [];
    const reason = reasons.get(row.id) ?? null;
    let view: SpaceReasonView | null = null;
    if (reason !== null) {
      if (reason.kind === "leader") {
        view = {
          kind: "leader",
          rank: reason.rank,
          department: named(reason.departmentId),
          superior: reason.departmentId !== row.departmentId,
        };
      } else if (reason.kind === "member") {
        view = {
          kind: "member",
          department: named(reason.departmentId),
          subareas: reason.subareas,
        };
      } else if (reason.kind === "visible") {
        view = { kind: "visible", department: named(reason.departmentId) };
      } else {
        view = { kind: reason.kind };
      }
    }
    return [
      {
        id: row.id,
        name: row.name,
        icon: row.icon,
        color: row.color,
        description: row.description,
        isPrivate: row.isPrivate,
        isConfidential: row.isConfidential,
        archived: row.archivedAt !== null,
        level,
        canManage: canManageSpace(ctx, level),
        department: row.department,
        departmentLevel: row.departmentLevel === "VIEW" ? ("VIEW" as const) : ("EDIT" as const),
        includeSubareas: row.includeSubareas,
        reason: view,
        favorite: favorites.has(row.id),
        sharing: sharing.get(row.id) ?? null,
        fileCount: files.get(row.id) ?? 0,
        lastModifiedAt: modified.get(row.id) ?? null,
        createdAt: row.createdAt,
      },
    ];
  });
}

async function viewOf(ctx: AdminContext, row: SpaceRow): Promise<SpaceView> {
  const [view] = await viewsOf(ctx, [row], await accessFor(ctx, { spaceIds: [row.id] }));
  if (view === undefined) throw notFound();
  return view;
}

/** Los espacios que la persona alcanza (filtro en SQL para paginar de verdad). */
export function visibleSpacesWhere(ctx: AdminContext, now: Date): Prisma.SpaceWhereInput {
  const actor = accessActorOf(ctx);
  if (actor.base === "OWNER") return {};
  const granted: Prisma.SpaceWhereInput = {
    permissions: { some: { AND: [subjectFilter(actor), expiryFilter(now)] } },
  };
  const ofMyDepartments = departmentSpacesWhere(actor);
  // ADMIN y content.bypass ven todo menos lo confidencial, donde entran como cualquier miembro.
  if (hasFullAccess(actor)) return { OR: [{ isConfidential: false }, granted, ofMyDepartments] };
  // Los espacios de sus departamentos (y de los que lidera) se ven aunque sean privados.
  return actor.base === "MEMBER"
    ? { OR: [{ isPrivate: false }, granted, ofMyDepartments] }
    : granted;
}

/**
 * Los espacios de departamento a los que la persona entra por su cargo o su departamento: los que
 * lidera (con sus subáreas), los de sus departamentos y, con "Incluir subáreas", los de sus ancestros.
 */
function departmentSpacesWhere(actor: AccessActor): Prisma.SpaceWhereInput {
  if (actor.base === "GUEST") return { id: { in: [] } };
  const direct = [...new Set([...actor.ownDepartmentIds, ...actor.ledScope.keys()])];
  return {
    OR: [
      { departmentId: { in: direct } },
      { includeSubareas: true, departmentId: { in: [...actor.departmentIds] } },
    ],
  };
}

function orderOf(query: ListSpacesQuery): Prisma.SpaceOrderByWithRelationInput[] {
  if (query.sort === "createdAt") return stableOrder({ createdAt: query.dir });
  return stableOrder({ nameKey: query.dir });
}

export async function listSpaces(
  ctx: AdminContext,
  query: ListSpacesQuery,
): Promise<Page<SpaceView>> {
  const now = new Date();
  // Solo quien gestiona espacios ve los archivados.
  const archived = query.archived && ctx.actor.capabilities.includes("spaces.manage");
  const filters: Record<ListSpacesQuery["filter"], Prisma.SpaceWhereInput> = {
    all: {},
    mine: departmentSpacesWhere(accessActorOf(ctx)),
    private: { isPrivate: true },
    favorites: {
      userStates: { some: { membershipId: ctx.tenant.membershipId, favorite: true } },
    },
  };
  const where: Prisma.SpaceWhereInput = {
    AND: [
      visibleSpacesWhere(ctx, now),
      archived ? { archivedAt: { not: null } } : { archivedAt: null },
      filters[query.filter],
      query.q === undefined || query.q === "" ? {} : { nameKey: { contains: nameKeyOf(query.q) } },
    ],
  };
  const total = await ctx.db.space.count({ where });
  const rows =
    query.sort === "favorite"
      ? await byFavoriteOrder(ctx, where, query)
      : query.sort === "department"
        ? await groupedByDepartment(ctx, where, query, total)
        : await ctx.db.space.findMany({
            where,
            select: spaceSelect,
            orderBy: orderOf(query),
            ...offsetArgs(query),
          });
  const access = await accessFor(ctx, { spaceIds: rows.map((row) => row.id) });
  return pageOf(await viewsOf(ctx, rows, access), total, query);
}

/**
 * Orden elegido por la persona para sus favoritos (los sin orden, al final por nombre). Los favoritos
 * de una persona son pocos: se ordenan en memoria y se pagina sobre esa lista.
 */
async function byFavoriteOrder(
  ctx: AdminContext,
  where: Prisma.SpaceWhereInput,
  query: ListSpacesQuery,
): Promise<SpaceRow[]> {
  const [rows, states] = await Promise.all([
    ctx.db.space.findMany({ where, select: spaceSelect, orderBy: stableOrder({ nameKey: "asc" }) }),
    ctx.db.spaceUserState.findMany({
      where: { membershipId: ctx.tenant.membershipId, favorite: true },
      select: { spaceId: true, favoritePosition: true },
    }),
  ]);
  const position = new Map(states.map((state) => [state.spaceId, state.favoritePosition]));
  const rank = (id: string): number => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  // sort() es estable: a igual posición queda el orden por nombre.
  const ordered = [...rows].sort((a, b) => rank(a.id) - rank(b.id));
  const { skip, take } = offsetArgs(query);
  return ordered.slice(skip, skip + take);
}

/**
 * Orden por área: primero los espacios de la empresa y luego los de cada departamento por nombre
 * (Postgres deja los nulos al final, así que son dos tramos de una misma lista paginada).
 */
async function groupedByDepartment(
  ctx: AdminContext,
  where: Prisma.SpaceWhereInput,
  query: ListSpacesQuery,
  total: number,
): Promise<SpaceRow[]> {
  const { skip, take } = offsetArgs(query);
  const company: Prisma.SpaceWhereInput = { AND: [where, { departmentId: null }] };
  const companyTotal = await ctx.db.space.count({ where: company });
  const fromCompany = Math.max(0, Math.min(take, companyTotal - skip));
  const [companyRows, departmentRows] = await Promise.all([
    fromCompany === 0
      ? []
      : ctx.db.space.findMany({
          where: company,
          select: spaceSelect,
          orderBy: stableOrder({ nameKey: "asc" }),
          skip,
          take: fromCompany,
        }),
    take - fromCompany <= 0 || total <= companyTotal
      ? []
      : ctx.db.space.findMany({
          where: { AND: [where, { departmentId: { not: null } }] },
          select: spaceSelect,
          orderBy: stableOrder([{ department: { name: "asc" } }, { nameKey: "asc" }]),
          skip: Math.max(0, skip - companyTotal),
          take: take - fromCompany,
        }),
  ]);
  return [...companyRows, ...departmentRows];
}

const RECENT_LIMIT = 5;

/** Los espacios que la persona abrió hace poco (los más recientes primero). */
export async function listRecentSpaces(ctx: AdminContext): Promise<SpaceView[]> {
  const states = await ctx.db.spaceUserState.findMany({
    where: { membershipId: ctx.tenant.membershipId, visitedAt: { not: null } },
    orderBy: [{ visitedAt: "desc" }, { id: "asc" }],
    take: RECENT_LIMIT * 2,
    select: { spaceId: true },
  });
  if (states.length === 0) return [];
  const rows = await ctx.db.space.findMany({
    where: {
      AND: [
        visibleSpacesWhere(ctx, new Date()),
        { archivedAt: null },
        { id: { in: states.map((state) => state.spaceId) } },
      ],
    },
    select: spaceSelect,
  });
  const order = new Map(states.map((state, index) => [state.spaceId, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const views = await viewsOf(
    ctx,
    rows,
    await accessFor(ctx, { spaceIds: rows.map((row) => row.id) }),
  );
  return views.slice(0, RECENT_LIMIT);
}

/** Marca o desmarca un espacio como favorito (solo lo ve quien lo marca). */
export async function setSpaceFavorite(
  ctx: AdminContext,
  id: string,
  favorite: boolean,
): Promise<void> {
  requireLevel(await levelOfSpace(ctx, id), "VIEW");
  const membershipId = ctx.tenant.membershipId;
  // Un favorito nuevo va al final de su lista; al quitarlo se pierde su lugar.
  let favoritePosition: number | null = null;
  if (favorite) {
    const last = await ctx.db.spaceUserState.aggregate({
      where: { membershipId, favorite: true },
      _max: { favoritePosition: true },
    });
    favoritePosition = (last._max.favoritePosition ?? -1) + 1;
  }
  await ctx.db.spaceUserState.upsert({
    where: { spaceId_membershipId: { spaceId: id, membershipId } },
    create: { spaceId: id, membershipId, favorite, favoritePosition },
    update: { favorite, favoritePosition },
  });
}

/**
 * Guarda el orden de los favoritos de la persona: los ids dados van primero, en ese orden, y el resto
 * de sus favoritos detrás, como estaban. Ignora lo que no sea favorito suyo.
 */
export async function reorderFavoriteSpaces(
  ctx: AdminContext,
  ids: readonly string[],
): Promise<void> {
  const membershipId = ctx.tenant.membershipId;
  const current = await ctx.db.spaceUserState.findMany({
    where: { membershipId, favorite: true },
    select: { id: true, spaceId: true, favoritePosition: true },
    orderBy: [{ favoritePosition: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
  const bySpace = new Map(current.map((state) => [state.spaceId, state.id]));
  const first = [...new Set(ids)].filter((id) => bySpace.has(id));
  const rest = current.map((state) => state.spaceId).filter((id) => !first.includes(id));
  await ctx.db.$transaction(async (tx) => {
    for (const [index, spaceId] of [...first, ...rest].entries()) {
      await tx.spaceUserState.update({
        where: { id: bySpace.get(spaceId) ?? "" },
        data: { favoritePosition: index },
      });
    }
  });
}

/** Anota que la persona abrió el espacio (alimenta "Recientes"). */
export async function recordSpaceVisit(ctx: AdminContext, id: string): Promise<void> {
  requireLevel(await levelOfSpace(ctx, id), "VIEW");
  const membershipId = ctx.tenant.membershipId;
  const visitedAt = new Date();
  await ctx.db.spaceUserState.upsert({
    where: { spaceId_membershipId: { spaceId: id, membershipId } },
    create: { spaceId: id, membershipId, visitedAt },
    update: { visitedAt },
  });
}

async function loadSpace(ctx: AdminContext, id: string) {
  const row = await ctx.db.space.findFirst({ where: { id }, select: spaceSelect });
  if (row === null) throw notFound();
  return row;
}

export async function getSpace(ctx: AdminContext, id: string): Promise<SpaceView> {
  requireLevel(await levelOfSpace(ctx, id), "VIEW");
  return await viewOf(ctx, await loadSpace(ctx, id));
}

async function assertNameFree(ctx: AdminContext, name: string, exceptId?: string) {
  const taken = await ctx.db.space.findFirst({
    where: {
      nameKey: nameKeyOf(name),
      archivedAt: null,
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) {
    throw new AppError("CONFLICT", { message: contentMessages.spaceNameTaken });
  }
}

/** Un nombre libre entre los espacios activos: el dado o con " (2)", " (3)"… */
export async function freeSpaceName(ctx: Pick<AdminContext, "db">, base: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base} (${String(n)})`;
    const taken = await ctx.db.space.count({
      where: { nameKey: nameKeyOf(candidate), archivedAt: null },
    });
    if (taken === 0) return candidate;
  }
  throw new AppError("CONFLICT", { message: contentMessages.spaceNameTaken });
}

/**
 * ¿Puede poner un espacio en ese departamento (o en la empresa, con null)? Con spaces.create, en
 * cualquiera; un jefe o subjefe, solo en los suyos (y sus subáreas); fuera de su alcance, 404.
 */
async function assertCanPlaceIn(ctx: AdminContext, departmentId: string | null): Promise<void> {
  const mayCreate = ctx.actor.capabilities.includes("spaces.create");
  if (departmentId === null) {
    if (!mayCreate) throw forbidden();
    return;
  }
  const department = await ctx.db.department.findFirst({
    where: { id: departmentId },
    select: { id: true },
  });
  if (department === null) throw notFound();
  if (mayCreate) return;
  const { manage } = await peopleScopeOf(ctx);
  if (manage.kind === "global") return;
  if (manage.kind === "own" && manage.departmentIds.includes(departmentId)) return;
  throw notFound();
}

export async function createSpace(
  ctx: AdminContext,
  input: CreateSpaceInput,
): Promise<SpaceView> {
  const departmentId = input.departmentId ?? null;
  await assertCanPlaceIn(ctx, departmentId);
  const name = cleanName(input.name);
  await assertNameFree(ctx, name);
  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.space.create({
      data: {
        name,
        nameKey: nameKeyOf(name),
        icon: input.icon ?? null,
        color: input.color ?? null,
        description: input.description ?? null,
        // Confidencial implica privado.
        isPrivate: input.isPrivate || input.isConfidential,
        isConfidential: input.isConfidential,
        departmentId,
        departmentLevel: input.departmentLevel ?? "EDIT",
        includeSubareas: departmentId !== null && input.includeSubareas,
        createdById: ctx.tenant.membershipId,
      },
      select: spaceSelect,
    });
    // En un espacio de la empresa, quien lo crea lo gestiona (aunque no sea administrador). En
    // uno de departamento, lo gestionan sus jefes por el cargo.
    if (departmentId === null) {
      await tx.permission.create({
        data: {
          spaceId: created.id,
          membershipId: ctx.tenant.membershipId,
          level: "MANAGE",
          grantedById: ctx.tenant.membershipId,
        },
      });
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "space.create",
        entityType: "Space",
        entityId: created.id,
        metadata: {
          name,
          isPrivate: created.isPrivate,
          isConfidential: created.isConfidential,
          includeSubareas: created.includeSubareas,
          departmentId,
        },
      },
    );
    return created;
  });
  return await viewOf(ctx, row);
}

/** El espacio existe, se ve y la persona puede gestionarlo; si no, 404 o 403. */
async function manageable(ctx: AdminContext, id: string) {
  const level = requireLevel(await levelOfSpace(ctx, id), "VIEW");
  if (!canManageSpace(ctx, level)) throw forbidden();
  return { level, row: await loadSpace(ctx, id) };
}

export async function updateSpace(
  ctx: AdminContext,
  id: string,
  input: UpdateSpaceInput,
): Promise<SpaceView> {
  const { row } = await manageable(ctx, id);
  const data: Prisma.SpaceUncheckedUpdateInput = {};
  let nextDepartmentId = row.departmentId;
  if (input.departmentId !== undefined && input.departmentId !== row.departmentId) {
    // Cambiar de departamento pide el mismo permiso que crear ahí.
    await assertCanPlaceIn(ctx, input.departmentId);
    data.departmentId = input.departmentId;
    nextDepartmentId = input.departmentId;
  }
  if (input.departmentLevel !== undefined) data.departmentLevel = input.departmentLevel;
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (nameKeyOf(name) !== nameKeyOf(row.name)) await assertNameFree(ctx, name, id);
    data.name = name;
    data.nameKey = nameKeyOf(name);
  }
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.color !== undefined) data.color = input.color;
  if (input.description !== undefined) data.description = input.description;
  // Confidencial implica privado: pasar a confidencial lo hace privado y dejar de ser privado lo
  // saca de confidencial.
  const confidential = input.isConfidential ?? (input.isPrivate === false ? false : undefined);
  if (confidential !== undefined && confidential !== row.isConfidential) {
    data.isConfidential = confidential;
  }
  const isPrivate = confidential === true ? true : input.isPrivate;
  if (isPrivate !== undefined && isPrivate !== row.isPrivate) data.isPrivate = isPrivate;
  // "Incluir subáreas" solo existe en un espacio de departamento.
  if (nextDepartmentId === null) {
    if (row.includeSubareas) data.includeSubareas = false;
  } else if (input.includeSubareas !== undefined) {
    data.includeSubareas = input.includeSubareas;
  }
  if (Object.keys(data).length === 0) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.noChanges });
  }
  const updated = await ctx.db.$transaction(async (tx) => {
    const result = await tx.space.update({ where: { id }, data, select: spaceSelect });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "space.update",
        entityType: "Space",
        entityId: id,
        metadata: {
          ...(input.name === undefined ? {} : { renamedFrom: row.name }),
          ...(data.isPrivate === undefined ? {} : { isPrivate: data.isPrivate }),
          ...(data.isConfidential === undefined ? {} : { isConfidential: data.isConfidential }),
          ...(data.includeSubareas === undefined ? {} : { includeSubareas: data.includeSubareas }),
          ...(data.departmentId === undefined ? {} : { departmentId: data.departmentId }),
          ...(input.departmentLevel === undefined
            ? {}
            : { departmentLevel: input.departmentLevel }),
        },
      },
    );
    return result;
  });
  return await viewOf(ctx, updated);
}

export async function setSpaceArchived(
  ctx: AdminContext,
  id: string,
  archived: boolean,
): Promise<SpaceView> {
  const { row } = await manageable(ctx, id);
  if ((row.archivedAt !== null) === archived) return await viewOf(ctx, row);
  // Al restaurar, el nombre tiene que seguir libre entre los espacios activos.
  if (!archived) await assertNameFree(ctx, row.name, id);
  const updated = await ctx.db.$transaction(async (tx) => {
    const result = await tx.space.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select: spaceSelect,
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: archived ? "space.archive" : "space.restore",
        entityType: "Space",
        entityId: id,
      },
    );
    return result;
  });
  return await viewOf(ctx, updated);
}

/** Un espacio archivado solo se lee: lo llaman todas las escrituras de contenido. */
export async function assertSpaceWritable(ctx: AdminContext, spaceId: string): Promise<void> {
  const space = await ctx.db.space.findFirst({
    where: { id: spaceId },
    select: { archivedAt: true },
  });
  if (space === null) throw notFound();
  if (space.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: contentMessages.spaceArchived });
  }
}

export interface DepartmentOptionView {
  id: string;
  name: string;
}

/** Departamentos para dar acceso al espacio: lo ve quien gestiona el espacio (sea o no admin). */
export async function listDepartmentOptions(
  ctx: AdminContext,
  spaceId: string,
  query: ListSpaceMembersQuery,
): Promise<Page<DepartmentOptionView>> {
  await manageable(ctx, spaceId);
  const where: Prisma.DepartmentWhereInput =
    query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" } };
  const [rows, total] = await Promise.all([
    ctx.db.department.findMany({
      where,
      select: { id: true, name: true },
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.department.count({ where }),
  ]);
  return pageOf(rows, total, query);
}

/**
 * Departamentos entre los que se puede elegir al crear un espacio: todos con spaces.create (o
 * administrando), y solo los suyos (y sus subáreas) para un jefe o subjefe.
 */
export async function listSpaceDepartmentChoices(
  ctx: AdminContext,
  query: ListSpaceMembersQuery,
): Promise<Page<DepartmentOptionView>> {
  const { manage } = await peopleScopeOf(ctx);
  const all = ctx.actor.capabilities.includes("spaces.create") || manage.kind === "global";
  const scope: Prisma.DepartmentWhereInput = all
    ? {}
    : manage.kind === "own"
      ? { id: { in: manage.departmentIds } }
      : { id: { in: [] } };
  const where: Prisma.DepartmentWhereInput = {
    AND: [
      scope,
      query.q === undefined || query.q === ""
        ? {}
        : { name: { contains: query.q, mode: "insensitive" } },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.department.findMany({
      where,
      select: { id: true, name: true },
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.department.count({ where }),
  ]);
  return pageOf(rows, total, query);
}
