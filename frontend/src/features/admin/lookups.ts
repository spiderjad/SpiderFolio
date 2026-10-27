// Datos que comparten varias pantallas del panel (roles y departamentos) y reglas de rango.
import type { SystemRole } from "@/auth/types";
import type { DepartmentView, RoleView } from "./api";
import { locale } from "@/i18n";

/** Nivel de cada rol base: mayor = más poder (igual que el backend). */
export const baseRank: Record<SystemRole, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/**
 * Si quien mira puede asignar ese rol: no el de propietario (la propiedad se transfiere), no uno
 * por encima del propio nivel ni con capacidades que no tiene. El backend lo vuelve a validar.
 */
export function canAssignRole(
  role: Pick<RoleView, "base" | "capabilities" | "isSystem">,
  actor: { base: SystemRole; capabilities: readonly string[] },
): boolean {
  return (
    role.isSystem &&
    role.base !== "OWNER" &&
    baseRank[role.base] <= baseRank[actor.base] &&
    role.capabilities.every((capability) => actor.capabilities.includes(capability))
  );
}

/** Un rol con capacidades administrativas usa plaza completa; uno de invitado, lector. */
export function isAdministrativeRole(role: Pick<RoleView, "capabilities">): boolean {
  return role.capabilities.length > 0;
}

export interface DepartmentNode {
  department: DepartmentView;
  depth: number;
}

/** Departamentos en orden de árbol (cada hijo después de su padre) con su profundidad. */
export function flattenDepartments(departments: readonly DepartmentView[]): DepartmentNode[] {
  const byParent = new Map<string | null, DepartmentView[]>();
  const ids = new Set(departments.map((d) => d.id));
  for (const department of departments) {
    // Un padre que no está en la lista se trata como nivel principal.
    const key =
      department.parentId !== null && ids.has(department.parentId) ? department.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), department]);
  }
  const result: DepartmentNode[] = [];
  const visit = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, locale),
    );
    for (const department of children) {
      result.push({ department, depth });
      visit(department.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}
