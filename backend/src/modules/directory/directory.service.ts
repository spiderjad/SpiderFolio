// Directorio de personas, de solo lectura (CLAUDE.md, sección 9.3): nombre, puesto, departamento y
// cargo; sin email ni último acceso. Sirve para menciones y para compartir. Quién ve a quién lo
// decide peopleScopeOf (docs/spec/personas.md). Todo se resuelve acá, no en la interfaz.
import type { DepartmentPosition, Prisma } from "../../generated/prisma/client.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { peopleScopeOf, type DirectoryScope } from "../people/people-scope.ts";
import type { DirectoryQuery } from "./directory.schemas.ts";

export interface DirectoryEntry {
  id: string;
  name: string;
  jobTitle: string | null;
  departments: { id: string; name: string; position: DepartmentPosition }[];
}

export type DirectoryPage = Page<DirectoryEntry> & {
  /** Qué ve quien pregunta: toda la empresa, sus departamentos y jefes, o solo su perfil. */
  viewScope: DirectoryScope;
};

/**
 * Personas visibles para quien pregunta (DTO de directorio: sin email, plaza ni estado).
 * Propietario, administradores, jefes y subjefes ven a todos; un miembro, según la opción de
 * Seguridad; lectores e invitados, solo su perfil.
 */
export async function listDirectory(
  ctx: AdminContext,
  query: DirectoryQuery,
): Promise<DirectoryPage> {
  const scope = await peopleScopeOf(ctx);
  const restrictions: Prisma.MembershipWhereInput[] = [];
  if (scope.directory === "self") {
    restrictions.push({ id: ctx.tenant.membershipId });
  } else if (scope.directory === "department") {
    restrictions.push({
      OR: [
        { id: ctx.tenant.membershipId },
        { departments: { some: { departmentId: { in: scope.ownDepartmentIds } } } },
        { departments: { some: { position: "HEAD" } } },
      ],
    });
  }
  const q = query.q;
  const where: Prisma.MembershipWhereInput = {
    status: "ACTIVE",
    ...(scope.directory === "self" ? {} : { role: { base: { not: "GUEST" } } }),
    AND: [
      ...restrictions,
      query.department === undefined
        ? {}
        : { departments: { some: { departmentId: query.department } } },
      q === undefined || q === ""
        ? {}
        : {
            OR: [
              { user: { name: { contains: q, mode: "insensitive" } } },
              { jobTitle: { contains: q, mode: "insensitive" } },
            ],
          },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.membership.findMany({
      where,
      select: {
        id: true,
        jobTitle: true,
        user: { select: { name: true } },
        departments: {
          select: { position: true, department: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ user: { name: query.dir } }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.membership.count({ where }),
  ]);
  const page = pageOf(
    rows.map((row) => ({
      id: row.id,
      name: row.user.name,
      jobTitle: row.jobTitle,
      departments: row.departments
        .map((d) => ({ ...d.department, position: d.position }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    })),
    total,
    query,
  );
  return { ...page, viewScope: scope.directory };
}
