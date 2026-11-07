// Change management (docs/spec/calidad.md, «Fase 6c»): a new recipe, product, line, piece of equipment,
// supplier or process goes through the HACCP review before it's approved. Anyone active (not a guest)
// proposes one; quality.manage reviews it and approves or rejects it; once approved, its owner marks it
// implemented when no review point is pending. Whoever proposed it sees it, without changing it.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { qualityTexts } from "../../i18n/index.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { CHANGE_EXPIRY } from "./quality-expiry.ts";
import { managers } from "./ncs.service.ts";
import { companyToday } from "./prps.service.ts";
import {
  reviewPoints,
  reviewStates,
  type ChangeDecisionInput,
  type ChangeInput,
  type ChangesQuery,
  type ReviewPointName,
  type ReviewState,
  type UpdateChangeInput,
} from "./culture.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;
const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

export type ChangeReview = Record<ReviewPointName, { state: ReviewState; note: string }>;

const emptyReview = (): ChangeReview =>
  Object.fromEntries(
    reviewPoints.map((point) => [point, { state: "pending" as const, note: "" }]),
  ) as ChangeReview;

function readReview(value: Prisma.JsonValue): ChangeReview {
  const review = emptyReview();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return review;
  for (const point of reviewPoints) {
    const entry = value[point];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const state = reviewStates.find((candidate) => candidate === entry.state);
    review[point] = {
      state: state ?? "pending",
      note: typeof entry.note === "string" ? entry.note : "",
    };
  }
  return review;
}

export interface ChangeSummary {
  id: string;
  code: string;
  title: string;
  kind: string;
  status: string;
  impact: string | null;
  plannedOn: string | null;
  owner: { id: string; name: string } | null;
  proposedBy: { id: string; name: string };
  pending: number;
  overdue: boolean;
  createdAt: string;
}

export interface ChangeDetail extends ChangeSummary {
  description: string;
  product: { id: string; name: string } | null;
  review: ChangeReview;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  implementedOn: string | null;
  can: { edit: boolean; decide: boolean; implement: boolean; cancel: boolean };
}

const select = {
  id: true,
  year: true,
  number: true,
  title: true,
  kind: true,
  description: true,
  productId: true,
  plannedOn: true,
  status: true,
  review: true,
  impact: true,
  ownerId: true,
  proposedById: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  implementedOn: true,
  createdAt: true,
} as const;

type Row = Prisma.QualityChangeGetPayload<{ select: typeof select }>;

async function requireChanges(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST") throw forbidden();
}

/** quality.view sees every change; the rest, the ones they proposed or are in charge of. */
function visibleWhere(ctx: AdminContext): Prisma.QualityChangeWhereInput {
  if (canViewQuality(ctx)) return {};
  return {
    OR: [{ proposedById: ctx.tenant.membershipId }, { ownerId: ctx.tenant.membershipId }],
  };
}

const pendingOf = (review: ChangeReview) =>
  reviewPoints.filter((point) => review[point].state === "pending").length;

async function names(db: TenantDb, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db.membership.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

function summaryOf(row: Row, nameOf: Map<string, string>, day: string): ChangeSummary {
  const person = (id: string | null) =>
    id === null ? null : { id, name: nameOf.get(id) ?? "" };
  const plannedOn = row.plannedOn === null ? null : dayOf(row.plannedOn);
  return {
    id: row.id,
    code: qualityTexts.changeCode(row.year, row.number),
    title: row.title,
    kind: row.kind,
    status: row.status,
    impact: row.impact,
    plannedOn,
    owner: person(row.ownerId),
    proposedBy: { id: row.proposedById, name: nameOf.get(row.proposedById) ?? "" },
    pending: pendingOf(readReview(row.review)),
    overdue: row.status === "APPROVED" && plannedOn !== null && plannedOn < day,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listChanges(
  ctx: AdminContext,
  query: ChangesQuery,
): Promise<Page<ChangeSummary>> {
  await requireChanges(ctx);
  const q = query.q?.trim() ?? "";
  const where: Prisma.QualityChangeWhereInput = {
    AND: [
      visibleWhere(ctx),
      query.status === undefined ? {} : { status: query.status },
      query.kind === undefined ? {} : { kind: query.kind },
      q === ""
        ? {}
        : {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          },
    ],
  };
  const [rows, total, day] = await Promise.all([
    ctx.db.qualityChange.findMany({
      where,
      select,
      orderBy: stableOrder({ createdAt: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.qualityChange.count({ where }),
    companyToday(ctx.db),
  ]);
  const nameOf = await names(
    ctx.db,
    rows.flatMap((row) => [row.ownerId, row.proposedById]),
  );
  return pageOf(
    rows.map((row) => summaryOf(row, nameOf, day)),
    total,
    query,
  );
}

async function load(ctx: AdminContext, id: string): Promise<Row> {
  await requireChanges(ctx);
  const row = await ctx.db.qualityChange.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select,
  });
  if (row === null) throw notFound();
  return row;
}

const isOpen = (status: string) => status === "PROPOSED" || status === "APPROVED";

async function detailOf(ctx: AdminContext, row: Row): Promise<ChangeDetail> {
  const [nameOf, day, product] = await Promise.all([
    names(ctx.db, [row.ownerId, row.proposedById, row.decidedById]),
    companyToday(ctx.db),
    row.productId === null
      ? Promise.resolve(null)
      : ctx.db.qualityProduct.findFirst({
          where: { id: row.productId },
          select: { id: true, name: true },
        }),
  ]);
  const manage = canManageQuality(ctx);
  const review = readReview(row.review);
  return {
    ...summaryOf(row, nameOf, day),
    description: row.description,
    product,
    review,
    decidedBy:
      row.decidedById === null
        ? null
        : { id: row.decidedById, name: nameOf.get(row.decidedById) ?? "" },
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    decisionNote: row.decisionNote,
    implementedOn: row.implementedOn === null ? null : dayOf(row.implementedOn),
    can: {
      edit: manage && isOpen(row.status),
      decide: manage && row.status === "PROPOSED",
      implement:
        row.status === "APPROVED" && (manage || row.ownerId === ctx.tenant.membershipId),
      cancel: manage && isOpen(row.status),
    },
  };
}

export async function getChange(ctx: AdminContext, id: string): Promise<ChangeDetail> {
  return await detailOf(ctx, await load(ctx, id));
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

async function notify(ctx: AdminContext, to: string[], changeId: string): Promise<void> {
  const people = [...new Set(to)].filter((id) => id !== ctx.tenant.membershipId);
  for (const membershipId of people) {
    await ctx.db.notification.create({
      data: { membershipId, kind: "quality_change", actorId: ctx.tenant.membershipId, detail: changeId },
      select: { id: true },
    });
  }
}

/** While it's approved and has a planned date, its owner (or whoever approved it) is told. */
async function syncExpiry(db: TenantDb, row: Row): Promise<void> {
  if (row.status !== "APPROVED" || row.plannedOn === null) {
    await resolveExpiry(db, CHANGE_EXPIRY, row.id);
    return;
  }
  await setExpiry(db, {
    kind: CHANGE_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.plannedOn),
    responsibleId: row.ownerId ?? row.decidedById ?? row.proposedById,
    noticeDays: [...NOTICE_DAYS],
  });
}

export async function proposeChange(ctx: AdminContext, input: ChangeInput): Promise<ChangeDetail> {
  await requireChanges(ctx);
  await assertProduct(ctx.db, input.productId);
  const year = Number((await companyToday(ctx.db)).slice(0, 4));
  const row = await ctx.db.$transaction(async (tx) => {
    const counter = await tx.qualityChangeCounter.upsert({
      where: { workspaceId_year: { workspaceId: tx.workspaceId, year } },
      create: { year, last: 1 },
      update: { last: { increment: 1 } },
      select: { last: true },
    });
    return await tx.qualityChange.create({
      data: {
        year,
        number: counter.last,
        title: input.title,
        kind: input.kind,
        description: input.description,
        productId: input.productId,
        plannedOn: input.plannedOn === null ? null : dateOf(input.plannedOn),
        review: emptyReview(),
        proposedById: ctx.tenant.membershipId,
      },
      select,
    });
  });
  await auditAdmin(ctx, {
    action: "quality.change.propose",
    entityType: "QualityChange",
    entityId: row.id,
    metadata: { code: qualityTexts.changeCode(row.year, row.number), kind: row.kind },
  });
  await notify(ctx, await managers(ctx.db), row.id);
  return await detailOf(ctx, row);
}

export async function updateChange(
  ctx: AdminContext,
  id: string,
  input: UpdateChangeInput,
): Promise<ChangeDetail> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (!isOpen(current.status)) throw new AppError("CONFLICT", { message: qualityTexts.changes.notProposed });
  await assertMember(ctx.db, input.ownerId);
  await assertProduct(ctx.db, input.productId);
  const data: Prisma.QualityChangeUncheckedUpdateInput = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    ...(input.plannedOn === undefined
      ? {}
      : { plannedOn: input.plannedOn === null ? null : dateOf(input.plannedOn) }),
    ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
    ...(input.impact === undefined ? {} : { impact: input.impact }),
    ...(input.review === undefined ? {} : { review: readReview(input.review) }),
  };
  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityChange.update({ where: { id }, data, select });
    await syncExpiry(tx, updated);
    return updated;
  });
  await auditAdmin(ctx, {
    action: "quality.change.update",
    entityType: "QualityChange",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  if (input.ownerId !== undefined && input.ownerId !== null && input.ownerId !== current.ownerId) {
    await notify(ctx, [input.ownerId], id);
  }
  return await detailOf(ctx, row);
}

/** Approve (with the HACCP review answered) or reject (with its reason). */
export async function decideChange(
  ctx: AdminContext,
  id: string,
  input: ChangeDecisionInput,
): Promise<ChangeDetail> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.status !== "PROPOSED") {
    throw new AppError("CONFLICT", { message: qualityTexts.changes.notProposed });
  }
  const note = input.note?.trim() ?? "";
  if (input.decision === "APPROVE" && readReview(current.review).haccp.state === "pending") {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.changes.haccpPending });
  }
  if (input.decision === "REJECT" && note === "") {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.changes.reasonRequired });
  }
  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityChange.update({
      where: { id },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: ctx.tenant.membershipId,
        decidedAt: new Date(),
        decisionNote: note === "" ? null : note,
      },
      select,
    });
    await syncExpiry(tx, updated);
    return updated;
  });
  await auditAdmin(ctx, {
    action: input.decision === "APPROVE" ? "quality.change.approve" : "quality.change.reject",
    entityType: "QualityChange",
    entityId: id,
  });
  await notify(
    ctx,
    [row.proposedById, ...(row.ownerId === null ? [] : [row.ownerId])],
    id,
  );
  return await detailOf(ctx, row);
}

/** Its owner or quality.manage, once approved and with no review point pending. */
export async function implementChange(
  ctx: AdminContext,
  id: string,
  implementedOn: string,
): Promise<ChangeDetail> {
  const current = await load(ctx, id);
  const allowed = canManageQuality(ctx) || current.ownerId === ctx.tenant.membershipId;
  if (!allowed) throw forbidden();
  if (current.status !== "APPROVED") {
    throw new AppError("CONFLICT", { message: qualityTexts.changes.notApproved });
  }
  if (pendingOf(readReview(current.review)) > 0) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.changes.reviewPending });
  }
  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityChange.update({
      where: { id },
      data: { status: "IMPLEMENTED", implementedOn: dateOf(implementedOn) },
      select,
    });
    await syncExpiry(tx, updated);
    return updated;
  });
  await auditAdmin(ctx, {
    action: "quality.change.implement",
    entityType: "QualityChange",
    entityId: id,
    metadata: { implementedOn },
  });
  return await detailOf(ctx, row);
}

export async function cancelChange(ctx: AdminContext, id: string): Promise<ChangeDetail> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (!isOpen(current.status)) throw new AppError("CONFLICT", { message: qualityTexts.changes.notProposed });
  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityChange.update({
      where: { id },
      data: { status: "CANCELLED" },
      select,
    });
    await syncExpiry(tx, updated);
    return updated;
  });
  await auditAdmin(ctx, {
    action: "quality.change.cancel",
    entityType: "QualityChange",
    entityId: id,
  });
  return await detailOf(ctx, row);
}

/** For the dashboard: changes waiting for a decision, and approved ones past their date. */
export async function changeFigures(
  ctx: AdminContext,
  today: Date,
): Promise<{ proposed: number; overdue: number }> {
  const [proposed, overdue] = await Promise.all([
    ctx.db.qualityChange.count({ where: { status: "PROPOSED" } }),
    ctx.db.qualityChange.count({ where: { status: "APPROVED", plannedOn: { lt: today } } }),
  ]);
  return { proposed, overdue };
}
