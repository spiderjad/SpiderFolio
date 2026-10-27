// Alcance de lo que una persona ve y gestiona en Miembros y Departamentos (CLAUDE.md, sección 9):
// propietario y administradores, toda la empresa; jefe y subjefe (por cargo), solo su
// departamento y sus subáreas. Se resuelve en el servidor en cada pedido: perder el cargo lo
// quita al instante.
import type { Prisma } from "../../generated/prisma/client.ts";
import { forbidden } from "../../lib/errors.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { peopleScopeOf } from "../people/people-scope.ts";
import { parentMapOf, withDescendants } from "./department-tree.ts";

export const leaderPositions = ["HEAD", "DEPUTY"] as const;

type Ctx = Pick<AdminContext, "db">;

/**
 * Departamentos sobre los que una persona tiene alcance propio: los que lidera (jefe o subjefe)
 * y todos sus subdepartamentos.
 */
export async function ledDepartmentIds(ctx: Ctx, membershipId: string): Promise<string[]> {
  const direct = await ctx.db.departmentMember.findMany({
    where: { membershipId, position: { in: [...leaderPositions] } },
    select: { departmentId: true },
  });
  if (direct.length === 0) return [];
  const all = await ctx.db.department.findMany({ select: { id: true, parentId: true } });
  return withDescendants(
    direct.map((d) => d.departmentId),
    parentMapOf(all),
  );
}

export type MemberScope = { kind: "global" } | { kind: "own"; departmentIds: string[] };

/**
 * Alcance de gestión de personas (docs/spec/personas.md): propietario y administradores, toda la
 * empresa; jefe y subjefe (por cargo), su área y subáreas; el resto, 403.
 */
export async function resolveMemberScope(ctx: AdminContext): Promise<MemberScope> {
  const { manage } = await peopleScopeOf(ctx);
  if (manage.kind === "none") throw forbidden();
  return manage.kind === "global" ? manage : { kind: "own", departmentIds: manage.departmentIds };
}

/** Filtro de personas visibles: con alcance propio, quienes están en sus departamentos. */
export function scopeWhere(scope: MemberScope): Prisma.MembershipWhereInput {
  // Con alcance propio: las personas de su área, sin propietarios ni administradores.
  return scope.kind === "global"
    ? {}
    : {
        departments: { some: { departmentId: { in: scope.departmentIds } } },
        role: { base: { notIn: ["OWNER", "ADMIN"] } },
      };
}

/** Pantallas de toda la empresa (plazas): 403 con alcance propio. */
export function assertGlobalScope(scope: MemberScope): void {
  if (scope.kind !== "global") throw forbidden();
}
