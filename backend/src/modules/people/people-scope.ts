// Alcance de personas (docs/spec/personas.md): la única función que decide qué ve y qué gestiona
// quien pregunta. Rol = toda la empresa; cargo (jefe/subjefe) = su área y subáreas. Se calcula
// una vez por petición y se reutiliza.
import { forbidden } from "../../lib/errors.ts";
import type { LeaderRank } from "../access/access.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { parentMapOf, withDescendants } from "../departments/department-tree.ts";
import {
  readLeadersCanInvite,
  readMemberVisibility,
  type MemberVisibility,
} from "../workspaces/settings.ts";

export type { LeaderRank };

/** Qué personas gestiona (email, plaza, estado, cambios): nadie, toda la empresa o su área. */
export type ManageScope =
  | { kind: "global" }
  | {
      kind: "own";
      /** Departamentos que lidera y todas sus subáreas. */
      departmentIds: string[];
      /** Donde es jefe (y sus subáreas): ahí puede nombrar subjefes. */
      headDepartmentIds: string[];
      rank: LeaderRank;
    }
  | { kind: "none" };

/** A quién ve en el directorio: a todos, a su(s) departamento(s) y jefes, o solo a sí misma. */
export type DirectoryScope = "all" | "department" | "self";

export interface PeopleScope {
  manage: ManageScope;
  directory: DirectoryScope;
  /**
   * Departamentos que la persona ve en Departamentos (estructura y personas, solo lectura salvo
   * donde gestiona): null = todos. Con "toda la empresa" (por defecto) todos los ven; con "solo su
   * departamento", cada uno ve los suyos y sus subáreas (propietario y administradores, todos).
   * Lectores e invitados no ven Departamentos (directory "self").
   */
  readDepartmentIds: string[] | null;
  /** Sus departamentos directos (sin subáreas). */
  ownDepartmentIds: string[];
  visibility: MemberVisibility;
  leadersCanInvite: boolean;
}

type Ctx = Pick<AdminContext, "db" | "tenant">;

const cache = new WeakMap<object, Promise<PeopleScope>>();

export function peopleScopeOf(ctx: Ctx): Promise<PeopleScope> {
  const cached = cache.get(ctx.tenant);
  if (cached !== undefined) return cached;
  const computed = compute(ctx);
  cache.set(ctx.tenant, computed);
  return computed;
}

async function compute(ctx: Ctx): Promise<PeopleScope> {
  const [self, workspace] = await Promise.all([
    ctx.db.membership.findFirst({
      where: { id: ctx.tenant.membershipId },
      select: { seatType: true, departments: { select: { departmentId: true, position: true } } },
    }),
    ctx.db.workspace.findFirst({ where: {}, select: { settings: true } }),
  ]);
  const visibility = readMemberVisibility(workspace?.settings);
  const leadersCanInvite = readLeadersCanInvite(workspace?.settings);
  const ownDepartmentIds = self?.departments.map((d) => d.departmentId) ?? [];
  const base = { ownDepartmentIds, visibility, leadersCanInvite };

  const { base: role } = ctx.tenant.role;
  if (role === "OWNER" || role === "ADMIN") {
    return { ...base, manage: { kind: "global" }, directory: "all", readDepartmentIds: null };
  }
  // Lectores e invitados: solo su perfil y sin Departamentos; un lector con cargo no gana alcance.
  if (self === null || self.seatType === "READER" || role === "GUEST") {
    return { ...base, manage: { kind: "none" }, directory: "self", readDepartmentIds: [] };
  }
  const led = self.departments.filter((d) => d.position !== "MEMBER");
  const restricted = visibility === "department";
  // El árbol solo se lee si hace falta (un jefe, o una visibilidad por departamento).
  const tree =
    led.length > 0 || restricted
      ? parentMapOf(await ctx.db.department.findMany({ select: { id: true, parentId: true } }))
      : null;
  // Con "solo su departamento": los suyos y sus subáreas (los que lidera, también).
  const readDepartmentIds =
    restricted && tree !== null
      ? withDescendants([...ownDepartmentIds, ...led.map((d) => d.departmentId)], tree)
      : null;
  if (led.length > 0 && tree !== null) {
    const heads = led.filter((d) => d.position === "HEAD").map((d) => d.departmentId);
    return {
      ...base,
      directory: "all",
      readDepartmentIds,
      manage: {
        kind: "own",
        departmentIds: withDescendants(
          led.map((d) => d.departmentId),
          tree,
        ),
        headDepartmentIds: withDescendants(heads, tree),
        rank: heads.length > 0 ? "HEAD" : "DEPUTY",
      },
    };
  }
  return {
    ...base,
    manage: { kind: "none" },
    directory: restricted ? "department" : "all",
    readDepartmentIds,
  };
}

/** ¿La persona ve ese departamento en Departamentos? */
export function canReadDepartment(scope: PeopleScope, departmentId: string): boolean {
  if (scope.directory === "self") return false;
  return scope.readDepartmentIds === null || scope.readDepartmentIds.includes(departmentId);
}

/** Gestión de toda la empresa (propietario y administradores); si no, 403. */
export async function assertGlobalManager(ctx: Ctx): Promise<void> {
  if ((await peopleScopeOf(ctx)).manage.kind !== "global") throw forbidden();
}
