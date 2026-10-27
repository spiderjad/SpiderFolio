// Departamentos (CLAUDE.md, secciones 5, 6 y 9.3): área de la empresa que da acceso a contenido.
// Jerarquía opcional sin ciclos, cargos (jefe, subjefes) y miembros. Cada cambio queda en el AuditLog.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { freeSpaceName } from "../spaces/spaces.service.ts";
import { departmentMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { parentMapOf, wouldCreateCycle } from "./department-tree.ts";
import { canReadDepartment, peopleScopeOf } from "../people/people-scope.ts";
import { ledDepartmentIds, leaderPositions } from "./departments.scope.ts";
import type { DepartmentPosition } from "../../generated/prisma/client.ts";
import {
  memberSelect,
  toView as toMemberView,
  type MemberView,
} from "../members/members.service.ts";
import type {
  CreateDepartmentInput,
  DepartmentMembersQuery,
  DepartmentOptionsQuery,
  ListDepartmentsQuery,
  UpdateDepartmentInput,
} from "./departments.schemas.ts";

export interface DepartmentView {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  parentId: string | null;
  parentName: string | null;
  /** Subdepartamentos directos. */
  childCount: number;
  head: { membershipId: string; name: string } | null;
  deputies: { membershipId: string; name: string }[];
  /** Personas del departamento, jefe y subjefes incluidos. */
  memberCount: number;
  /** "manage": puede cambiarlo y gestionar a su gente; "read": solo ver (nombre, puesto, cargo). */
  access: "manage" | "read";
}

type Ctx = Pick<AdminContext, "db" | "tenant">;

export type Scope = "global" | "own";

/**
 * Propietario y administradores (con departments.manage) gestionan todos los departamentos; jefe
 * y subjefe, por cargo, solo los que lideran y sus subáreas (el alcance se calcula en cada
 * pedido: perder el cargo lo quita al instante). Fuera de su alcance, 404; sin alcance, 403.
 */
export async function authorizeDepartment(ctx: AdminContext, departmentId: string): Promise<Scope> {
  const scope = await peopleScopeOf(ctx);
  const { manage } = scope;
  if (manage.kind === "global") {
    if (!ctx.actor.capabilities.includes("departments.manage")) throw forbidden();
    return "global";
  }
  if (manage.kind === "own" && manage.departmentIds.includes(departmentId)) return "own";
  // Lo que se ve pero no se gestiona: 403. Lo que ni se ve: 404 (no existe para la persona).
  if (canReadDepartment(scope, departmentId)) throw forbidden();
  if (scope.directory === "self") throw forbidden();
  throw notFound();
}

/**
 * Leer un departamento (estructura y personas con nombre, puesto y cargo): lo ven todos los
 * miembros con plaza completa según "Los miembros ven" (toda la empresa o solo su departamento);
 * lectores e invitados no ven Departamentos (403); lo que no se ve, 404.
 */
export async function authorizeDepartmentRead(
  ctx: AdminContext,
  departmentId: string,
): Promise<"manage" | "read"> {
  const scope = await peopleScopeOf(ctx);
  if (scope.directory === "self") throw forbidden();
  if (!canReadDepartment(scope, departmentId)) throw notFound();
  const { manage } = scope;
  if (manage.kind === "global") {
    return ctx.actor.capabilities.includes("departments.manage") ? "manage" : "read";
  }
  return manage.kind === "own" && manage.departmentIds.includes(departmentId) ? "manage" : "read";
}

const positionRank = { HEAD: 2, DEPUTY: 1, MEMBER: 0 } as const;

/**
 * Un jefe no gestiona a quien tenga un rol igual o superior al suyo: ni administradores ni
 * propietarios, ni a sí mismo, ni a quien tenga un cargo igual o mayor (el jefe sí puede con un
 * subjefe; un subjefe no puede con otro subjefe ni con un jefe).
 */
async function assertLeaderCanTouch(ctx: AdminContext, membershipIds: readonly string[]) {
  if (membershipIds.length === 0) return;
  const { manage } = await peopleScopeOf(ctx);
  const actorRank = manage.kind === "own" ? positionRank[manage.rank] : 0;
  const targets = await ctx.db.membership.findMany({
    where: { id: { in: [...membershipIds] } },
    select: {
      id: true,
      role: { select: { base: true } },
      departments: {
        where: { position: { in: [...leaderPositions] } },
        select: { position: true },
      },
    },
  });
  if (targets.length !== membershipIds.length) throw notFound();
  for (const target of targets) {
    const targetRank = Math.max(0, ...target.departments.map((d) => positionRank[d.position]));
    const beyond =
      target.id === ctx.tenant.membershipId ||
      target.role.base === "ADMIN" ||
      target.role.base === "OWNER" ||
      targetRank >= actorRank;
    if (beyond) {
      throw new AppError("FORBIDDEN", { message: departmentMessages.leaderCannotTouch });
    }
  }
}

/** Metadatos de auditoría: lo que se hizo con alcance propio queda marcado. */
const scoped = (scope: Scope) => (scope === "own" ? { scope: "own" } : {});

export const departmentSelect = {
  id: true,
  name: true,
  description: true,
  color: true,
  parentId: true,
} as const;

export async function toViews(
  ctx: Ctx,
  rows: {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
    parentId: string | null;
  }[],
): Promise<DepartmentView[]> {
  const parentIds = [
    ...new Set(rows.flatMap((row) => (row.parentId === null ? [] : [row.parentId]))),
  ];
  const [counts, leaders, parents, children] = await Promise.all([
    ctx.db.departmentMember.groupBy({
      by: ["departmentId"],
      where: { departmentId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    }),
    ctx.db.departmentMember.findMany({
      where: {
        departmentId: { in: rows.map((row) => row.id) },
        position: { in: [...leaderPositions] },
      },
      select: {
        departmentId: true,
        membershipId: true,
        position: true,
        membership: { select: { user: { select: { name: true } } } },
      },
    }),
    parentIds.length === 0
      ? Promise.resolve([])
      : ctx.db.department.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, name: true },
        }),
    ctx.db.department.groupBy({
      by: ["parentId"],
      where: { parentId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    }),
  ]);
  const { manage } = await peopleScopeOf(ctx);
  const canManageDepartments =
    manage.kind === "global" && ctx.tenant.capabilities.includes("departments.manage");
  const manages = (id: string): boolean =>
    canManageDepartments || (manage.kind === "own" && manage.departmentIds.includes(id));
  const parentName = new Map(parents.map((p) => [p.id, p.name]));
  const childCount = new Map(children.map((c) => [c.parentId, c._count._all]));
  const countOf = new Map(counts.map((c) => [c.departmentId, c._count._all]));
  const leaderViews = (departmentId: string, position: DepartmentPosition) =>
    leaders
      .filter((l) => l.departmentId === departmentId && l.position === position)
      .map((l) => ({ membershipId: l.membershipId, name: l.membership.user.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    parentId: row.parentId,
    parentName: row.parentId === null ? null : (parentName.get(row.parentId) ?? null),
    childCount: childCount.get(row.id) ?? 0,
    head: leaderViews(row.id, "HEAD")[0] ?? null,
    deputies: leaderViews(row.id, "DEPUTY"),
    memberCount: countOf.get(row.id) ?? 0,
    access: manages(row.id) ? "manage" : "read",
  }));
}

export async function listDepartments(
  ctx: AdminContext,
  query: ListDepartmentsQuery,
): Promise<Page<DepartmentView>> {
  // Qué departamentos se ven según "Los miembros ven" (lectores e invitados, ninguno: 403).
  const scope = await peopleScopeOf(ctx);
  if (scope.directory === "self") throw forbidden();
  const ledIds =
    scope.readDepartmentIds !== null
      ? scope.readDepartmentIds
      : query.led
        ? await ledDepartmentIds(ctx, ctx.tenant.membershipId)
        : null;
  const where = {
    ...(ledIds === null ? {} : { id: { in: ledIds } }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" as const } }),
    ...(query.parent === undefined
      ? {}
      : query.parent === "root"
        ? // Con alcance propio, la raíz de su árbol son sus áreas cuyo padre queda fuera de él.
          ledIds === null
          ? { parentId: null }
          : { OR: [{ parentId: null }, { parentId: { notIn: ledIds } }] }
        : { parentId: query.parent }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.department.findMany({
      where,
      select: departmentSelect,
      orderBy: stableOrder(
        query.sort === "members" ? { members: { _count: query.dir } } : { name: query.dir },
      ),
      ...offsetArgs(query),
    }),
    ctx.db.department.count({ where }),
  ]);
  return pageOf(await toViews(ctx, rows), total, query);
}

export interface DepartmentOptionView extends DepartmentView {
  /** Nivel en el árbol (0 = raíz); solo con la lista sin búsqueda, en orden de árbol. */
  depth: number;
  /** Nombres de los ancestros más el propio ("Finanzas", "Contabilidad"). */
  path: string[];
}

/**
 * Para los combobox (padre, departamentos de una persona…), paginado. Sin búsqueda, en orden de
 * árbol (cada subdepartamento bajo su padre, con su nivel); con búsqueda, por nombre y con la ruta
 * completa. Con `ids` devuelve solo esos (para mostrar lo ya elegido). Quien solo tiene alcance
 * propio ve únicamente los que lidera, y la ruta no revela ancestros fuera de su alcance.
 */
export async function listDepartmentOptions(
  ctx: AdminContext,
  query: DepartmentOptionsQuery,
): Promise<Page<DepartmentOptionView>> {
  const { manage } = await peopleScopeOf(ctx);
  if (manage.kind === "none") throw forbidden();
  const ledIds = manage.kind === "own" ? manage.departmentIds : null;
  const all = await ctx.db.department.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const visible = ledIds === null ? null : new Set(ledIds);
  const nodes = all.filter((d) => visible === null || visible.has(d.id));
  const byId = new Map(nodes.map((d) => [d.id, d]));
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "es") * (query.dir === "desc" ? -1 : 1);

  const pathOf = (id: string): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return names;
  };

  const needle = (query.q ?? "").trim().toLowerCase();
  let ordered: { id: string; depth: number }[];
  if (query.ids !== undefined) {
    const wanted = new Set(query.ids);
    ordered = nodes
      .filter((d) => wanted.has(d.id))
      .sort(byName)
      .map((d) => ({ id: d.id, depth: 0 }));
  } else if (needle !== "") {
    ordered = nodes
      .filter((d) => d.name.toLowerCase().includes(needle))
      .sort(byName)
      .map((d) => ({ id: d.id, depth: 0 }));
  } else {
    // Orden de árbol: primero cada raíz y, debajo, sus hijos, por nombre.
    const children = new Map<string | null, typeof nodes>();
    for (const node of nodes) {
      const key = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
      children.set(key, [...(children.get(key) ?? []), node]);
    }
    ordered = [];
    const seen = new Set<string>();
    const walk = (parentId: string | null, depth: number) => {
      for (const child of [...(children.get(parentId) ?? [])].sort(byName)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        ordered.push({ id: child.id, depth });
        walk(child.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  const { skip, take } = offsetArgs(query);
  const slice = ordered.slice(skip, skip + take);
  const rows = await ctx.db.department.findMany({
    where: { id: { in: slice.map((d) => d.id) } },
    select: departmentSelect,
  });
  const views = new Map((await toViews(ctx, rows)).map((view) => [view.id, view]));
  const items = slice.flatMap(({ id, depth }) => {
    const view = views.get(id);
    return view === undefined ? [] : [{ ...view, depth, path: pathOf(id) }];
  });
  return pageOf(items, ordered.length, query);
}

async function loadDepartment(ctx: Ctx, id: string) {
  const row = await ctx.db.department.findFirst({ where: { id }, select: departmentSelect });
  if (row === null) throw notFound();
  return row;
}

export async function getDepartment(
  ctx: AdminContext,
  id: string,
): Promise<{ department: DepartmentView; ancestors: { id: string; name: string }[] }> {
  await authorizeDepartmentRead(ctx, id);
  const row = await loadDepartment(ctx, id);
  const [department] = await toViews(ctx, [row]);
  if (department === undefined) throw notFound();
  // Ruta desde la raíz hasta el padre. No se revelan ancestros que la persona no ve.
  const all = await ctx.db.department.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(all.map((d) => [d.id, d]));
  const { readDepartmentIds } = await peopleScopeOf(ctx);
  const allowed = readDepartmentIds === null ? null : new Set(readDepartmentIds);
  const ancestors: { id: string; name: string }[] = [];
  let current = row.parentId === null ? undefined : byId.get(row.parentId);
  for (let hops = 0; current !== undefined && hops <= all.length; hops++) {
    if (allowed === null || allowed.has(current.id)) {
      ancestors.unshift({ id: current.id, name: current.name });
    }
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return { department, ancestors };
}

/** Miembros del departamento, de a páginas y por nombre; el jefe se puede omitir (va aparte). */
export async function listDepartmentMembers(
  ctx: AdminContext,
  id: string,
  query: DepartmentMembersQuery,
): Promise<Page<MemberView>> {
  const scope = await authorizeDepartment(ctx, id);
  await loadDepartment(ctx, id);
  const q = query.q;
  const where = {
    // Un jefe no ve datos de propietarios ni administradores.
    ...(scope === "own" ? { role: { base: { notIn: ["OWNER" as const, "ADMIN" as const] } } } : {}),
    departments: {
      some: {
        departmentId: id,
        ...(query.positions === "leaders"
          ? { position: { in: [...leaderPositions] } }
          : query.positions === "members"
            ? { position: "MEMBER" as const }
            : {}),
      },
    },
    ...(q === undefined || q === ""
      ? {}
      : {
          OR: [
            { user: { name: { contains: q, mode: "insensitive" as const } } },
            { user: { email: { contains: q, mode: "insensitive" as const } } },
            { jobTitle: { contains: q, mode: "insensitive" as const } },
          ],
        }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.membership.findMany({
      where,
      select: memberSelect,
      orderBy: stableOrder({ user: { name: query.dir } }),
      ...offsetArgs(query),
    }),
    ctx.db.membership.count({ where }),
  ]);
  return pageOf(
    rows.map((row) => toMemberView(row, ctx.info.actorId)),
    total,
    query,
  );
}

async function assertNameFree(ctx: Ctx, name: string, exceptId?: string) {
  const taken = await ctx.db.department.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) throw new AppError("CONFLICT", { message: departmentMessages.nameTaken });
}

/** Quien tiene un cargo tiene que ser un miembro activo y no un invitado externo. */
async function assertCanLead(ctx: Ctx, membershipId: string) {
  const member = await ctx.db.membership.findFirst({
    where: { id: membershipId, status: "ACTIVE" },
    select: { id: true, role: { select: { base: true } } },
  });
  if (member === null) {
    throw new AppError("BAD_REQUEST", { message: departmentMessages.managerNotActive });
  }
  if (member.role.base === "GUEST") {
    throw new AppError("BAD_REQUEST", { message: departmentMessages.guestsHaveNoDepartments });
  }
}

type PositionDb = Pick<Ctx["db"], "departmentMember">;

/**
 * Da un cargo (y la pertenencia, si no la tenía). Un solo jefe por departamento: el anterior
 * pasa a miembro.
 */
async function writePosition(
  db: PositionDb,
  departmentId: string,
  membershipId: string,
  position: DepartmentPosition,
) {
  if (position === "HEAD") {
    await db.departmentMember.updateMany({
      where: { departmentId, position: "HEAD", NOT: { membershipId } },
      data: { position: "MEMBER" },
    });
  }
  await db.departmentMember.upsert({
    where: { departmentId_membershipId: { departmentId, membershipId } },
    create: { departmentId, membershipId, position },
    update: { position },
  });
}

/**
 * Nombra o releva a jefe, subjefe o miembro. Propietario y administradores, cualquier cargo; un
 * jefe, solo subjefes de su área (nombrar a uno que ya está en el departamento, o relevarlo).
 */
export async function setDepartmentPosition(
  ctx: AdminContext,
  id: string,
  membershipId: string,
  position: DepartmentPosition,
): Promise<DepartmentView> {
  const scope = await authorizeDepartment(ctx, id);
  if (scope === "own") {
    const { manage } = await peopleScopeOf(ctx);
    if (manage.kind !== "own" || !manage.headDepartmentIds.includes(id) || position === "HEAD") {
      throw forbidden();
    }
    const current = await ctx.db.departmentMember.findFirst({
      where: { departmentId: id, membershipId },
      select: { position: true },
    });
    if (current === null) throw notFound();
    if (current.position === "HEAD") throw forbidden();
    await assertLeaderCanTouch(ctx, [membershipId]);
  }
  const department = await loadDepartment(ctx, id);
  if (position !== "MEMBER") {
    await assertCanLead(ctx, membershipId);
  } else {
    const current = await ctx.db.departmentMember.findFirst({
      where: { departmentId: id, membershipId },
      select: { membershipId: true },
    });
    if (current === null) throw notFound();
  }
  await ctx.db.$transaction(async (tx) => {
    await writePosition(tx, id, membershipId, position);
  });
  await auditAdmin(ctx, {
    action: "department.position.set",
    entityType: "Department",
    entityId: id,
    metadata: { name: department.name, membershipId, position, ...scoped(scope) },
  });
  const [view] = await toViews(ctx, [department]);
  if (view === undefined) throw notFound();
  return view;
}

/** Nombrar jefe a un lector: el cargo no le da alcance hasta que tenga una plaza completa. */
export async function leaderNeedsFullSeat(
  ctx: AdminContext,
  membershipId: string,
): Promise<boolean> {
  const member = await ctx.db.membership.findFirst({
    where: { id: membershipId },
    select: { seatType: true },
  });
  return member?.seatType === "READER";
}

export async function createDepartment(
  ctx: AdminContext,
  input: CreateDepartmentInput,
): Promise<DepartmentView> {
  await assertNameFree(ctx, input.name);
  const spaceName = input.createSpace ? await freeSpaceName(ctx, input.name) : null;
  // El padre tiene que ser de este workspace (forTenant lo limita; si no está, 404).
  if (input.parentId !== undefined && input.parentId !== null) {
    await loadDepartment(ctx, input.parentId);
  }
  if (input.headId !== undefined && input.headId !== null) {
    await assertCanLead(ctx, input.headId);
  }
  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.department.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        parentId: input.parentId ?? null,
      },
      select: departmentSelect,
    });
    if (input.headId !== undefined && input.headId !== null) {
      await writePosition(tx, created.id, input.headId, "HEAD");
    }
    if (spaceName !== null) {
      // Sus jefes lo gestionan por el cargo y sus miembros editan; los demás lo ven.
      await tx.space.create({
        data: {
          name: spaceName,
          nameKey: nameKeyOf(spaceName),
          departmentId: created.id,
          departmentLevel: "EDIT",
          createdById: ctx.tenant.membershipId,
        },
      });
    }
    return created;
  });
  await auditAdmin(ctx, {
    action: "department.create",
    entityType: "Department",
    entityId: row.id,
    metadata: { name: row.name, parentId: row.parentId, space: spaceName },
  });
  const [view] = await toViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

export async function updateDepartment(
  ctx: AdminContext,
  id: string,
  input: UpdateDepartmentInput,
): Promise<DepartmentView> {
  const current = await loadDepartment(ctx, id);
  if (input.name !== undefined && input.name !== current.name) {
    await assertNameFree(ctx, input.name, id);
  }
  if (input.parentId !== undefined && input.parentId !== current.parentId) {
    if (input.parentId !== null) {
      await loadDepartment(ctx, input.parentId);
      const all = await ctx.db.department.findMany({ select: { id: true, parentId: true } });
      if (wouldCreateCycle(id, input.parentId, parentMapOf(all))) {
        throw new AppError("BAD_REQUEST", { message: departmentMessages.parentCycle });
      }
    }
  }
  if (input.headId !== undefined && input.headId !== null) {
    await assertCanLead(ctx, input.headId);
  }
  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.department.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      },
      select: departmentSelect,
    });
    if (input.headId === null) {
      // Sin jefe: el anterior sigue en el departamento, como miembro.
      await tx.departmentMember.updateMany({
        where: { departmentId: id, position: "HEAD" },
        data: { position: "MEMBER" },
      });
    } else if (input.headId !== undefined) {
      await writePosition(tx, id, input.headId, "HEAD");
    }
    return updated;
  });
  const moved = input.parentId !== undefined && input.parentId !== current.parentId;
  await auditAdmin(ctx, {
    action: moved ? "department.move" : "department.update",
    entityType: "Department",
    entityId: id,
    metadata: {
      before: { name: current.name, parentId: current.parentId },
      after: { name: row.name, parentId: row.parentId },
      ...(input.headId === undefined ? {} : { headId: input.headId }),
    },
  });
  const [view] = await toViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

/**
 * Borra el departamento: sus subdepartamentos suben un nivel y sus miembros dejan de
 * pertenecer a él (la baja de pertenencia es en cascada). Los accesos que daba se pierden:
 * la app lo avisa antes de confirmar.
 */
export async function deleteDepartment(ctx: AdminContext, id: string): Promise<void> {
  const current = await loadDepartment(ctx, id);
  const [memberCount, childCount] = await Promise.all([
    ctx.db.departmentMember.count({ where: { departmentId: id } }),
    ctx.db.department.count({ where: { parentId: id } }),
  ]);
  await ctx.db.$transaction(async (tx) => {
    // Sus espacios pasan a ser de la empresa (la clave compuesta no admite SetNull).
    await tx.space.updateMany({ where: { departmentId: id }, data: { departmentId: null } });
    await tx.department.updateMany({
      where: { parentId: id },
      data: { parentId: current.parentId },
    });
    await tx.department.delete({ where: { id } });
  });
  await auditAdmin(ctx, {
    action: "department.delete",
    entityType: "Department",
    entityId: id,
    metadata: { name: current.name, members: memberCount, subdepartmentsMoved: childCount },
  });
}

export async function addDepartmentMembers(
  ctx: AdminContext,
  id: string,
  membershipIds: readonly string[],
): Promise<{ added: number }> {
  const scope = await authorizeDepartment(ctx, id);
  if (scope === "own") await assertLeaderCanTouch(ctx, membershipIds);
  const department = await loadDepartment(ctx, id);
  const found = await ctx.db.membership.findMany({
    where: { id: { in: [...membershipIds] } },
    select: { id: true, role: { select: { base: true } } },
  });
  if (found.length !== membershipIds.length) throw notFound();
  if (found.some((m) => m.role.base === "GUEST")) {
    throw new AppError("BAD_REQUEST", { message: departmentMessages.guestsHaveNoDepartments });
  }
  const { count } = await ctx.db.departmentMember.createMany({
    data: membershipIds.map((membershipId) => ({ departmentId: id, membershipId })),
    skipDuplicates: true,
  });
  await auditAdmin(ctx, {
    action: "department.members.add",
    entityType: "Department",
    entityId: id,
    metadata: {
      name: department.name,
      requested: membershipIds.length,
      added: count,
      ...scoped(scope),
    },
  });
  return { added: count };
}

export async function removeDepartmentMember(
  ctx: AdminContext,
  id: string,
  membershipId: string,
): Promise<void> {
  const scope = await authorizeDepartment(ctx, id);
  if (scope === "own") await assertLeaderCanTouch(ctx, [membershipId]);
  const department = await loadDepartment(ctx, id);
  // Al salir del departamento pierde también el cargo (vive en la pertenencia).
  const { count } = await ctx.db.departmentMember.deleteMany({
    where: { departmentId: id, membershipId },
  });
  if (count === 0) throw notFound();
  await auditAdmin(ctx, {
    action: "department.members.remove",
    entityType: "Department",
    entityId: id,
    metadata: { name: department.name, membershipId, ...scoped(scope) },
  });
}

/**
 * Pasa a una persona de un departamento a otro en un solo paso. Pierde el cargo que tenía en el
 * de origen y entra al nuevo como miembro (el cargo no se asigna solo).
 */
export async function moveDepartmentMember(
  ctx: AdminContext,
  fromId: string,
  membershipId: string,
  toId: string,
): Promise<void> {
  // Con alcance propio hay que liderar los dos: no se manda gente a un área que no es suya.
  const scope = await authorizeDepartment(ctx, fromId);
  if (scope === "own") {
    await authorizeDepartment(ctx, toId);
    await assertLeaderCanTouch(ctx, [membershipId]);
  }
  const [from, to] = await Promise.all([loadDepartment(ctx, fromId), loadDepartment(ctx, toId)]);
  if (fromId === toId) {
    throw new AppError("BAD_REQUEST", { message: departmentMessages.moveToSame });
  }
  const member = await ctx.db.membership.findFirst({
    where: { id: membershipId, departments: { some: { departmentId: fromId } } },
    select: { id: true, role: { select: { base: true } } },
  });
  if (member === null) throw notFound();
  if (member.role.base === "GUEST") {
    throw new AppError("BAD_REQUEST", { message: departmentMessages.guestsHaveNoDepartments });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.departmentMember.createMany({
      data: [{ departmentId: toId, membershipId }],
      skipDuplicates: true,
    });
    await tx.departmentMember.deleteMany({ where: { departmentId: fromId, membershipId } });
  });
  await auditAdmin(ctx, {
    action: "department.members.move",
    entityType: "Department",
    entityId: fromId,
    metadata: { from: from.name, to: to.name, membershipId, ...scoped(scope) },
  });
}

/**
 * A qué espacios, carpetas y documentos da acceso el departamento. Llega con espacios y
 * permisos (módulos 3 y 5); la forma de la respuesta ya es la definitiva.
 */
export async function departmentAccess(ctx: Ctx, id: string) {
  await loadDepartment(ctx, id);
  return { spaces: [], folders: [], documents: [] };
}
