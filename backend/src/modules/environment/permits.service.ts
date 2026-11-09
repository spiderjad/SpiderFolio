// Environmental permits and recurring obligations (docs/spec/medio-ambiente.md, section 1): what the
// company holds and what it has to do every few months, with their expiries and notices.
import { environmentLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type { EnvPermitKind } from "../../generated/prisma/enums.ts";
import { notFound } from "../../lib/errors.ts";
import { environmentTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { ensureFolder, liveFolder } from "../quality/quality-folders.ts";
import { companyToday } from "../quality/prps.service.ts";
import {
  addMonths,
  dateOf,
  environmentManagers,
  requireManage,
  requireView,
} from "./environment-access.ts";
import { moduleSpace } from "./environment.service.ts";

export const PERMIT_EXPIRY = "environment.permit";
export const OBLIGATION_EXPIRY = "environment.obligation";
const NOTICE_DAYS = environmentLimits.noticeDays;

export interface PersonRef {
  id: string;
  name: string;
}

export interface PermitView {
  id: string;
  kind: EnvPermitKind;
  name: string;
  authority: string;
  reference: string;
  issuedOn: string | null;
  expiresOn: string | null;
  reviewOn: string | null;
  conditions: string;
  owner: PersonRef | null;
  /** Its folder of documents in the module's space. */
  folder: { spaceId: string; id: string } | null;
  archived: boolean;
}

export interface PermitInput {
  kind: EnvPermitKind;
  name: string;
  authority: string;
  reference: string;
  issuedOn: string | null;
  expiresOn: string | null;
  reviewOn: string | null;
  conditions: string;
  ownerId: string | null;
}

export interface ObligationView {
  id: string;
  name: string;
  permit: { id: string; name: string } | null;
  everyMonths: number;
  lastDoneOn: string | null;
  nextDueOn: string;
  owner: PersonRef | null;
  notes: string;
  archived: boolean;
  history: { doneOn: string; note: string; by: string }[];
}

export interface ObligationInput {
  name: string;
  permitId: string | null;
  everyMonths: number;
  nextDueOn: string;
  ownerId: string | null;
  notes: string;
}

const day = (value: Date | null): string | null => (value === null ? null : dayOf(value));
const optionalDate = (value: string | null): Date | null => (value === null ? null : dateOf(value));

async function people(db: TenantDb, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db.membership.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

const ref = (names: Map<string, string>, id: string | null): PersonRef | null =>
  id === null ? null : { id, name: names.get(id) ?? "" };

/** The person must be an active member of the company (or nobody). */
async function assertPerson(db: TenantDb, id: string | null): Promise<void> {
  if (id === null) return;
  const row = await db.membership.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true },
  });
  if (row === null) throw notFound();
}

// ─── Permits ────────────────────────────────────────────────────────────────────────────────

const permitSelect = {
  id: true,
  kind: true,
  name: true,
  authority: true,
  reference: true,
  issuedOn: true,
  expiresOn: true,
  reviewOn: true,
  conditions: true,
  ownerId: true,
  folderId: true,
  archivedAt: true,
} as const;

type PermitRow = {
  id: string;
  kind: EnvPermitKind;
  name: string;
  authority: string;
  reference: string;
  issuedOn: Date | null;
  expiresOn: Date | null;
  reviewOn: Date | null;
  conditions: string;
  ownerId: string | null;
  folderId: string | null;
  archivedAt: Date | null;
};

async function permitViews(ctx: AdminContext, rows: PermitRow[]): Promise<PermitView[]> {
  const names = await people(
    ctx.db,
    rows.map((row) => row.ownerId),
  );
  return await Promise.all(
    rows.map(async (row) => {
      const folder = await liveFolder(ctx, row.folderId);
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        authority: row.authority,
        reference: row.reference,
        issuedOn: day(row.issuedOn),
        expiresOn: day(row.expiresOn),
        reviewOn: day(row.reviewOn),
        conditions: row.conditions,
        owner: ref(names, row.ownerId),
        folder: folder === null ? null : { spaceId: folder.spaceId, id: folder.id },
        archived: row.archivedAt !== null,
      };
    }),
  );
}

/** The permit's expiry (or its review, whichever comes first), to its owner or the managers. */
async function syncPermitExpiry(db: TenantDb, row: PermitRow): Promise<void> {
  const dates = [row.expiresOn, row.reviewOn].filter((date): date is Date => date !== null);
  if (row.archivedAt !== null || dates.length === 0) {
    await resolveExpiry(db, PERMIT_EXPIRY, row.id);
    return;
  }
  const first = dates.reduce((a, b) => (a < b ? a : b));
  await setExpiry(db, {
    kind: PERMIT_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(first),
    responsibleId: row.ownerId ?? (await environmentManagers(db))[0] ?? null,
    noticeDays: [...NOTICE_DAYS],
  });
}

export async function listPermits(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<PermitView[]> {
  await requireView(ctx);
  const rows = await ctx.db.envPermit.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    select: permitSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
  return await permitViews(ctx, rows);
}

async function permitFolder(ctx: AdminContext, name: string): Promise<string> {
  const spaceId = await moduleSpace(ctx);
  const parent = await ensureFolder(ctx, spaceId, null, environmentTexts.folders.permits);
  return await ensureFolder(ctx, spaceId, parent, name);
}

export async function createPermit(ctx: AdminContext, input: PermitInput): Promise<PermitView> {
  await requireManage(ctx);
  await assertPerson(ctx.db, input.ownerId);
  const folderId = await permitFolder(ctx, input.name);
  const row = await ctx.db.envPermit.create({
    data: {
      kind: input.kind,
      name: input.name,
      authority: input.authority,
      reference: input.reference,
      issuedOn: optionalDate(input.issuedOn),
      expiresOn: optionalDate(input.expiresOn),
      reviewOn: optionalDate(input.reviewOn),
      conditions: input.conditions,
      ownerId: input.ownerId,
      folderId,
    },
    select: permitSelect,
  });
  await syncPermitExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "environment.permit.create",
    entityType: "EnvPermit",
    entityId: row.id,
    metadata: { kind: row.kind, name: row.name },
  });
  return (await permitViews(ctx, [row]))[0] as PermitView;
}

export async function updatePermit(
  ctx: AdminContext,
  id: string,
  input: PermitInput & { archived?: boolean | undefined },
): Promise<PermitView> {
  await requireManage(ctx);
  await assertPerson(ctx.db, input.ownerId);
  const current = await ctx.db.envPermit.findFirst({ where: { id }, select: { folderId: true } });
  if (current === null) throw notFound();
  const folder = await liveFolder(ctx, current.folderId);
  const row = await ctx.db.envPermit.update({
    where: { id },
    data: {
      kind: input.kind,
      name: input.name,
      authority: input.authority,
      reference: input.reference,
      issuedOn: optionalDate(input.issuedOn),
      expiresOn: optionalDate(input.expiresOn),
      reviewOn: optionalDate(input.reviewOn),
      conditions: input.conditions,
      ownerId: input.ownerId,
      ...(folder === null ? { folderId: await permitFolder(ctx, input.name) } : {}),
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
    },
    select: permitSelect,
  });
  await syncPermitExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: input.archived === true ? "environment.permit.archive" : "environment.permit.update",
    entityType: "EnvPermit",
    entityId: row.id,
    metadata: { kind: row.kind, name: row.name },
  });
  return (await permitViews(ctx, [row]))[0] as PermitView;
}

// ─── Obligations ────────────────────────────────────────────────────────────────────────────

const obligationSelect = {
  id: true,
  name: true,
  permitId: true,
  everyMonths: true,
  lastDoneOn: true,
  nextDueOn: true,
  ownerId: true,
  notes: true,
  archivedAt: true,
} as const;

type ObligationRow = {
  id: string;
  name: string;
  permitId: string | null;
  everyMonths: number;
  lastDoneOn: Date | null;
  nextDueOn: Date;
  ownerId: string | null;
  notes: string;
  archivedAt: Date | null;
};

async function obligationViews(
  ctx: AdminContext,
  rows: ObligationRow[],
  withHistory: boolean,
): Promise<ObligationView[]> {
  const permitIds = [
    ...new Set(rows.flatMap((row) => (row.permitId === null ? [] : [row.permitId]))),
  ];
  const permits =
    permitIds.length === 0
      ? []
      : await ctx.db.envPermit.findMany({
          where: { id: { in: permitIds } },
          select: { id: true, name: true },
        });
  const permitName = new Map(permits.map((permit) => [permit.id, permit.name]));
  const history = withHistory
    ? await ctx.db.envObligationDone.findMany({
        where: { obligationId: { in: rows.map((row) => row.id) } },
        orderBy: [{ doneOn: "desc" }, { id: "desc" }],
        take: 200,
        select: { obligationId: true, doneOn: true, note: true, recordedById: true },
      })
    : [];
  const names = await people(ctx.db, [
    ...rows.map((row) => row.ownerId),
    ...history.map((entry) => entry.recordedById),
  ]);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    permit:
      row.permitId === null || !permitName.has(row.permitId)
        ? null
        : { id: row.permitId, name: permitName.get(row.permitId) ?? "" },
    everyMonths: row.everyMonths,
    lastDoneOn: day(row.lastDoneOn),
    nextDueOn: dayOf(row.nextDueOn),
    owner: ref(names, row.ownerId),
    notes: row.notes,
    archived: row.archivedAt !== null,
    history: history
      .filter((entry) => entry.obligationId === row.id)
      .map((entry) => ({
        doneOn: dayOf(entry.doneOn),
        note: entry.note,
        by: names.get(entry.recordedById) ?? "",
      })),
  }));
}

async function syncObligationExpiry(db: TenantDb, row: ObligationRow): Promise<void> {
  if (row.archivedAt !== null) {
    await resolveExpiry(db, OBLIGATION_EXPIRY, row.id);
    return;
  }
  await setExpiry(db, {
    kind: OBLIGATION_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.nextDueOn),
    responsibleId: row.ownerId ?? (await environmentManagers(db))[0] ?? null,
    noticeDays: [...NOTICE_DAYS],
  });
}

async function assertPermit(db: TenantDb, id: string | null): Promise<void> {
  if (id === null) return;
  const row = await db.envPermit.findFirst({ where: { id }, select: { id: true } });
  if (row === null) throw notFound();
}

export async function listObligations(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<ObligationView[]> {
  await requireView(ctx);
  const rows = await ctx.db.envObligation.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    select: obligationSelect,
    orderBy: [{ nextDueOn: "asc" }, { id: "asc" }],
    take: 500,
  });
  return await obligationViews(ctx, rows, true);
}

export async function createObligation(
  ctx: AdminContext,
  input: ObligationInput,
): Promise<ObligationView> {
  await requireManage(ctx);
  await assertPerson(ctx.db, input.ownerId);
  await assertPermit(ctx.db, input.permitId);
  const row = await ctx.db.envObligation.create({
    data: {
      name: input.name,
      permitId: input.permitId,
      everyMonths: input.everyMonths,
      nextDueOn: dateOf(input.nextDueOn),
      ownerId: input.ownerId,
      notes: input.notes,
    },
    select: obligationSelect,
  });
  await syncObligationExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "environment.obligation.create",
    entityType: "EnvObligation",
    entityId: row.id,
    metadata: { name: row.name, everyMonths: row.everyMonths },
  });
  return (await obligationViews(ctx, [row], true))[0] as ObligationView;
}

export async function updateObligation(
  ctx: AdminContext,
  id: string,
  input: ObligationInput & { archived?: boolean | undefined },
): Promise<ObligationView> {
  await requireManage(ctx);
  await assertPerson(ctx.db, input.ownerId);
  await assertPermit(ctx.db, input.permitId);
  const exists = await ctx.db.envObligation.findFirst({ where: { id }, select: { id: true } });
  if (exists === null) throw notFound();
  const row = await ctx.db.envObligation.update({
    where: { id },
    data: {
      name: input.name,
      permitId: input.permitId,
      everyMonths: input.everyMonths,
      nextDueOn: dateOf(input.nextDueOn),
      ownerId: input.ownerId,
      notes: input.notes,
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
    },
    select: obligationSelect,
  });
  await syncObligationExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "environment.obligation.update",
    entityType: "EnvObligation",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return (await obligationViews(ctx, [row], true))[0] as ObligationView;
}

/** Done on a day: it goes to its history and the next one is that day plus its period. */
export async function completeObligation(
  ctx: AdminContext,
  id: string,
  input: { doneOn: string; note: string },
): Promise<ObligationView> {
  await requireManage(ctx);
  const current = await ctx.db.envObligation.findFirst({
    where: { id, archivedAt: null },
    select: { everyMonths: true },
  });
  if (current === null) throw notFound();
  const today = await companyToday(ctx.db);
  const doneOn = input.doneOn > today ? today : input.doneOn;
  const row = await ctx.db.$transaction(async (tx) => {
    await tx.envObligationDone.create({
      data: {
        obligationId: id,
        doneOn: dateOf(doneOn),
        note: input.note,
        recordedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    return await tx.envObligation.update({
      where: { id },
      data: {
        lastDoneOn: dateOf(doneOn),
        nextDueOn: dateOf(addMonths(doneOn, current.everyMonths)),
      },
      select: obligationSelect,
    });
  });
  await syncObligationExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "environment.obligation.done",
    entityType: "EnvObligation",
    entityId: id,
    metadata: { doneOn },
  });
  return (await obligationViews(ctx, [row], true))[0] as ObligationView;
}
