// Organigrama de Miembros (CLAUDE.md, sección 9.3): por rama, con jefe, subjefes y miembros.
// Cada persona aparece una vez por departamento al que pertenece (jefe, subjefes y miembros);
// quien no pertenece a ninguno va en "Sin departamento". Todo paginado en la base: los
// departamentos de a páginas y, dentro de cada bloque, solo las primeras personas (el resto se
// pide con "Ver más").
import type {
  DepartmentPosition,
  Prisma,
  SeatType,
  SystemRole,
} from "../../generated/prisma/client.ts";
import { forbidden, notFound } from "../../lib/errors.ts";
import {
  nextOffsetCursor,
  offsetArgs,
  pageOf,
  stableOrder,
  type Page,
} from "../../lib/pagination.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { parentMapOf, withAncestors } from "../departments/department-tree.ts";
import { scopeWhere } from "../departments/departments.scope.ts";
import { peopleScopeOf, type ManageScope } from "../people/people-scope.ts";
import type { MemberVisibility } from "../workspaces/settings.ts";
import {
  departmentSelect,
  toViews,
  type DepartmentView,
} from "../departments/departments.service.ts";
import type { OrgChartQuery, OrgSearchQuery } from "./members.schemas.ts";
import { memberSelect, toView } from "./members.service.ts";

/**
 * Persona del organigrama (DTO de directorio). Los datos de gestión (email, plaza, estado, último
 * acceso) solo llegan si la persona está dentro del alcance de gestión de quien pregunta.
 */
export interface OrgPersonView {
  id: string;
  name: string;
  jobTitle: string | null;
  departments: { id: string; name: string; position: DepartmentPosition }[];
  managedDepartments: { id: string; name: string; position: "HEAD" | "DEPUTY" }[];
  isSelf: boolean;
  avatarUrl: string | null;
  management: {
    email: string | null;
    emailVerified: boolean;
    roleName: string;
    roleBase: SystemRole;
    seatType: SeatType;
    status: "ACTIVE" | "SUSPENDED";
    lastSeenAt: Date | null;
  } | null;
}

export interface DepartmentBlock {
  department: DepartmentView;
  head: OrgPersonView | null;
  deputies: OrgPersonView[];
  /** Solo quienes no tienen cargo. */
  members: { items: OrgPersonView[]; total: number; nextCursor: string | null };
}

export interface UnassignedBlock {
  members: { items: OrgPersonView[]; total: number; nextCursor: string | null };
}

type MemberRow = Parameters<typeof toView>[0];

/** Alcance de quien mira: qué personas ve y de cuáles ve los datos de gestión. */
interface OrgViewer {
  manage: ManageScope;
  /** Con "solo su departamento": los departamentos que se muestran. */
  limitTo: string[] | null;
  selfUserId: string;
  visibility: MemberVisibility;
}

function manages(viewer: OrgViewer, row: MemberRow): boolean {
  if (viewer.manage.kind === "global") return true;
  if (viewer.manage.kind === "none") return false;
  const scope = viewer.manage.departmentIds;
  // Los datos de propietarios y administradores son de la administración, no de los jefes.
  if (row.role.base === "OWNER" || row.role.base === "ADMIN") return false;
  return row.departments.some((d) => scope.includes(d.department.id));
}

function toOrgPerson(viewer: OrgViewer, row: MemberRow): OrgPersonView {
  const view = toView(row, viewer.selfUserId);
  return {
    id: view.id,
    name: view.name,
    jobTitle: view.jobTitle,
    departments: view.departments,
    managedDepartments: view.managedDepartments,
    isSelf: view.isSelf,
    avatarUrl: view.avatarUrl,
    management: manages(viewer, row)
      ? {
          email: view.email,
          emailVerified: view.emailVerified,
          roleName: view.roleName,
          roleBase: view.roleBase,
          seatType: view.seatType,
          status: view.status,
          lastSeenAt: view.lastSeenAt,
        }
      : null,
  };
}

/** Quién aparece: los suspendidos solo para quien los gestiona. */
function visibleWhere(viewer: OrgViewer): Prisma.MembershipWhereInput {
  const { manage } = viewer;
  if (manage.kind === "global") return {};
  if (manage.kind === "none") return { status: "ACTIVE" };
  return {
    OR: [
      { status: "ACTIVE" },
      { departments: { some: { departmentId: { in: manage.departmentIds } } } },
    ],
  };
}

async function viewerOf(ctx: AdminContext): Promise<OrgViewer> {
  const scope = await peopleScopeOf(ctx);
  // Lectores e invitados no ven el organigrama.
  if (scope.directory === "self") throw forbidden();
  return {
    manage: scope.manage,
    // Con "solo su departamento": los suyos y sus subáreas.
    limitTo: scope.directory === "department" ? scope.readDepartmentIds : null,
    selfUserId: ctx.info.actorId,
    visibility: scope.visibility,
  };
}

const byName: Prisma.MembershipOrderByWithRelationInput[] = [
  { user: { name: "asc" } },
  { id: "asc" },
];

async function blocksOf(
  ctx: AdminContext,
  viewer: OrgViewer,
  rows: Parameters<typeof toViews>[1],
  preview: number,
): Promise<DepartmentBlock[]> {
  const departments = await toViews(ctx, rows);
  return await Promise.all(
    departments.map(async (department): Promise<DepartmentBlock> => {
      const withPosition = (position: DepartmentPosition) => ({
        AND: [
          { departments: { some: { departmentId: department.id, position } } },
          visibleWhere(viewer),
        ],
      });
      const [head, deputies, members, count] = await Promise.all([
        department.head === null
          ? Promise.resolve(null)
          : ctx.db.membership.findFirst({ where: withPosition("HEAD"), select: memberSelect }),
        ctx.db.membership.findMany({
          where: withPosition("DEPUTY"),
          select: memberSelect,
          orderBy: byName,
        }),
        ctx.db.membership.findMany({
          where: withPosition("MEMBER"),
          select: memberSelect,
          orderBy: byName,
          take: preview,
        }),
        ctx.db.membership.count({ where: withPosition("MEMBER") }),
      ]);
      return {
        department,
        head: head === null ? null : toOrgPerson(viewer, head),
        deputies: deputies.map((m) => toOrgPerson(viewer, m)),
        members: {
          items: members.map((m) => toOrgPerson(viewer, m)),
          total: count,
          nextCursor: nextOffsetCursor(0, members.length, count),
        },
      };
    }),
  );
}

async function unassignedOf(
  ctx: AdminContext,
  viewer: OrgViewer,
  preview: number,
): Promise<UnassignedBlock> {
  const where = { AND: [{ departments: { none: {} } }, visibleWhere(viewer)] };
  const [items, total] = await Promise.all([
    ctx.db.membership.findMany({ where, select: memberSelect, orderBy: byName, take: preview }),
    ctx.db.membership.count({ where }),
  ]);
  return {
    members: {
      items: items.map((m) => toOrgPerson(viewer, m)),
      total,
      nextCursor: nextOffsetCursor(0, items.length, total),
    },
  };
}

export interface OrgChartView {
  /** Opción de Seguridad "Los miembros ven": la interfaz avisa a quien ve todo cuando es "department". */
  memberVisibility: MemberVisibility;
  company: { name: string; owner: { membershipId: string; name: string } | null };
  /** Departamentos de este nivel (la raíz o los hijos de `parent`). */
  departments: Page<DepartmentBlock>;
  /** Solo en la raíz. */
  unassigned: UnassignedBlock | null;
}

/** Una rama del organigrama: los departamentos de un nivel, con jefe, subjefes y primeras personas. */
export async function orgChartBranch(
  ctx: AdminContext,
  query: OrgChartQuery,
): Promise<OrgChartView> {
  const isRoot = query.parent === "root";
  const viewer = await viewerOf(ctx);
  // Con "solo su departamento" solo se ve la propia rama: los primeros niveles son sus
  // departamentos (cuyo padre queda fuera) y "Sin departamento" no se muestra.
  const ids = viewer.limitTo;
  const where: Prisma.DepartmentWhereInput =
    ids === null
      ? { parentId: isRoot ? null : query.parent }
      : isRoot
        ? { id: { in: ids }, OR: [{ parentId: null }, { parentId: { notIn: ids } }] }
        : { parentId: query.parent, id: { in: ids } };
  const showUnassigned = isRoot && ids === null;
  const [workspace, owner, rows, total, unassigned] = await Promise.all([
    ctx.db.workspace.findFirst({ select: { name: true } }),
    isRoot
      ? ctx.db.membership.findFirst({
          where: { role: { base: "OWNER" } },
          select: { id: true, user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve(null),
    ctx.db.department.findMany({
      where,
      select: departmentSelect,
      orderBy: stableOrder({ name: "asc" }),
      ...offsetArgs(query),
    }),
    ctx.db.department.count({ where }),
    showUnassigned ? unassignedOf(ctx, viewer, query.preview) : Promise.resolve(null),
  ]);
  return {
    memberVisibility: viewer.visibility,
    company: {
      name: workspace?.name ?? "",
      owner: owner === null ? null : { membershipId: owner.id, name: owner.user.name },
    },
    departments: pageOf(await blocksOf(ctx, viewer, rows, query.preview), total, query),
    unassigned,
  };
}

export interface OrgSearchHit {
  membershipId: string;
  name: string;
  /** Dónde está: cada departamento con la cadena de ids desde la raíz (para abrir las ramas). */
  places: { departmentId: string; departmentName: string; path: string[] }[];
}

/** Buscador del organigrama: personas por nombre, con el camino a cada departamento suyo. */
export async function searchOrgChart(
  ctx: AdminContext,
  query: OrgSearchQuery,
): Promise<OrgSearchHit[]> {
  const viewer = await viewerOf(ctx);
  const ids = viewer.limitTo;
  const [rows, all] = await Promise.all([
    ctx.db.membership.findMany({
      where: {
        AND: [
          { user: { name: { contains: query.q, mode: "insensitive" } } },
          visibleWhere(viewer),
          ids === null ? {} : scopeWhere({ kind: "own", departmentIds: ids }),
        ],
      },
      select: {
        id: true,
        user: { select: { name: true } },
        departments: { select: { department: { select: { id: true, name: true } } } },
      },
      orderBy: stableOrder({ user: { name: "asc" } }),
      take: 20,
    }),
    ctx.db.department.findMany({ select: { id: true, parentId: true } }),
  ]);
  const parents = parentMapOf(all);
  return rows.map((row) => ({
    membershipId: row.id,
    name: row.user.name,
    places: row.departments
      // Con "solo su departamento" no se revelan departamentos fuera de su rama.
      .filter(({ department }) => ids === null || ids.includes(department.id))
      .map(({ department }) => ({
        departmentId: department.id,
        departmentName: department.name,
        // withAncestors va de abajo hacia arriba; se invierte para recorrer desde la raíz.
        path: withAncestors([department.id], parents).reverse(),
      })),
  }));
}

export interface OrgMembersQuery {
  q?: string | undefined;
  positions?: "leaders" | "members" | undefined;
  page: number;
  pageSize: number;
  cursor?: string | undefined;
  sort: string;
  dir: "asc" | "desc";
}

/**
 * Personas de un departamento para el "Ver más" del organigrama (DTO de directorio), paginadas.
 * Respeta lo mismo que el organigrama: la opción de visibilidad de los miembros, los suspendidos
 * solo para quien los gestiona y los datos de gestión solo dentro del alcance. `none` son las
 * personas sin departamento (solo para quien ve toda la empresa).
 */
export async function listOrgDepartmentMembers(
  ctx: AdminContext,
  departmentId: string,
  query: OrgMembersQuery,
): Promise<Page<OrgPersonView>> {
  const viewer = await viewerOf(ctx);
  const unassigned = departmentId === "none";
  if (viewer.limitTo !== null && (unassigned || !viewer.limitTo.includes(departmentId))) {
    throw notFound();
  }
  if (!unassigned) {
    const found = await ctx.db.department.count({ where: { id: departmentId } });
    if (found === 0) throw notFound();
  }
  const q = query.q;
  const where: Prisma.MembershipWhereInput = {
    AND: [
      unassigned
        ? { departments: { none: {} } }
        : {
            departments: {
              some: {
                departmentId,
                ...(query.positions === "leaders"
                  ? { position: { in: ["HEAD", "DEPUTY"] as DepartmentPosition[] } }
                  : query.positions === "members"
                    ? { position: "MEMBER" as const }
                    : {}),
              },
            },
          },
      visibleWhere(viewer),
      q === undefined || q === ""
        ? {}
        : {
            OR: [
              { user: { name: { contains: q, mode: "insensitive" as const } } },
              { jobTitle: { contains: q, mode: "insensitive" as const } },
            ],
          },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.membership.findMany({
      where,
      select: memberSelect,
      orderBy: [{ user: { name: query.dir } }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.membership.count({ where }),
  ]);
  return pageOf(
    rows.map((row) => toOrgPerson(viewer, row)),
    total,
    query,
  );
}
