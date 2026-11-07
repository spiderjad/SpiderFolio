// The sampling plan (docs/spec/calidad.md, «Fase 6b»): product, surface, environment and water samples
// every N days, each result against its criterion and, not conforming, its nonconformity (origin
// laboratory). Same access as prerequisites: quality.manage handles the points, a point's responsible
// person records its results, quality.view reads; guests never.
import { forbidden, notFound } from "../../lib/errors.ts";
import { qualityLimits } from "@spiderfolio/limits";
import { qualityTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { ensureFolder } from "./quality-folders.ts";
import { SAMPLING_EXPIRY } from "./quality-expiry.ts";
import { insertNc, notifyNc } from "./ncs.service.ts";
import { companyToday, prpStateOf, type PrpState } from "./prps.service.ts";
import type {
  LabResultInput,
  SamplingPointInput,
  UpdateSamplingPointInput,
  samplingKinds,
} from "./products.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;

export interface SamplingPointView {
  id: string;
  kind: string;
  name: string;
  product: { id: string; name: string } | null;
  zone: string | null;
  parameter: string;
  criterion: string | null;
  maxValue: number | null;
  unit: string | null;
  everyDays: number;
  laboratory: string | null;
  responsible: { id: string; name: string } | null;
  lastSampledOn: string | null;
  nextDueOn: string;
  state: PrpState;
  last: { value: number | null; detected: boolean | null; conforming: boolean } | null;
  /** The last two results not conforming. */
  repeated: boolean;
  archived: boolean;
  access: "manage" | "responsible" | "read";
}

const select = {
  id: true,
  kind: true,
  name: true,
  productId: true,
  zone: true,
  parameter: true,
  criterion: true,
  maxValue: true,
  unit: true,
  everyDays: true,
  laboratory: true,
  responsibleId: true,
  lastSampledOn: true,
  nextDueOn: true,
  archivedAt: true,
  createdById: true,
} as const;

type Row = Prisma.QualitySamplingPointGetPayload<{ select: typeof select }>;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function addDays(day: string, days: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

function accessOf(
  ctx: AdminContext,
  row: { responsibleId: string | null },
): SamplingPointView["access"] {
  if (canManageQuality(ctx)) return "manage";
  if (row.responsibleId === ctx.tenant.membershipId) return "responsible";
  return "read";
}

async function requireSampling(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST") throw forbidden();
}

function visibleWhere(ctx: AdminContext): Prisma.QualitySamplingPointWhereInput {
  return canViewQuality(ctx) ? {} : { responsibleId: ctx.tenant.membershipId };
}

async function views(ctx: AdminContext, rows: Row[]): Promise<SamplingPointView[]> {
  if (rows.length === 0) return [];
  const day = await companyToday(ctx.db);
  const ids = rows.map((row) => row.id);
  const people = [
    ...new Set(rows.map((row) => row.responsibleId).filter((id): id is string => id !== null)),
  ];
  const productIds = [
    ...new Set(rows.map((row) => row.productId).filter((id): id is string => id !== null)),
  ];
  const [members, products, results] = await Promise.all([
    people.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: people } },
          select: { id: true, user: { select: { name: true } } },
        }),
    productIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        }),
    ctx.db.qualityLabResult.findMany({
      where: { pointId: { in: ids } },
      select: { pointId: true, value: true, detected: true, conforming: true },
      orderBy: [{ sampledOn: "desc" }, { createdAt: "desc" }],
      take: Math.min(ids.length * 10, 5000),
    }),
  ]);
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  const productOf = new Map(products.map((product) => [product.id, product]));
  return rows.map((row) => {
    const mine = results.filter((result) => result.pointId === row.id);
    const [last, before] = mine;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      product: row.productId === null ? null : (productOf.get(row.productId) ?? null),
      zone: row.zone,
      parameter: row.parameter,
      criterion: row.criterion,
      maxValue: row.maxValue,
      unit: row.unit,
      everyDays: row.everyDays,
      laboratory: row.laboratory,
      responsible:
        row.responsibleId === null
          ? null
          : { id: row.responsibleId, name: nameOf.get(row.responsibleId) ?? "" },
      lastSampledOn: row.lastSampledOn === null ? null : dayOf(row.lastSampledOn),
      nextDueOn: dayOf(row.nextDueOn),
      state: prpStateOf(row.nextDueOn, day),
      last:
        last === undefined
          ? null
          : { value: last.value, detected: last.detected, conforming: last.conforming },
      repeated: last !== undefined && before !== undefined && !last.conforming && !before.conforming,
      archived: row.archivedAt !== null,
      access: accessOf(ctx, row),
    };
  });
}

export async function listSamplingPoints(
  ctx: AdminContext,
  query: { kind?: (typeof samplingKinds)[number] | undefined; archived?: "1" | undefined },
): Promise<SamplingPointView[]> {
  await requireSampling(ctx);
  const rows = await ctx.db.qualitySamplingPoint.findMany({
    where: {
      AND: [
        visibleWhere(ctx),
        query.archived === "1" ? { archivedAt: { not: null } } : { archivedAt: null },
        ...(query.kind === undefined ? [] : [{ kind: query.kind }]),
      ],
    },
    select,
    orderBy: [{ kind: "asc" }, { nextDueOn: "asc" }, { id: "asc" }],
    take: 500,
  });
  return await views(ctx, rows);
}

async function load(ctx: AdminContext, id: string): Promise<Row> {
  await requireSampling(ctx);
  const row = await ctx.db.qualitySamplingPoint.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select,
  });
  if (row === null) throw notFound();
  return row;
}

async function oneView(ctx: AdminContext, id: string): Promise<SamplingPointView> {
  const [view] = await views(ctx, [await load(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

async function assertMember(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.membership.count({
    where: { id, status: "ACTIVE", role: { base: { not: "GUEST" } } },
  });
  if (found === 0) throw notFound();
}

async function assertProduct(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.qualityProduct.count({ where: { id, archivedAt: null } });
  if (found === 0) throw notFound();
}

async function setDue(
  db: TenantDb,
  row: { id: string; nextDueOn: Date; responsibleId: string | null; createdById: string },
) {
  await setExpiry(db, {
    kind: SAMPLING_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.nextDueOn),
    responsibleId: row.responsibleId ?? row.createdById,
    noticeDays: [...NOTICE_DAYS],
  });
}

const dueSelect = { id: true, nextDueOn: true, responsibleId: true, createdById: true } as const;

export async function createSamplingPoint(
  ctx: AdminContext,
  input: SamplingPointInput,
): Promise<SamplingPointView> {
  await requireSampling(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await assertMember(ctx.db, input.responsibleId);
  await assertProduct(ctx.db, input.productId);
  const nextDueOn = input.nextDueOn ?? (await companyToday(ctx.db));
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qualitySamplingPoint.create({
      data: {
        kind: input.kind,
        name: input.name,
        productId: input.productId,
        zone: input.zone ?? null,
        parameter: input.parameter,
        criterion: input.criterion ?? null,
        maxValue: input.maxValue,
        unit: input.unit ?? null,
        everyDays: input.everyDays,
        laboratory: input.laboratory ?? null,
        responsibleId: input.responsibleId,
        nextDueOn: dateOf(nextDueOn),
        createdById: ctx.tenant.membershipId,
      },
      select: dueSelect,
    });
    await setDue(tx, created);
    return created.id;
  });
  await auditAdmin(ctx, {
    action: "quality.sampling.create",
    entityType: "QualitySamplingPoint",
    entityId: id,
    metadata: { kind: input.kind, everyDays: input.everyDays },
  });
  return await oneView(ctx, id);
}

export async function updateSamplingPoint(
  ctx: AdminContext,
  id: string,
  input: UpdateSamplingPointInput,
): Promise<SamplingPointView> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.archivedAt !== null) throw notFound();
  await assertMember(ctx.db, input.responsibleId);
  await assertProduct(ctx.db, input.productId);
  const data: Prisma.QualitySamplingPointUncheckedUpdateInput = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key !== "nextDueOn"),
  );
  if (input.nextDueOn !== undefined) data.nextDueOn = dateOf(input.nextDueOn);
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualitySamplingPoint.update({ where: { id }, data, select: dueSelect });
    await setDue(tx, updated);
  });
  await auditAdmin(ctx, {
    action: "quality.sampling.update",
    entityType: "QualitySamplingPoint",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await oneView(ctx, id);
}

export async function setSamplingArchived(
  ctx: AdminContext,
  id: string,
  archived: boolean,
): Promise<SamplingPointView> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualitySamplingPoint.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select: { id: true },
    });
    if (archived) await resolveExpiry(tx, SAMPLING_EXPIRY, id);
    else await setDue(tx, current);
  });
  await auditAdmin(ctx, {
    action: archived ? "quality.sampling.archive" : "quality.sampling.restore",
    entityType: "QualitySamplingPoint",
    entityId: id,
  });
  return await oneView(ctx, id);
}

export interface LabResultView {
  id: string;
  sampledOn: string;
  value: number | null;
  detected: boolean | null;
  conforming: boolean;
  note: string | null;
  report: { id: string; name: string; spaceId: string } | null;
  nc: { id: string; code: string } | null;
  by: { id: string; name: string };
}

export async function samplingResults(ctx: AdminContext, id: string): Promise<LabResultView[]> {
  await load(ctx, id);
  const rows = await ctx.db.qualityLabResult.findMany({
    where: { pointId: id },
    select: {
      id: true,
      sampledOn: true,
      value: true,
      detected: true,
      conforming: true,
      note: true,
      reportNodeId: true,
      ncId: true,
      recordedById: true,
    },
    orderBy: [{ sampledOn: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const ncIds = rows.map((row) => row.ncId).filter((ncId): ncId is string => ncId !== null);
  const nodeIds = rows
    .map((row) => row.reportNodeId)
    .filter((nodeId): nodeId is string => nodeId !== null);
  const [people, ncs, nodes] = await Promise.all([
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.recordedById))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
    ncIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityNc.findMany({
          where: { id: { in: ncIds } },
          select: { id: true, year: true, number: true },
        }),
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: { id: true, name: true, spaceId: true },
        }),
  ]);
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const ncOf = new Map(ncs.map((nc) => [nc.id, nc]));
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  return rows.map((row) => {
    const nc = row.ncId === null ? undefined : ncOf.get(row.ncId);
    return {
      id: row.id,
      sampledOn: dayOf(row.sampledOn),
      value: row.value,
      detected: row.detected,
      conforming: row.conforming,
      note: row.note,
      report: row.reportNodeId === null ? null : (nodeOf.get(row.reportNodeId) ?? null),
      nc: nc === undefined ? null : { id: nc.id, code: qualityTexts.code(nc.year, nc.number) },
      by: { id: row.recordedById, name: nameOf.get(row.recordedById) ?? "" },
    };
  });
}

/** «Plan analítico» in the module's space: where the laboratory reports go. */
async function samplingFolderId(ctx: AdminContext): Promise<{ id: string; spaceId: string }> {
  const settings = await requireQuality(ctx);
  if (settings.spaceId === undefined) throw notFound();
  const id = await ensureFolder(ctx, settings.spaceId, null, qualityTexts.samplingFolder);
  return { id, spaceId: settings.spaceId };
}

/** The sampling plan's folder (created the first time), for whoever records results. */
export async function samplingFolder(
  ctx: AdminContext,
  pointId: string,
): Promise<{ id: string; spaceId: string }> {
  const point = await load(ctx, pointId);
  if (accessOf(ctx, point) === "read") throw forbidden();
  return await samplingFolderId(ctx);
}

/** The files of the sampling plan's folder, to choose a result's report. */
export async function samplingFiles(
  ctx: AdminContext,
  pointId: string,
): Promise<{ id: string; name: string }[]> {
  await load(ctx, pointId);
  const settings = await requireQuality(ctx);
  if (settings.spaceId === undefined) return [];
  const folder = await ctx.db.node.findFirst({
    where: {
      spaceId: settings.spaceId,
      parentId: null,
      type: "FOLDER",
      name: qualityTexts.samplingFolder,
      trashedAt: null,
    },
    select: { id: true },
  });
  if (folder === null) return [];
  return await ctx.db.node.findMany({
    where: { parentId: folder.id, type: "FILE", trashedAt: null },
    select: { id: true, name: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 200,
  });
}

async function assertReport(ctx: AdminContext, nodeId: string | null): Promise<void> {
  if (nodeId === null) return;
  const settings = await requireQuality(ctx);
  const found =
    settings.spaceId === undefined
      ? 0
      : await ctx.db.node.count({
          where: { id: nodeId, spaceId: settings.spaceId, type: "FILE", trashedAt: null },
        });
  if (found === 0) throw notFound();
}

/**
 * A result (quality.manage or the point's responsible person): the next sample `everyDays` later; not
 * conforming, its nonconformity if asked.
 */
export async function addLabResult(
  ctx: AdminContext,
  id: string,
  input: LabResultInput,
): Promise<SamplingPointView> {
  const point = await load(ctx, id);
  if (accessOf(ctx, point) === "read") throw forbidden();
  if (point.archivedAt !== null) throw notFound();
  await assertReport(ctx, input.reportNodeId);
  let ncId: string | null = null;
  if (!input.conforming && input.openNc) {
    const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
    const title = withLocale(readWorkspaceLocale(workspace?.settings), () =>
      qualityTexts.labNcTitle(point.name, point.parameter),
    );
    const owner = point.responsibleId ?? ctx.tenant.membershipId;
    ncId = await insertNc(ctx, {
      title: title.slice(0, qualityLimits.titleMax),
      description: input.note ?? title,
      origin: "LAB",
      severity: input.severity,
      detectedOn: input.sampledOn,
      location: point.zone,
      ownerId: owner,
      reportedById: ctx.tenant.membershipId,
    });
    await notifyNc(ctx.db, ncId, [owner], ctx.tenant.membershipId);
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityLabResult.create({
      data: {
        pointId: id,
        sampledOn: dateOf(input.sampledOn),
        value: input.value,
        detected: input.detected,
        conforming: input.conforming,
        reportNodeId: input.reportNodeId,
        note: input.note ?? null,
        ncId,
        recordedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    // A sample taken before the last one doesn't move the next date back.
    if (point.lastSampledOn === null || dayOf(point.lastSampledOn) <= input.sampledOn) {
      const updated = await tx.qualitySamplingPoint.update({
        where: { id },
        data: {
          lastSampledOn: dateOf(input.sampledOn),
          nextDueOn: dateOf(addDays(input.sampledOn, point.everyDays)),
        },
        select: dueSelect,
      });
      await setDue(tx, updated);
    }
  });
  await auditAdmin(ctx, {
    action: "quality.sampling.result",
    entityType: "QualitySamplingPoint",
    entityId: id,
    metadata: { sampledOn: input.sampledOn, conforming: input.conforming, ncId },
  });
  return await oneView(ctx, id);
}

/** For the dashboard: overdue samples and non-conforming results of the last 30 days. */
export async function samplingFigures(
  ctx: AdminContext,
  today: Date,
  since: Date,
): Promise<{ overdue: number; nonConforming: number }> {
  const [overdue, nonConforming] = await Promise.all([
    ctx.db.qualitySamplingPoint.count({ where: { archivedAt: null, nextDueOn: { lt: today } } }),
    ctx.db.qualityLabResult.count({ where: { conforming: false, sampledOn: { gte: since } } }),
  ]);
  return { overdue, nonConforming };
}

