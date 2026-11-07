// Prerequisite programmes (docs/spec/calidad.md, «Fase 6a»): cleaning, pests, water, calibration, glass and
// hard plastic, waste: controls done every N days by their responsible person, each check conforming or
// not (and then its nonconformity), with the notice before the next one. quality.manage handles them,
// quality.view reads them, and a control's responsible person records its checks.
import { qualityLimits } from "@spiderfolio/limits";
import { forbidden, notFound } from "../../lib/errors.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { PRP_EXPIRY } from "./quality-expiry.ts";
import { insertNc, notifyNc } from "./ncs.service.ts";
import type { PrpCheckInput, PrpInput, UpdatePrpInput, prpKinds } from "./prps.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;
const DUE_SOON_DAYS = 7;

export type PrpState = "ok" | "due_soon" | "overdue";

export interface PrpView {
  id: string;
  kind: string;
  name: string;
  location: string | null;
  everyDays: number;
  responsible: { id: string; name: string } | null;
  form: { id: string; name: string; spaceId: string } | null;
  lastDoneOn: string | null;
  nextDueOn: string;
  state: PrpState;
  notes: string | null;
  archived: boolean;
  /** quality.manage: edits; responsible: records checks; read. */
  access: "manage" | "responsible" | "read";
}

const select = {
  id: true,
  kind: true,
  name: true,
  location: true,
  everyDays: true,
  responsibleId: true,
  formId: true,
  lastDoneOn: true,
  nextDueOn: true,
  notes: true,
  archivedAt: true,
  createdById: true,
} as const;

type Row = Prisma.QualityPrpGetPayload<{ select: typeof select }>;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function addDays(day: string, days: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

export async function companyToday(db: TenantDb): Promise<string> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

export function prpStateOf(nextDueOn: Date, day: string): PrpState {
  const due = dayOf(nextDueOn);
  if (due < day) return "overdue";
  return due <= addDays(day, DUE_SOON_DAYS) ? "due_soon" : "ok";
}

function accessOf(ctx: AdminContext, row: { responsibleId: string | null }): PrpView["access"] {
  if (canManageQuality(ctx)) return "manage";
  if (row.responsibleId === ctx.tenant.membershipId) return "responsible";
  return "read";
}

/** Beyond quality.view, only the controls the person is responsible for. */
function visibleWhere(ctx: AdminContext): Prisma.QualityPrpWhereInput {
  return canViewQuality(ctx) ? {} : { responsibleId: ctx.tenant.membershipId };
}

async function views(ctx: AdminContext, rows: Row[]): Promise<PrpView[]> {
  if (rows.length === 0) return [];
  const day = await companyToday(ctx.db);
  const people = [
    ...new Set(rows.map((row) => row.responsibleId).filter((id): id is string => id !== null)),
  ];
  const forms = [
    ...new Set(rows.map((row) => row.formId).filter((id): id is string => id !== null)),
  ];
  const [members, nodes] = await Promise.all([
    people.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: people } },
          select: { id: true, user: { select: { name: true } } },
        }),
    forms.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: forms }, type: "FORM", trashedAt: null },
          select: { id: true, name: true, spaceId: true },
        }),
  ]);
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  const formOf = new Map(nodes.map((node) => [node.id, node]));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    location: row.location,
    everyDays: row.everyDays,
    responsible:
      row.responsibleId === null
        ? null
        : { id: row.responsibleId, name: nameOf.get(row.responsibleId) ?? "" },
    form: row.formId === null ? null : (formOf.get(row.formId) ?? null),
    lastDoneOn: row.lastDoneOn === null ? null : dayOf(row.lastDoneOn),
    nextDueOn: dayOf(row.nextDueOn),
    state: prpStateOf(row.nextDueOn, day),
    notes: row.notes,
    archived: row.archivedAt !== null,
    access: accessOf(ctx, row),
  }));
}

export async function listPrps(
  ctx: AdminContext,
  query: { kind?: (typeof prpKinds)[number] | undefined; archived?: "1" | undefined },
): Promise<PrpView[]> {
  await requireQuality(ctx);
  const rows = await ctx.db.qualityPrp.findMany({
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
  await requireQuality(ctx);
  const row = await ctx.db.qualityPrp.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select,
  });
  if (row === null) throw notFound();
  return row;
}

async function oneView(ctx: AdminContext, id: string): Promise<PrpView> {
  const [view] = await views(ctx, [await load(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

async function assertMember(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.membership.count({ where: { id, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

async function assertForm(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.node.count({ where: { id, type: "FORM", trashedAt: null } });
  if (found === 0) throw notFound();
}

async function setDue(
  db: TenantDb,
  row: { id: string; nextDueOn: Date; responsibleId: string | null; createdById: string },
) {
  await setExpiry(db, {
    kind: PRP_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.nextDueOn),
    responsibleId: row.responsibleId ?? row.createdById,
    noticeDays: [...NOTICE_DAYS],
  });
}

export async function createPrp(ctx: AdminContext, input: PrpInput): Promise<PrpView> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await assertMember(ctx.db, input.responsibleId);
  await assertForm(ctx.db, input.formId);
  const nextDueOn = input.nextDueOn ?? (await companyToday(ctx.db));
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qualityPrp.create({
      data: {
        kind: input.kind,
        name: input.name,
        location: input.location ?? null,
        everyDays: input.everyDays,
        responsibleId: input.responsibleId,
        formId: input.formId,
        nextDueOn: dateOf(nextDueOn),
        notes: input.notes ?? null,
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true, nextDueOn: true, responsibleId: true, createdById: true },
    });
    await setDue(tx, created);
    return created.id;
  });
  await auditAdmin(ctx, {
    action: "quality.prp.create",
    entityType: "QualityPrp",
    entityId: id,
    metadata: { kind: input.kind, everyDays: input.everyDays },
  });
  return await oneView(ctx, id);
}

export async function updatePrp(
  ctx: AdminContext,
  id: string,
  input: UpdatePrpInput,
): Promise<PrpView> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.archivedAt !== null) throw notFound();
  await assertMember(ctx.db, input.responsibleId);
  await assertForm(ctx.db, input.formId);
  const data: Prisma.QualityPrpUncheckedUpdateInput = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key !== "nextDueOn"),
  );
  if (input.nextDueOn !== undefined) data.nextDueOn = dateOf(input.nextDueOn);
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityPrp.update({
      where: { id },
      data,
      select: { id: true, nextDueOn: true, responsibleId: true, createdById: true },
    });
    await setDue(tx, updated);
  });
  await auditAdmin(ctx, {
    action: "quality.prp.update",
    entityType: "QualityPrp",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await oneView(ctx, id);
}

export async function setPrpArchived(
  ctx: AdminContext,
  id: string,
  archived: boolean,
): Promise<PrpView> {
  const current = await load(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityPrp.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select: { id: true },
    });
    if (archived) await resolveExpiry(tx, PRP_EXPIRY, id);
    else await setDue(tx, current);
  });
  await auditAdmin(ctx, {
    action: archived ? "quality.prp.archive" : "quality.prp.restore",
    entityType: "QualityPrp",
    entityId: id,
  });
  return await oneView(ctx, id);
}

export async function prpChecks(
  ctx: AdminContext,
  id: string,
): Promise<
  {
    id: string;
    doneOn: string;
    conforming: boolean;
    note: string | null;
    nc: { id: string; code: string } | null;
    by: { id: string; name: string };
  }[]
> {
  await load(ctx, id);
  const rows = await ctx.db.qualityPrpCheck.findMany({
    where: { prpId: id },
    select: { id: true, doneOn: true, conforming: true, note: true, ncId: true, doneById: true },
    orderBy: [{ doneOn: "desc" }, { id: "asc" }],
    take: 100,
  });
  const ncIds = rows.map((row) => row.ncId).filter((ncId): ncId is string => ncId !== null);
  const [people, ncs] = await Promise.all([
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.doneById))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
    ncIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityNc.findMany({
          where: { id: { in: ncIds } },
          select: { id: true, year: true, number: true },
        }),
  ]);
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const ncOf = new Map(ncs.map((nc) => [nc.id, nc]));
  return rows.map((row) => {
    const nc = row.ncId === null ? undefined : ncOf.get(row.ncId);
    return {
      id: row.id,
      doneOn: dayOf(row.doneOn),
      conforming: row.conforming,
      note: row.note,
      nc: nc === undefined ? null : { id: nc.id, code: qualityTexts.code(nc.year, nc.number) },
      by: { id: row.doneById, name: nameOf.get(row.doneById) ?? "" },
    };
  });
}

/**
 * A check (quality.manage or the control's responsible person): the next one `everyDays` later; not
 * conforming, its nonconformity if asked.
 */
export async function addPrpCheck(
  ctx: AdminContext,
  id: string,
  input: PrpCheckInput,
): Promise<PrpView> {
  const prp = await load(ctx, id);
  if (accessOf(ctx, prp) === "read") throw forbidden();
  if (prp.archivedAt !== null) throw notFound();
  let ncId: string | null = null;
  if (!input.conforming && input.openNc) {
    const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
    const title = withLocale(readWorkspaceLocale(workspace?.settings), () =>
      qualityTexts.prpNcTitle(prp.name),
    );
    const owner = prp.responsibleId ?? ctx.tenant.membershipId;
    ncId = await insertNc(ctx, {
      title: title.slice(0, qualityLimits.titleMax),
      description: input.note ?? title,
      origin: "INTERNAL",
      severity: input.severity,
      detectedOn: input.doneOn,
      location: prp.location,
      ownerId: owner,
      reportedById: ctx.tenant.membershipId,
    });
    await notifyNc(ctx.db, ncId, [owner], ctx.tenant.membershipId);
  }
  const next = addDays(input.doneOn, prp.everyDays);
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityPrpCheck.create({
      data: {
        prpId: id,
        doneOn: dateOf(input.doneOn),
        conforming: input.conforming,
        note: input.note ?? null,
        ncId,
        doneById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    // A check done before the last one doesn't move the next date back.
    if (prp.lastDoneOn === null || dayOf(prp.lastDoneOn) <= input.doneOn) {
      const updated = await tx.qualityPrp.update({
        where: { id },
        data: { lastDoneOn: dateOf(input.doneOn), nextDueOn: dateOf(next) },
        select: { id: true, nextDueOn: true, responsibleId: true, createdById: true },
      });
      await setDue(tx, updated);
    }
  });
  await auditAdmin(ctx, {
    action: "quality.prp.check",
    entityType: "QualityPrp",
    entityId: id,
    metadata: { doneOn: input.doneOn, conforming: input.conforming, ncId },
  });
  return await oneView(ctx, id);
}
