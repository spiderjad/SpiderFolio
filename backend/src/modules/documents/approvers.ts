// Quién puede aprobar un documento: el propietario y los administradores, quien tenga la capacidad
// documents.approve por un rol propio, o sea jefe o subjefe (por cargo) del departamento
// responsable o de uno de sus padres. Además tiene que
// poder ver el documento: nadie aprueba lo que no ve. Sale del mismo motor de acceso.
import type { AdminContext } from "../admin/admin-context.ts";
import { parentMapOf, withAncestors } from "../departments/department-tree.ts";
import { atLeast, computeAccess, loadAccessGraph } from "../access/access.ts";
import { loadPersonActors } from "../access/access-actors.ts";

export interface ApproverOption {
  id: string;
  name: string;
  jobTitle: string | null;
  /** Por qué puede aprobar. */
  via: "owner" | "admin" | "capability" | "head" | "deputy";
  /** Departamento que dirige (solo para jefes y subjefes). */
  department: string | null;
  /** Id de ese departamento. */
  departmentId: string | null;
  /** Puede ver el documento (si no, no puede aprobarlo hasta que se le dé acceso). */
  canView: boolean;
}

/** Candidatos por capacidad o por cargo, sin filtrar todavía por acceso. */
async function candidates(
  ctx: AdminContext,
  ownerDepartmentId: string | null,
  options: { ids?: readonly string[]; q?: string | undefined },
): Promise<Map<string, ApproverOption>> {
  const found = new Map<string, ApproverOption>();
  const nameFilter =
    options.q === undefined || options.q === ""
      ? {}
      : { user: { name: { contains: options.q, mode: "insensitive" as const } } };
  const idFilter = options.ids === undefined ? {} : { id: { in: [...options.ids] } };
  const holders = await ctx.db.membership.findMany({
    where: {
      status: "ACTIVE",
      // Propietario y administradores siempre: los roles de sistema creados antes de que existiera
      // documents.approve no la traen guardada.
      role: {
        OR: [
          { capabilities: { has: "documents.approve" } },
          { isSystem: true, base: { in: ["OWNER", "ADMIN"] } },
        ],
      },
      ...idFilter,
      ...nameFilter,
    },
    take: 200,
    select: {
      id: true,
      jobTitle: true,
      user: { select: { name: true } },
      role: { select: { base: true, isSystem: true } },
    },
  });
  for (const row of holders) {
    const via =
      row.role.isSystem && row.role.base === "OWNER"
        ? ("owner" as const)
        : row.role.isSystem && row.role.base === "ADMIN"
          ? ("admin" as const)
          : ("capability" as const);
    found.set(row.id, {
      id: row.id,
      name: row.user.name,
      jobTitle: row.jobTitle,
      via,
      department: null,
      departmentId: null,
      canView: true,
    });
  }
  if (ownerDepartmentId !== null) {
    const tree = parentMapOf(
      await ctx.db.department.findMany({ select: { id: true, parentId: true } }),
    );
    const leaders = await ctx.db.departmentMember.findMany({
      where: {
        departmentId: { in: withAncestors([ownerDepartmentId], tree) },
        position: { in: ["HEAD", "DEPUTY"] },
        membership: { status: "ACTIVE", ...idFilter, ...nameFilter },
      },
      take: 200,
      select: {
        position: true,
        departmentId: true,
        department: { select: { name: true } },
        membership: { select: { id: true, jobTitle: true, user: { select: { name: true } } } },
      },
    });
    for (const row of leaders) {
      const via = row.position === "HEAD" ? ("head" as const) : ("deputy" as const);
      const current = found.get(row.membership.id);
      // Si ya figura por capacidad se queda como jefe: es el motivo más claro.
      if (current === undefined || current.department === null || via === "head") {
        found.set(row.membership.id, {
          id: row.membership.id,
          name: row.membership.user.name,
          jobTitle: row.membership.jobTitle,
          via,
          department: row.department.name,
          departmentId: row.departmentId,
          canView: true,
        });
      }
    }
  }
  return found;
}

/**
 * Quienes podrían aprobar este documento por capacidad o cargo, marcando (`canView`) los que no lo
 * ven: esos no pueden aprobar hasta que se les dé acceso, pero conviene mostrarlos.
 */
export async function approverCandidates(
  ctx: AdminContext,
  nodeId: string,
  ownerDepartmentId: string | null,
  options: { ids?: readonly string[]; q?: string | undefined } = {},
): Promise<ApproverOption[]> {
  const found = await candidates(ctx, ownerDepartmentId, options);
  if (found.size === 0) return [];
  const { people } = await loadPersonActors(ctx.db, { membershipIds: [...found.keys()] });
  const graph = await loadAccessGraph(ctx.db, { nodeIds: [nodeId] });
  const seen = new Set(
    people
      .filter((person) => atLeast(computeAccess(person.actor, graph).ofNode(nodeId), "VIEW"))
      .map((person) => person.membershipId),
  );
  return [...found.values()]
    .map((option) => ({ ...option, canView: seen.has(option.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Los que de verdad pueden aprobar este documento (capacidad o cargo, y ven el documento). */
export async function eligibleApprovers(
  ctx: AdminContext,
  nodeId: string,
  ownerDepartmentId: string | null,
  options: { ids?: readonly string[]; q?: string | undefined } = {},
): Promise<ApproverOption[]> {
  return (await approverCandidates(ctx, nodeId, ownerDepartmentId, options)).filter(
    (option) => option.canView,
  );
}

export async function canApprove(
  ctx: AdminContext,
  nodeId: string,
  ownerDepartmentId: string | null,
  membershipId: string,
): Promise<boolean> {
  const list = await eligibleApprovers(ctx, nodeId, ownerDepartmentId, { ids: [membershipId] });
  return list.some((option) => option.id === membershipId);
}

/**
 * Regla del tipo (por defecto, jefe del departamento responsable): a quiénes se sugiere. Primero el
 * jefe y, si no hay, el subjefe del propio departamento; solo si tampoco hay, los de los superiores.
 */
export function suggestedApprovers(
  options: readonly ApproverOption[],
  ownerDepartmentId: string | null,
): ApproverOption[] {
  const own = options.filter((option) => option.departmentId === ownerDepartmentId);
  for (const group of [own, options]) {
    const heads = group.filter((option) => option.via === "head");
    if (heads.length > 0) return heads;
    const deputies = group.filter((option) => option.via === "deputy");
    if (deputies.length > 0) return deputies;
  }
  return [];
}
