// Revisión de la estructura (Miembros › Organigrama): lo que conviene corregir en departamentos y
// personas. Solo se listan los problemas que existen; cada uno trae el total y las primeras filas.
import type { Prisma } from "../../generated/prisma/client.ts";
import type { AdminContext } from "../admin/admin-context.ts";

const SAMPLE = 8;

export interface ReviewItem {
  id: string;
  name: string;
}

export interface ReviewGroup {
  total: number;
  items: ReviewItem[];
}

export interface StructureReview {
  /** Departamentos sin jefe. */
  departmentsWithoutHead: ReviewGroup;
  /** Personas activas (rol Miembro) que no están en ningún departamento. */
  peopleWithoutDepartment: ReviewGroup;
  /** Jefes o subjefes con plaza de lector: el cargo no les da alcance. */
  readerLeaders: ReviewGroup;
  /** Administradores y propietarios que además son jefes o subjefes (informativo). */
  adminLeaders: ReviewGroup;
  /** Departamentos sin personas. */
  emptyDepartments: ReviewGroup;
}

export async function structureReview(ctx: AdminContext): Promise<StructureReview> {
  const departments = async (where: Prisma.DepartmentWhereInput): Promise<ReviewGroup> => {
    const [total, rows] = await Promise.all([
      ctx.db.department.count({ where }),
      ctx.db.department.findMany({
        where,
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: SAMPLE,
      }),
    ]);
    return { total, items: rows };
  };
  const people = async (where: Prisma.MembershipWhereInput): Promise<ReviewGroup> => {
    const [total, rows] = await Promise.all([
      ctx.db.membership.count({ where }),
      ctx.db.membership.findMany({
        where,
        select: { id: true, user: { select: { name: true } } },
        orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
        take: SAMPLE,
      }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, name: row.user.name })) };
  };
  const leads: Prisma.MembershipWhereInput = {
    departments: { some: { position: { in: ["HEAD", "DEPUTY"] } } },
  };
  const [departmentsWithoutHead, peopleWithoutDepartment, readerLeaders, adminLeaders, empty] =
    await Promise.all([
      departments({ members: { none: { position: "HEAD" } } }),
      people({
        status: "ACTIVE",
        departments: { none: {} },
        role: { base: "MEMBER" },
      }),
      people({ status: "ACTIVE", seatType: "READER", ...leads }),
      people({ status: "ACTIVE", role: { base: { in: ["OWNER", "ADMIN"] } }, ...leads }),
      departments({ members: { none: {} } }),
    ]);
  return {
    departmentsWithoutHead,
    peopleWithoutDepartment,
    readerLeaders,
    adminLeaders,
    emptyDepartments: empty,
  };
}
