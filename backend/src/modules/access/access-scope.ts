// Qué departamentos alcanza una persona: los suyos y sus padres (para los permisos dados a un
// departamento) y lo que lidera por su cargo de jefe o subjefe (con sus subáreas). Una sola función
// para la sesión de cada persona (tenantMiddleware) y para explicar el acceso de todas.
import type { DepartmentPosition } from "../../generated/prisma/client.ts";
import { withAncestors, withDescendants, type ParentMap } from "../departments/department-tree.ts";
import type { LeaderRank } from "./access.ts";

export interface DepartmentScope {
  /** Los departamentos de la persona y los de sus ancestros. */
  departmentIds: string[];
  /** Cada departamento que alcanza por su cargo (el que lidera y sus subáreas) → cuál lidera y con qué cargo. */
  ledScope: Map<string, { departmentId: string; rank: LeaderRank }>;
}

/** `tree` es null cuando la persona no está en ningún departamento (no hace falta leer el árbol). */
export function scopeOfDepartments(
  memberships: readonly { departmentId: string; position: DepartmentPosition }[],
  tree: ParentMap | null,
): DepartmentScope {
  const ledScope = new Map<string, { departmentId: string; rank: LeaderRank }>();
  if (tree === null) return { departmentIds: [], ledScope };
  // Primero los subjefes y después los jefes: si lidera un área por los dos cargos, gana el de jefe.
  const led = memberships
    .filter((d) => d.position !== "MEMBER")
    .sort((a, b) => (a.position === b.position ? 0 : a.position === "DEPUTY" ? -1 : 1));
  for (const { departmentId, position } of led) {
    const rank: LeaderRank = position === "HEAD" ? "HEAD" : "DEPUTY";
    for (const id of withDescendants([departmentId], tree)) {
      ledScope.set(id, { departmentId, rank });
    }
  }
  return {
    departmentIds: withAncestors(
      memberships.map((d) => d.departmentId),
      tree,
    ),
    ledScope,
  };
}
