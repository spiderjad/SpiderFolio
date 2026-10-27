// «Novedades» de Mis documentos: las versiones que se publicaron esta semana de documentos cuyo
// departamento responsable es uno de los de la persona (o un padre suyo), y que ella ve.
import type { NodeType } from "../../generated/prisma/client.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { accessActorOf, atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { NewsQuery } from "./documents.schemas.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewsItem {
  node: { id: string; name: string; type: NodeType; spaceId: string; spaceName: string };
  code: string;
  version: number;
  publishedAt: Date;
  changeNote: string | null;
  department: { id: string; name: string } | null;
}

export async function documentNews(ctx: AdminContext, query: NewsQuery): Promise<Page<NewsItem>> {
  const departmentIds = [...accessActorOf(ctx).departmentIds];
  if (departmentIds.length === 0) return pageOf([], 0, query);
  const since = new Date(Date.now() - WEEK_MS);
  const rows = await ctx.db.documentVersion.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: since },
      node: { trashedAt: null, controlled: { ownerDepartmentId: { in: departmentIds } } },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: 300,
    select: {
      version: true,
      changeNote: true,
      publishedAt: true,
      node: {
        select: {
          id: true,
          name: true,
          type: true,
          spaceId: true,
          space: { select: { name: true } },
          controlled: { select: { code: true, ownerDepartmentId: true } },
        },
      },
    },
  });
  const [access, departments] = await Promise.all([
    accessFor(ctx, { nodeIds: rows.map((row) => row.node.id) }),
    ctx.db.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true, name: true },
    }),
  ]);
  const names = new Map(departments.map((d) => [d.id, d.name]));
  const items = rows.flatMap((row): NewsItem[] => {
    const controlled = row.node.controlled;
    if (controlled === null || row.publishedAt === null) return [];
    if (!atLeast(access.ofNode(row.node.id), "VIEW")) return [];
    const departmentId = controlled.ownerDepartmentId;
    return [
      {
        node: {
          id: row.node.id,
          name: row.node.name,
          type: row.node.type,
          spaceId: row.node.spaceId,
          spaceName: row.node.space.name,
        },
        code: controlled.code,
        version: row.version,
        publishedAt: row.publishedAt,
        changeNote: row.changeNote,
        department:
          departmentId === null ? null : { id: departmentId, name: names.get(departmentId) ?? "" },
      },
    ];
  });
  const { skip, take } = offsetArgs(query);
  return pageOf(items.slice(skip, skip + take), items.length, query);
}
