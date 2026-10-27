// Un actor de acceso por cada persona activa del workspace, con las mismas reglas que arma
// tenantMiddleware para quien hace el pedido. Sirve para explicar «quién accede y por qué» y para la
// auditoría: se leen todas las membresías y el árbol de departamentos de una vez y se resuelve en
// memoria, sin una consulta por persona.
import type { TenantDb } from "../../db/tenant.ts";
import type { SeatType, SystemRole } from "../../generated/prisma/client.ts";
import { parentMapOf } from "../departments/department-tree.ts";
import { isCapability } from "../roles/capabilities.ts";
import type { AccessActor } from "./access.ts";
import { scopeOfDepartments } from "./access-scope.ts";

/** Hasta cuántas personas se explican de una vez (decisión de producto: 5.000). */
export const MAX_EXPLAINED_PEOPLE = 5000;

export interface PersonActor {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  role: { name: string; base: SystemRole };
  seatType: SeatType;
  actor: AccessActor;
}

export interface LoadedActors {
  people: PersonActor[];
  /** Había más personas que el tope: la lista está recortada. */
  truncated: boolean;
}

/** Personas activas (opcionalmente las que coinciden con `q` en el nombre) como actores de acceso. */
export async function loadPersonActors(
  db: TenantDb,
  options: { q?: string | undefined; membershipIds?: readonly string[] | undefined } = {},
): Promise<LoadedActors> {
  const [rows, departments] = await Promise.all([
    db.membership.findMany({
      where: {
        status: "ACTIVE",
        ...(options.membershipIds === undefined ? {} : { id: { in: [...options.membershipIds] } }),
        ...(options.q === undefined || options.q === ""
          ? {}
          : { user: { name: { contains: options.q, mode: "insensitive" } } }),
      },
      orderBy: { id: "asc" },
      take: MAX_EXPLAINED_PEOPLE + 1,
      select: {
        id: true,
        seatType: true,
        jobTitle: true,
        user: { select: { name: true } },
        role: { select: { name: true, base: true, capabilities: true } },
        departments: { select: { departmentId: true, position: true } },
      },
    }),
    db.department.findMany({ select: { id: true, parentId: true } }),
  ]);
  const tree = parentMapOf(departments);
  const truncated = rows.length > MAX_EXPLAINED_PEOPLE;
  const people = rows.slice(0, MAX_EXPLAINED_PEOPLE).map((row): PersonActor => {
    const { departmentIds, ledScope } = scopeOfDepartments(
      row.departments,
      row.departments.length === 0 ? null : tree,
    );
    return {
      membershipId: row.id,
      name: row.user.name,
      jobTitle: row.jobTitle,
      role: { name: row.role.name, base: row.role.base },
      seatType: row.seatType,
      actor: {
        membershipId: row.id,
        base: row.role.base,
        seatType: row.seatType,
        bypass: row.role.capabilities.filter(isCapability).includes("content.bypass"),
        departmentIds: new Set(departmentIds),
        ownDepartmentIds: new Set(row.departments.map((d) => d.departmentId)),
        ledScope,
      },
    };
  });
  return { people, truncated };
}
