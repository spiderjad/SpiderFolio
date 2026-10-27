// Backoffice de la instalación (docs/spec/operacion.md, 12A.3): las empresas de esta instalación y su
// uso, para quien la administra (User.isStaff). Cada empresa se lee con su propio cliente de tenant
// (forTenant), nunca mezclando datos. Solo cantidades: nunca contenido de documentos ni de
// conversaciones.
import { forTenant } from "../../db/tenant.ts";
import { offsetArgs, pageOf, type Page, type PageQuery } from "../../lib/pagination.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { limitsOverview, type LimitsOverview } from "../limits/limits.service.ts";

interface Deps {
  prisma: PrismaClient;
}

export interface InternalWorkspace {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  limits: LimitsOverview["limits"];
  usage: LimitsOverview["usage"];
  /** Tiene una licencia de plugins cargada (sin verificar acá). */
  licensed: boolean;
}

export interface WorkspacesQuery extends PageQuery {
  q?: string | undefined;
}

/** Las empresas de la instalación con sus límites y su uso (de a una página). */
export async function listWorkspaces(
  deps: Deps,
  query: WorkspacesQuery,
): Promise<Page<InternalWorkspace>> {
  const needle = (query.q ?? "").trim();
  const where = {
    deletedAt: null,
    ...(needle === ""
      ? {}
      : {
          OR: [
            { name: { contains: needle, mode: "insensitive" as const } },
            { slug: { contains: needle, mode: "insensitive" as const } },
          ],
        }),
  };
  const [rows, total] = await Promise.all([
    deps.prisma.workspace.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...offsetArgs(query),
      select: { id: true, name: true, slug: true, createdAt: true, license: { select: { id: true } } },
    }),
    deps.prisma.workspace.count({ where }),
  ]);
  const items = await Promise.all(
    rows.map(async (row): Promise<InternalWorkspace> => {
      const { limits, usage } = await limitsOverview(forTenant(deps.prisma, row.id));
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.createdAt,
        limits,
        usage,
        licensed: row.license !== null,
      };
    }),
  );
  return pageOf(items, total, query);
}
