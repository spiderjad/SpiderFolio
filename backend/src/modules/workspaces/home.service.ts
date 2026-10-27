// Inicio (docs/spec/panel-admin.md y 10.6): todo sale de datos reales y filtrado por quién entra.
// - Todos: sus pendientes (lecturas y aprobaciones) y lo compartido con ellos hace poco.
// - Jefes y subjefes: cumplimiento de lectura, revisiones próximas y documentos en revisión de su área.
// - Propietario y administradores: indicadores de la empresa, actividad de 30 días y más consultados.
// Cada bloque se calcula en lote (una consulta por tipo de dato, sin recorrer documento por documento)
// y se acota por alcance: lo de otra empresa nunca entra (forTenant) y lo que la persona no ve, tampoco.
import { bytesToJson, limitInBaseUnits } from "@spiderfolio/limits";
import type { NodeType } from "../../generated/prisma/client.ts";
import { atLeast, expiryFilter, subjectFilter, accessActorOf } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { workspaceLimits } from "../limits/limits.service.ts";
import { MyApprovalsQuerySchema, MyReadingsQuerySchema } from "../documents/documents.schemas.ts";
import { myApprovals, type MyApproval } from "../documents/approvals.service.ts";
import { myReadings, type MyReading } from "../documents/readings.service.ts";
import { compliancePercent, readingStatsFor } from "../documents/readings.stats.ts";
import { visibleSpacesWhere } from "../spaces/spaces.service.ts";
import { activityByDay } from "../../db/raw/home.ts";
import { notFound } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { AppDeps } from "../../routes.ts";

const DAY_MS = 24 * 3600 * 1000;
const LIST_SIZE = 5;
const ACTIVITY_DAYS = 30;
const REVIEW_AHEAD_DAYS = 60;

export interface NodeRef {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
}

export interface SharedRecently {
  node: NodeRef;
  sharedBy: string | null;
  sharedAt: Date;
}

export interface LeaderCompliance {
  node: NodeRef;
  code: string;
  /** Los mismos números que el detalle del documento (`total` incluye a quien no tiene acceso). */
  total: number;
  read: number;
  pending: number;
  overdue: number;
  /** Deben leerlo pero no ven el documento: se descuentan del cumplimiento y se muestran aparte. */
  noAccess: number;
}

export interface LeaderDocument {
  node: NodeRef;
  code: string;
  at: Date;
}

export interface CompanyHome {
  kpis: {
    publishedDocuments: number;
    inReview: number;
    drafts: number;
    /** Porcentaje de lecturas confirmadas sobre lo que se pidió (null si no se pidió ninguna). */
    readingCompliance: number | null;
    activePeople: number;
  };
  storage: { usedBytes: number; limitBytes: number | null };
  activity: { date: string; uploads: number; publications: number; reads: number }[];
  topDocuments: { node: NodeRef; code: string | null; people: number }[];
}

export interface HomeOverview {
  scope: { leader: boolean; company: boolean };
  mine: {
    readings: { total: number; items: MyReading[] };
    approvals: { total: number; items: MyApproval[] };
  };
  shared: SharedRecently[];
  leader: {
    compliance: LeaderCompliance[];
    reviewDue: { total: number; items: LeaderDocument[] };
    inReview: { total: number; items: LeaderDocument[] };
  } | null;
  company: CompanyHome | null;
}

const nodeSelect = {
  id: true,
  name: true,
  type: true,
  spaceId: true,
  space: { select: { name: true } },
} as const;

const refOf = (node: {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  space: { name: string };
}): NodeRef => ({
  id: node.id,
  name: node.name,
  type: node.type,
  spaceId: node.spaceId,
  spaceName: node.space.name,
});

/** Lo que alguien compartió con la persona hace poco (accesos directos a elementos que ve). */
async function sharedRecently(ctx: AdminContext, now: Date): Promise<SharedRecently[]> {
  const me = ctx.tenant.membershipId;
  const rows = await ctx.db.permission.findMany({
    where: {
      AND: [
        subjectFilter(accessActorOf(ctx), { company: false }),
        expiryFilter(now),
        { nodeId: { not: null }, node: { trashedAt: null } },
        { NOT: { grantedById: me } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 30,
    select: { createdAt: true, grantedById: true, node: { select: nodeSelect } },
  });
  const nodes = rows.flatMap((row) => (row.node === null ? [] : [{ row, node: row.node }]));
  if (nodes.length === 0) return [];
  const access = await accessFor(ctx, { nodeIds: nodes.map(({ node }) => node.id) });
  const seen = new Set<string>();
  const picked = nodes
    .filter(({ node }) => atLeast(access.ofNode(node.id), "VIEW"))
    .filter(({ node }) => (seen.has(node.id) ? false : (seen.add(node.id), true)))
    .slice(0, LIST_SIZE);
  const names = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: [...new Set(picked.map(({ row }) => row.grantedById))] } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  return picked.map(({ row, node }) => ({
    node: refOf(node),
    sharedBy: names.get(row.grantedById) ?? null,
    sharedAt: row.createdAt,
  }));
}

/** Documentos del área de un jefe: cumplimiento, revisiones próximas y lo que espera aprobación. */
async function leaderHome(
  ctx: AdminContext,
  now: Date,
): Promise<NonNullable<HomeOverview["leader"]>> {
  const area = [...ctx.tenant.ledScope.keys()];
  const documents = await ctx.db.controlledDocument.findMany({
    where: { ownerDepartmentId: { in: area }, node: { trashedAt: null } },
    take: 500,
    select: {
      nodeId: true,
      code: true,
      publishedVersion: true,
      reviewDueAt: true,
      node: { select: nodeSelect },
    },
  });
  // Solo lo que la persona ve (un documento de su área puede estar en un espacio que no alcanza).
  const access = await accessFor(ctx, { nodeIds: documents.map((d) => d.nodeId) });
  const visible = documents.filter((d) => atLeast(access.ofNode(d.nodeId), "VIEW"));

  const published = visible.flatMap((d) =>
    d.publishedVersion === null ? [] : [{ nodeId: d.nodeId, version: d.publishedVersion }],
  );
  const stats = await readingStatsFor(ctx.db, published, now);
  const compliance = visible
    .flatMap((d): LeaderCompliance[] => {
      const row = stats.get(d.nodeId);
      return row === undefined || row.total === 0
        ? []
        : [
            {
              node: refOf(d.node),
              code: d.code,
              total: row.total,
              read: row.read,
              pending: row.pending,
              overdue: row.overdue,
              noAccess: row.noAccess,
            },
          ];
    })
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.pending - a.pending ||
        b.noAccess - a.noAccess ||
        a.code.localeCompare(b.code),
    )
    .slice(0, 8);

  const horizon = new Date(now.getTime() + REVIEW_AHEAD_DAYS * DAY_MS);
  const due = visible
    .filter(
      (d) => d.publishedVersion !== null && d.reviewDueAt !== null && d.reviewDueAt <= horizon,
    )
    .sort((a, b) => (a.reviewDueAt?.getTime() ?? 0) - (b.reviewDueAt?.getTime() ?? 0));

  const inReviewVersions = await ctx.db.documentVersion.findMany({
    where: {
      status: "IN_REVIEW",
      nodeId: { in: visible.map((d) => d.nodeId) },
      submittedAt: { not: null },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: { nodeId: true, submittedAt: true },
  });
  const byNode = new Map(visible.map((d) => [d.nodeId, d]));
  const inReview = inReviewVersions.flatMap((version): LeaderDocument[] => {
    const document = byNode.get(version.nodeId);
    return document === undefined || version.submittedAt === null
      ? []
      : [{ node: refOf(document.node), code: document.code, at: version.submittedAt }];
  });
  return {
    compliance,
    reviewDue: {
      total: due.length,
      items: due
        .slice(0, LIST_SIZE)
        .flatMap((d) =>
          d.reviewDueAt === null ? [] : [{ node: refOf(d.node), code: d.code, at: d.reviewDueAt }],
        ),
    },
    inReview: { total: inReview.length, items: inReview.slice(0, LIST_SIZE) },
  };
}

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/** Indicadores de la empresa para el propietario y los administradores (solo lo que ven). */
async function companyHome(
  ctx: AdminContext,
  prisma: PrismaClient,
  now: Date,
): Promise<CompanyHome> {
  const visibleSpaces = visibleSpacesWhere(ctx, now);
  const inScope = { trashedAt: null, space: visibleSpaces };
  const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS);

  const [published, inReview, drafts, publishedDocs, workspace, limits, active, hidden] =
    await Promise.all([
      ctx.db.controlledDocument.count({
        where: { publishedVersion: { not: null }, node: inScope },
      }),
      ctx.db.documentVersion.count({ where: { status: "IN_REVIEW", node: inScope } }),
      ctx.db.documentVersion.count({ where: { status: "DRAFT", node: inScope } }),
      ctx.db.controlledDocument.findMany({
        where: { publishedVersion: { not: null }, node: inScope },
        take: 500,
        select: { nodeId: true, publishedVersion: true },
      }),
      ctx.db.workspace.findUnique({
        where: { id: ctx.db.workspaceId },
        select: { storageUsedBytes: true },
      }),
      workspaceLimits(ctx.db),
      ctx.db.auditLog.groupBy({
        by: ["actorId"],
        where: { createdAt: { gte: since }, actorId: { not: null } },
      }),
      // Lo que el administrador no ve (espacios confidenciales): su actividad no cuenta.
      ctx.tenant.role.base === "OWNER"
        ? []
        : ctx.db.space.findMany({ where: { NOT: visibleSpaces }, select: { id: true } }),
    ]);
  if (workspace === null) throw notFound();

  const stats = await readingStatsFor(
    ctx.db,
    publishedDocs.flatMap((d) =>
      d.publishedVersion === null ? [] : [{ nodeId: d.nodeId, version: d.publishedVersion }],
    ),
    now,
  );

  // Actividad: subidas, publicaciones y lecturas confirmadas por día; el conteo lo hace la base.
  const rows = await activityByDay(prisma, {
    workspaceId: ctx.tenant.workspaceId,
    since,
    actions: ["file.upload", "document.published", "document.read"],
    hiddenSpaceIds: hidden.map((space) => space.id),
  });
  const days = new Map<string, CompanyHome["activity"][number]>();
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i -= 1) {
    const date = dayKey(new Date(now.getTime() - i * DAY_MS));
    days.set(date, { date, uploads: 0, publications: 0, reads: 0 });
  }
  for (const row of rows) {
    const day = days.get(row.day);
    if (day === undefined) continue;
    if (row.action === "file.upload") day.uploads += row.count;
    else if (row.action === "document.published") day.publications += row.count;
    else day.reads += row.count;
  }

  // Más consultados del mes: personas distintas que abrieron cada documento (las visitas son
  // privadas; acá solo se cuentan, nunca se dice quién).
  const visits = await ctx.db.documentVisit.groupBy({
    by: ["nodeId"],
    where: { visitedAt: { gte: since }, node: inScope },
    _count: { _all: true },
    orderBy: [{ _count: { nodeId: "desc" } }, { nodeId: "asc" }],
    take: 15,
  });
  const visitNodeIds = visits.map((v) => v.nodeId);
  const [visitNodes, codes, access] =
    visitNodeIds.length === 0
      ? [[], [], null]
      : await Promise.all([
          ctx.db.node.findMany({ where: { id: { in: visitNodeIds } }, select: nodeSelect }),
          ctx.db.controlledDocument.findMany({
            where: { nodeId: { in: visitNodeIds } },
            select: { nodeId: true, code: true },
          }),
          accessFor(ctx, { nodeIds: visitNodeIds }),
        ]);
  const nodeById = new Map(visitNodes.map((node) => [node.id, node]));
  const codeOf = new Map(codes.map((row) => [row.nodeId, row.code]));
  const topDocuments = visits
    .flatMap((visit) => {
      const node = nodeById.get(visit.nodeId);
      return node === undefined || access === null || !atLeast(access.ofNode(node.id), "VIEW")
        ? []
        : [{ node: refOf(node), code: codeOf.get(node.id) ?? null, people: visit._count._all }];
    })
    .slice(0, LIST_SIZE);

  const limit = limitInBaseUnits("storageGb", limits.storageGb);
  return {
    kpis: {
      publishedDocuments: published,
      inReview,
      drafts,
      readingCompliance: compliancePercent(stats.values()),
      activePeople: active.length,
    },
    storage: {
      usedBytes: bytesToJson(workspace.storageUsedBytes),
      limitBytes: limit === null ? null : bytesToJson(limit),
    },
    activity: [...days.values()],
    topDocuments,
  };
}

/** El Inicio de quien pide: cada bloque según su alcance. */
export async function homeOverview(
  ctx: AdminContext,
  deps: Pick<AppDeps, "prisma">,
  now: Date = new Date(),
): Promise<HomeOverview> {
  const base = ctx.tenant.role.base;
  const company = base === "OWNER" || base === "ADMIN";
  const leader = ctx.tenant.ledScope.size > 0;
  const [readings, approvals, shared, led, firm] = await Promise.all([
    myReadings(ctx, MyReadingsQuerySchema.parse({ pageSize: String(LIST_SIZE) })),
    myApprovals(ctx, MyApprovalsQuerySchema.parse({ pageSize: String(LIST_SIZE) })),
    sharedRecently(ctx, now),
    leader ? leaderHome(ctx, now) : null,
    company ? companyHome(ctx, deps.prisma, now) : null,
  ]);
  return {
    scope: { leader, company },
    mine: {
      readings: { total: readings.total, items: readings.items },
      approvals: { total: approvals.total, items: approvals.items },
    },
    shared,
    leader: led,
    company: firm,
  };
}
