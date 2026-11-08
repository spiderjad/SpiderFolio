// Complaints (docs/spec/calidad.md, «Fase 5»): every complaint from a customer, a consumer or an
// authority, its deadline to answer, the answer (justified or not), its nonconformity and the complaints
// per million units. Anyone records one; quality.manage handles them; quality.view reads them (without a
// consumer's contact); whoever is in charge of one answers it.
import { qualityLimits } from "@spiderfolio/limits";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { assertLot } from "./lots.service.ts";
import { COMPLAINT_EXPIRY } from "./quality-expiry.ts";
import { insertNc, managers, notifyNc } from "./ncs.service.ts";
import type {
  ComplaintInput,
  ComplaintsQuery,
  UpdateComplaintInput,
} from "./complaints.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;

type Severity = "MINOR" | "MAJOR" | "CRITICAL";

export interface ComplaintView {
  id: string;
  source: "CUSTOMER" | "CONSUMER" | "AUTHORITY";
  from: string;
  /** Only for quality.manage and whoever is in charge (a consumer's personal data). */
  contact: string | null;
  product: string;
  lot: string | null;
  lotId: string | null;
  category: string;
  description: string;
  receivedOn: string;
  respondBy: string;
  overdue: boolean;
  respondedOn: string | null;
  response: string | null;
  justified: boolean | null;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  owner: { id: string; name: string };
  nc: { id: string; code: string; status: string } | null;
  access: "manage" | "owner" | "read";
}

const select = {
  id: true,
  source: true,
  from: true,
  contact: true,
  product: true,
  lot: true,
  lotId: true,
  category: true,
  description: true,
  receivedOn: true,
  respondBy: true,
  respondedOn: true,
  response: true,
  justified: true,
  status: true,
  ownerId: true,
  ncId: true,
  createdById: true,
} as const;

type Row = Prisma.QualityComplaintGetPayload<{ select: typeof select }>;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function addDays(day: string, days: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

async function today(db: TenantDb): Promise<string> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

function accessOf(ctx: AdminContext, row: { ownerId: string }): ComplaintView["access"] {
  if (canManageQuality(ctx)) return "manage";
  if (row.ownerId === ctx.tenant.membershipId) return "owner";
  return "read";
}

/** Beyond quality.view: the ones in their charge and the ones they recorded. */
function visibleWhere(ctx: AdminContext): Prisma.QualityComplaintWhereInput {
  if (canViewQuality(ctx)) return {};
  const me = ctx.tenant.membershipId;
  return { OR: [{ ownerId: me }, { createdById: me }] };
}

async function views(ctx: AdminContext, rows: Row[]): Promise<ComplaintView[]> {
  if (rows.length === 0) return [];
  const day = await today(ctx.db);
  const ncIds = rows.map((row) => row.ncId).filter((id): id is string => id !== null);
  const [people, ncs] = await Promise.all([
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.ownerId))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
    ncIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityNc.findMany({
          where: { id: { in: ncIds } },
          select: { id: true, year: true, number: true, status: true },
        }),
  ]);
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const ncOf = new Map(ncs.map((nc) => [nc.id, nc]));
  return rows.map((row) => {
    const access = accessOf(ctx, row);
    const nc = row.ncId === null ? undefined : ncOf.get(row.ncId);
    return {
      id: row.id,
      source: row.source,
      from: row.from,
      contact: access === "read" ? null : row.contact,
      product: row.product,
      lot: row.lot,
      lotId: row.lotId,
      category: row.category,
      description: row.description,
      receivedOn: dayOf(row.receivedOn),
      respondBy: dayOf(row.respondBy),
      overdue: row.status === "OPEN" && dayOf(row.respondBy) < day,
      respondedOn: row.respondedOn === null ? null : dayOf(row.respondedOn),
      response: row.response,
      justified: row.justified,
      status: row.status,
      owner: { id: row.ownerId, name: nameOf.get(row.ownerId) ?? "" },
      nc:
        nc === undefined
          ? null
          : { id: nc.id, code: qualityTexts.code(nc.year, nc.number), status: nc.status },
      access,
    };
  });
}

async function load(ctx: AdminContext, id: string): Promise<Row> {
  await requireQuality(ctx);
  const row = await ctx.db.qualityComplaint.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select,
  });
  if (row === null) throw notFound();
  return row;
}

export async function getComplaint(ctx: AdminContext, id: string): Promise<ComplaintView> {
  const [view] = await views(ctx, [await load(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

export async function listComplaints(
  ctx: AdminContext,
  query: ComplaintsQuery,
): Promise<Page<ComplaintView>> {
  await requireQuality(ctx);
  const day = await today(ctx.db);
  const where: Prisma.QualityComplaintWhereInput = {
    AND: [
      visibleWhere(ctx),
      query.status === "all"
        ? {}
        : query.status === "overdue"
          ? { status: "OPEN", respondBy: { lt: dateOf(day) } }
          : { status: query.status },
      ...(query.category === undefined ? [] : [{ category: query.category }]),
      ...(query.source === undefined ? [] : [{ source: query.source }]),
      ...(query.from === undefined ? [] : [{ receivedOn: { gte: dateOf(query.from) } }]),
      ...(query.to === undefined ? [] : [{ receivedOn: { lte: dateOf(query.to) } }]),
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.qualityComplaint.findMany({
      where,
      select,
      orderBy: stableOrder({ receivedOn: query.dir === "asc" ? "asc" : "desc" } as const),
      ...offsetArgs(query),
    }),
    ctx.db.qualityComplaint.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}

async function assertMember(db: TenantDb, id: string): Promise<void> {
  const found = await db.membership.count({ where: { id, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

async function setDeadline(db: TenantDb, row: { id: string; respondBy: Date; ownerId: string }) {
  await setExpiry(db, {
    kind: COMPLAINT_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.respondBy),
    responsibleId: row.ownerId,
    noticeDays: [...NOTICE_DAYS],
  });
}

/**
 * Anyone records one (the salesperson who takes it); quality.manage chooses who's in charge, otherwise
 * it's the owner's or the first quality.manage's. The deadline is the company's response days later.
 */
export async function createComplaint(
  ctx: AdminContext,
  input: ComplaintInput,
): Promise<ComplaintView> {
  const settings = await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST") throw forbidden();
  let ownerId: string;
  if (input.ownerId !== null && canManageQuality(ctx)) {
    await assertMember(ctx.db, input.ownerId);
    ownerId = input.ownerId;
  } else {
    ownerId = canManageQuality(ctx)
      ? ctx.tenant.membershipId
      : ((await managers(ctx.db))[0] ?? ctx.tenant.membershipId);
  }
  await assertLot(ctx.db, input.lotId);
  const respondBy = addDays(input.receivedOn, settings.responseDays);
  const created = await ctx.db.$transaction(async (tx) => {
    const row = await tx.qualityComplaint.create({
      data: {
        source: input.source,
        from: input.from,
        contact: input.contact ?? null,
        product: input.product,
        lot: input.lot ?? null,
        lotId: input.lotId,
        category: input.category,
        description: input.description,
        receivedOn: dateOf(input.receivedOn),
        respondBy: dateOf(respondBy),
        ownerId,
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true, respondBy: true, ownerId: true },
    });
    await setDeadline(tx, row);
    return row;
  });
  await auditAdmin(ctx, {
    action: "quality.complaint.create",
    entityType: "QualityComplaint",
    entityId: created.id,
    // Never the consumer's contact.
    metadata: { source: input.source, category: input.category, receivedOn: input.receivedOn },
  });
  return await getComplaint(ctx, created.id);
}

async function loadEditable(ctx: AdminContext, id: string): Promise<Row> {
  const row = await load(ctx, id);
  if (accessOf(ctx, row) === "read") throw forbidden();
  if (row.status === "CLOSED") {
    throw new AppError("CONFLICT", { message: qualityTexts.complaintMessages.closed });
  }
  return row;
}

export async function updateComplaint(
  ctx: AdminContext,
  id: string,
  input: UpdateComplaintInput,
): Promise<ComplaintView> {
  await loadEditable(ctx, id);
  await assertLot(ctx.db, input.lotId);
  if (input.ownerId !== undefined) {
    if (!canManageQuality(ctx)) throw forbidden();
    await assertMember(ctx.db, input.ownerId);
  }
  const data: Prisma.QualityComplaintUncheckedUpdateInput = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key !== "respondBy"),
  );
  if (input.respondBy !== undefined) data.respondBy = dateOf(input.respondBy);
  await ctx.db.$transaction(async (tx) => {
    const row = await tx.qualityComplaint.update({
      where: { id },
      data,
      select: { id: true, respondBy: true, ownerId: true, status: true },
    });
    if (row.status === "OPEN") await setDeadline(tx, row);
  });
  await auditAdmin(ctx, {
    action: "quality.complaint.update",
    entityType: "QualityComplaint",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await getComplaint(ctx, id);
}

export async function answerComplaint(
  ctx: AdminContext,
  id: string,
  input: { response: string; justified: boolean; respondedOn: string },
): Promise<ComplaintView> {
  await loadEditable(ctx, id);
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityComplaint.update({
      where: { id },
      data: {
        response: input.response,
        justified: input.justified,
        respondedOn: dateOf(input.respondedOn),
        status: "ANSWERED",
      },
      select: { id: true },
    });
    await resolveExpiry(tx, COMPLAINT_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "quality.complaint.answer",
    entityType: "QualityComplaint",
    entityId: id,
    metadata: { justified: input.justified, respondedOn: input.respondedOn },
  });
  return await getComplaint(ctx, id);
}

export async function closeComplaint(ctx: AdminContext, id: string): Promise<ComplaintView> {
  await loadEditable(ctx, id);
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityComplaint.update({
      where: { id },
      data: { status: "CLOSED" },
      select: { id: true },
    });
    await resolveExpiry(tx, COMPLAINT_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "quality.complaint.close",
    entityType: "QualityComplaint",
    entityId: id,
  });
  return await getComplaint(ctx, id);
}

/** Its nonconformity (origin COMPLAINT), once. */
export async function complaintNc(
  ctx: AdminContext,
  id: string,
  input: { severity: Severity; ownerId: string | null },
): Promise<ComplaintView> {
  const row = await loadEditable(ctx, id);
  if (row.ncId !== null) {
    throw new AppError("CONFLICT", { message: qualityTexts.complaintMessages.hasNc });
  }
  const owner = input.ownerId ?? row.ownerId;
  await assertMember(ctx.db, owner);
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  // Written by the system: in the company's language.
  const text = withLocale(readWorkspaceLocale(workspace?.settings), () => {
    const category = qualityTexts.complaintCategories[row.category];
    return {
      title: qualityTexts.complaintNcTitle(category, row.product),
      description: qualityTexts.complaintNcDescription(
        row.from,
        row.product,
        row.lot ?? "",
        row.description,
      ),
    };
  });
  const ncId = await insertNc(ctx, {
    title:
      text.title.length > qualityLimits.titleMax
        ? `${text.title.slice(0, qualityLimits.titleMax - 1)}…`
        : text.title,
    description: text.description.slice(0, qualityLimits.descriptionMax),
    origin: "COMPLAINT",
    severity: input.severity,
    detectedOn: dayOf(row.receivedOn),
    ownerId: owner,
    reportedById: ctx.tenant.membershipId,
    productAffected: true,
    productNote: row.lot === null ? row.product : `${row.product} · ${row.lot}`,
  });
  await ctx.db.qualityComplaint.update({ where: { id }, data: { ncId }, select: { id: true } });
  await notifyNc(ctx.db, ncId, [owner], ctx.tenant.membershipId);
  return await getComplaint(ctx, id);
}

/**
 * The year's complaints by month and category, and per million units where the month's units sold are
 * loaded (quality.view).
 */
export async function complaintIndicators(
  ctx: AdminContext,
  year: number,
): Promise<{
  months: { month: string; complaints: number; units: number | null; perMillion: number | null }[];
  categories: { category: string; complaints: number }[];
  total: { complaints: number; units: number | null; perMillion: number | null; justified: number };
}> {
  await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
  const from = dateOf(`${String(year)}-01-01`);
  const to = dateOf(`${String(year)}-12-31`);
  const [rows, units] = await Promise.all([
    ctx.db.qualityComplaint.findMany({
      where: { receivedOn: { gte: from, lte: to } },
      select: { receivedOn: true, category: true, justified: true },
      take: 20_000,
    }),
    ctx.db.qualityMonthUnits.findMany({
      where: { month: { gte: from, lte: to } },
      select: { month: true, units: true },
    }),
  ]);
  const unitsOf = new Map(units.map((row) => [dayOf(row.month).slice(0, 7), row.units]));
  const perMillion = (count: number, sold: number | null) =>
    sold === null || sold === 0 ? null : Math.round((count * 1_000_000 * 100) / sold) / 100;
  const months = Array.from({ length: 12 }, (_unused, index) => {
    const key = `${String(year)}-${String(index + 1).padStart(2, "0")}`;
    const complaints = rows.filter((row) => dayOf(row.receivedOn).startsWith(key)).length;
    const sold = unitsOf.get(key) ?? null;
    return { month: key, complaints, units: sold, perMillion: perMillion(complaints, sold) };
  });
  const byCategory = new Map<string, number>();
  for (const row of rows) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
  // Per million only over the months with units loaded (the rest would undercount).
  const counted = months.filter((month) => month.units !== null);
  const soldTotal = counted.reduce((sum, month) => sum + (month.units ?? 0), 0);
  const complaintsCounted = counted.reduce((sum, month) => sum + month.complaints, 0);
  return {
    months,
    categories: [...byCategory.entries()]
      .map(([category, complaints]) => ({ category, complaints }))
      .sort((a, b) => b.complaints - a.complaints),
    total: {
      complaints: rows.length,
      units: counted.length === 0 ? null : soldTotal,
      perMillion: counted.length === 0 ? null : perMillion(complaintsCounted, soldTotal),
      justified: rows.filter((row) => row.justified === true).length,
    },
  };
}

/** A month's units sold (quality.manage). */
export async function setMonthUnits(
  ctx: AdminContext,
  input: { month: string; units: number },
): Promise<void> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.qualityMonthUnits.upsert({
    where: { workspaceId_month: { workspaceId: ctx.db.workspaceId, month: dateOf(input.month) } },
    create: { month: dateOf(input.month), units: input.units },
    update: { units: input.units },
  });
  await auditAdmin(ctx, {
    action: "quality.units",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: input,
  });
}
