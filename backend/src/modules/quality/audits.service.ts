// Audits (docs/spec/calidad.md, «Fase 3»): the annual programme of internal and external audits, their
// findings by clause and the nonconformity each one opens, and the coverage of the internal programme by
// chapter of the company's standards. quality.manage handles them; quality.view reads them; whoever leads
// an audit sees it, records its findings and closes it.
import { qualityLimits } from "@spiderfolio/limits";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { qualityTexts } from "../../i18n/index.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { AUDIT_EXPIRY } from "./quality-expiry.ts";
import { insertNc, notifyNc } from "./ncs.service.ts";
import type { AuditInput, FindingInput, UpdateAuditInput } from "./audits.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;
const CHAPTERS = { IFS8: 6, BRCGS9: 9 } as const;

type Scheme = "INTERNAL" | "IFS8" | "BRCGS9" | "CLIENT" | "OFFICIAL" | "OTHER";
type Severity = "MINOR" | "MAJOR" | "CRITICAL";

interface Person {
  id: string;
  name: string;
}

export interface FindingView {
  id: string;
  clause: string;
  description: string;
  severity: Severity;
  nc: { id: string; code: string; status: string } | null;
  createdAt: Date;
}

export interface AuditView {
  id: string;
  scheme: Scheme;
  title: string;
  scope: string | null;
  plannedOn: string;
  doneOn: string | null;
  auditor: string | null;
  lead: Person | null;
  chapters: string[];
  status: "PLANNED" | "DONE" | "CANCELLED";
  result: string | null;
  room: { id: string; name: string } | null;
  cancelReason: string | null;
  findings: { total: number; openNcs: number };
  /** manage: everything; lead: findings and closing; read. */
  access: "manage" | "lead" | "read";
}

export interface AuditDetail extends AuditView {
  findingItems: FindingView[];
}

const auditSelect = {
  id: true,
  scheme: true,
  title: true,
  scope: true,
  plannedOn: true,
  doneOn: true,
  auditor: true,
  leadId: true,
  chapters: true,
  status: true,
  result: true,
  auditRoomId: true,
  cancelReason: true,
  createdById: true,
} as const;

type AuditRow = Prisma.QualityAuditGetPayload<{ select: typeof auditSelect }>;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function accessOf(ctx: AdminContext, row: { leadId: string | null }): AuditView["access"] {
  if (canManageQuality(ctx)) return "manage";
  if (row.leadId === ctx.tenant.membershipId) return "lead";
  return "read";
}

/** Beyond quality.view, only the audits the person leads. */
function visibleWhere(ctx: AdminContext): Prisma.QualityAuditWhereInput {
  return canViewQuality(ctx) ? {} : { leadId: ctx.tenant.membershipId };
}

async function views(ctx: AdminContext, rows: AuditRow[]): Promise<AuditView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const leadIds = [
    ...new Set(rows.map((row) => row.leadId).filter((id): id is string => id !== null)),
  ];
  const roomIds = [
    ...new Set(rows.map((row) => row.auditRoomId).filter((id): id is string => id !== null)),
  ];
  const [people, rooms, findings] = await Promise.all([
    leadIds.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, user: { select: { name: true } } },
        }),
    roomIds.length === 0
      ? Promise.resolve([])
      : ctx.db.auditRoom.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, name: true },
        }),
    ctx.db.qualityFinding.findMany({
      where: { auditId: { in: ids } },
      select: { auditId: true, nc: { select: { status: true } } },
    }),
  ]);
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const roomOf = new Map(rooms.map((room) => [room.id, room]));
  return rows.map((row) => {
    const own = findings.filter((finding) => finding.auditId === row.id);
    return {
      id: row.id,
      scheme: row.scheme,
      title: row.title,
      scope: row.scope,
      plannedOn: dayOf(row.plannedOn),
      doneOn: row.doneOn === null ? null : dayOf(row.doneOn),
      auditor: row.auditor,
      lead: row.leadId === null ? null : { id: row.leadId, name: nameOf.get(row.leadId) ?? "" },
      chapters: row.chapters,
      status: row.status,
      result: row.result,
      room: row.auditRoomId === null ? null : (roomOf.get(row.auditRoomId) ?? null),
      cancelReason: row.cancelReason,
      findings: {
        total: own.length,
        openNcs: own.filter(
          (finding) =>
            finding.nc !== null &&
            finding.nc.status !== "CLOSED" &&
            finding.nc.status !== "CANCELLED",
        ).length,
      },
      access: accessOf(ctx, row),
    };
  });
}

async function loadAudit(ctx: AdminContext, id: string): Promise<AuditRow> {
  await requireQuality(ctx);
  const row = await ctx.db.qualityAudit.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select: auditSelect,
  });
  if (row === null) throw notFound();
  return row;
}

async function findingViews(ctx: AdminContext, auditId: string): Promise<FindingView[]> {
  const rows = await ctx.db.qualityFinding.findMany({
    where: { auditId },
    select: {
      id: true,
      clause: true,
      description: true,
      severity: true,
      createdAt: true,
      nc: { select: { id: true, year: true, number: true, status: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    clause: row.clause,
    description: row.description,
    severity: row.severity,
    nc:
      row.nc === null
        ? null
        : {
            id: row.nc.id,
            code: qualityTexts.code(row.nc.year, row.nc.number),
            status: row.nc.status,
          },
    createdAt: row.createdAt,
  }));
}

export async function getAudit(ctx: AdminContext, id: string): Promise<AuditDetail> {
  const row = await loadAudit(ctx, id);
  const [view] = await views(ctx, [row]);
  if (view === undefined) throw notFound();
  return { ...view, findingItems: await findingViews(ctx, id) };
}

/** The year's audits by date (and the ones the person leads, without quality.view). */
export async function listAudits(
  ctx: AdminContext,
  query: { year: number; status: "PLANNED" | "DONE" | "CANCELLED" | "all" },
): Promise<AuditView[]> {
  await requireQuality(ctx);
  const rows = await ctx.db.qualityAudit.findMany({
    where: {
      AND: [
        visibleWhere(ctx),
        {
          plannedOn: {
            gte: dateOf(`${String(query.year)}-01-01`),
            lte: dateOf(`${String(query.year)}-12-31`),
          },
        },
        query.status === "all" ? {} : { status: query.status },
      ],
    },
    select: auditSelect,
    orderBy: [{ plannedOn: "asc" }, { id: "asc" }],
    take: 500,
  });
  return await views(ctx, rows);
}

/**
 * The internal programme's coverage in a year: for each standard the company is audited against, its
 * chapters and the done internal audits that covered each one (quality.view).
 */
export async function auditCoverage(
  ctx: AdminContext,
  year: number,
): Promise<{ standard: "IFS8" | "BRCGS9"; chapters: { number: number; audits: string[] }[] }[]> {
  const settings = await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
  const done = await ctx.db.qualityAudit.findMany({
    where: {
      scheme: "INTERNAL",
      status: "DONE",
      doneOn: { gte: dateOf(`${String(year)}-01-01`), lte: dateOf(`${String(year)}-12-31`) },
    },
    select: { title: true, chapters: true },
    take: 500,
  });
  return settings.standards.map((standard) => ({
    standard,
    chapters: Array.from({ length: CHAPTERS[standard] }, (_unused, index) => {
      const key = `${standard}:${String(index + 1)}`;
      return {
        number: index + 1,
        audits: done.filter((audit) => audit.chapters.includes(key)).map((audit) => audit.title),
      };
    }),
  }));
}

async function assertMember(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.membership.count({ where: { id, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

/** A room this person may link: theirs, or any for the owner (like the rooms themselves). */
async function assertRoom(ctx: AdminContext, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const owner = ctx.tenant.role.base === "OWNER";
  const found = await ctx.db.auditRoom.count({
    where: { id, ...(owner ? {} : { createdById: ctx.tenant.membershipId }) },
  });
  if (found === 0) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.auditMessages.roomNotFound });
  }
}

async function assertChapters(ctx: AdminContext, chapters: readonly string[] | undefined) {
  if (chapters === undefined || chapters.length === 0) return;
  const settings = await requireQuality(ctx);
  const ok = chapters.every((chapter) => {
    const [standard, number] = chapter.split(":");
    return (
      (standard === "IFS8" || standard === "BRCGS9") &&
      settings.standards.includes(standard) &&
      Number(number) <= CHAPTERS[standard]
    );
  });
  if (!ok)
    throw new AppError("BAD_REQUEST", { message: qualityTexts.auditMessages.chapterInvalid });
}

async function setAuditExpiry(db: TenantDb, audit: AuditRow): Promise<void> {
  await setExpiry(db, {
    kind: AUDIT_EXPIRY,
    subjectId: audit.id,
    dueOn: dayOf(audit.plannedOn),
    responsibleId: audit.leadId ?? audit.createdById,
    noticeDays: [...NOTICE_DAYS],
  });
}

export async function createAudit(ctx: AdminContext, input: AuditInput): Promise<AuditDetail> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await assertMember(ctx.db, input.leadId);
  await assertRoom(ctx, input.auditRoomId);
  await assertChapters(ctx, input.scheme === "INTERNAL" ? input.chapters : []);
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qualityAudit.create({
      data: {
        ...input,
        scope: input.scope ?? null,
        auditor: input.auditor ?? null,
        chapters: input.scheme === "INTERNAL" ? [...new Set(input.chapters)] : [],
        plannedOn: dateOf(input.plannedOn),
        createdById: ctx.tenant.membershipId,
      },
      select: auditSelect,
    });
    await setAuditExpiry(tx, created);
    return created.id;
  });
  await auditAdmin(ctx, {
    action: "quality.audit.create",
    entityType: "QualityAudit",
    entityId: id,
    metadata: { scheme: input.scheme, plannedOn: input.plannedOn },
  });
  return await getAudit(ctx, id);
}

async function loadPlanned(ctx: AdminContext, id: string): Promise<AuditRow> {
  const row = await loadAudit(ctx, id);
  if (row.status !== "PLANNED") {
    throw new AppError("CONFLICT", { message: qualityTexts.auditMessages.notPlanned });
  }
  return row;
}

export async function updateAudit(
  ctx: AdminContext,
  id: string,
  input: UpdateAuditInput,
): Promise<AuditDetail> {
  const current = await loadPlanned(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  await assertMember(ctx.db, input.leadId);
  await assertRoom(ctx, input.auditRoomId);
  const scheme = input.scheme ?? current.scheme;
  await assertChapters(ctx, scheme === "INTERNAL" ? input.chapters : []);
  const data: Prisma.QualityAuditUncheckedUpdateInput = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key !== "plannedOn"),
  );
  if (input.plannedOn !== undefined) data.plannedOn = dateOf(input.plannedOn);
  if (scheme !== "INTERNAL") data.chapters = [];
  else if (input.chapters !== undefined) data.chapters = [...new Set(input.chapters)];
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityAudit.update({ where: { id }, data, select: auditSelect });
    await setAuditExpiry(tx, updated);
  });
  await auditAdmin(ctx, {
    action: "quality.audit.update",
    entityType: "QualityAudit",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await getAudit(ctx, id);
}

/** Done: by quality.manage or whoever leads it. */
export async function closeAudit(
  ctx: AdminContext,
  id: string,
  input: { doneOn: string; result?: string | null | undefined },
): Promise<AuditDetail> {
  const current = await loadPlanned(ctx, id);
  if (accessOf(ctx, current) === "read") throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityAudit.update({
      where: { id },
      data: { status: "DONE", doneOn: dateOf(input.doneOn), result: input.result ?? null },
      select: { id: true },
    });
    await resolveExpiry(tx, AUDIT_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "quality.audit.done",
    entityType: "QualityAudit",
    entityId: id,
    metadata: { doneOn: input.doneOn },
  });
  return await getAudit(ctx, id);
}

export async function cancelAudit(
  ctx: AdminContext,
  id: string,
  reason: string,
): Promise<AuditDetail> {
  await loadPlanned(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityAudit.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: reason },
      select: { id: true },
    });
    await resolveExpiry(tx, AUDIT_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "quality.audit.cancel",
    entityType: "QualityAudit",
    entityId: id,
    metadata: { reason },
  });
  return await getAudit(ctx, id);
}

/** The NC of a finding: its audit's origin, the finding's severity and clause, the audit's day. */
async function openFindingNc(
  ctx: AdminContext,
  audit: AuditRow,
  finding: { id: string; clause: string; description: string; severity: Severity },
  ownerId: string | null,
): Promise<string> {
  const owner = ownerId ?? audit.leadId ?? ctx.tenant.membershipId;
  await assertMember(ctx.db, owner);
  const title = qualityTexts.findingTitle(finding.clause, finding.description);
  const ncId = await insertNc(ctx, {
    title:
      title.length > qualityLimits.titleMax
        ? `${title.slice(0, qualityLimits.titleMax - 1)}…`
        : title,
    description: finding.description,
    origin: audit.scheme === "INTERNAL" ? "AUDIT_INTERNAL" : "AUDIT_EXTERNAL",
    severity: finding.severity,
    detectedOn: dayOf(audit.doneOn ?? audit.plannedOn),
    ownerId: owner,
    reportedById: ctx.tenant.membershipId,
  });
  await ctx.db.qualityFinding.update({
    where: { id: finding.id },
    data: { ncId },
    select: { id: true },
  });
  await notifyNc(ctx.db, ncId, [owner], ctx.tenant.membershipId);
  return ncId;
}

/** A finding (quality.manage or whoever leads the audit), with its NC if asked. */
export async function addFinding(
  ctx: AdminContext,
  auditId: string,
  input: FindingInput,
): Promise<AuditDetail> {
  const audit = await loadAudit(ctx, auditId);
  if (accessOf(ctx, audit) === "read") throw forbidden();
  if (audit.status === "CANCELLED") {
    throw new AppError("CONFLICT", { message: qualityTexts.auditMessages.notPlanned });
  }
  if (input.ownerId !== null) await assertMember(ctx.db, input.ownerId);
  const finding = await ctx.db.qualityFinding.create({
    data: {
      auditId,
      clause: input.clause,
      description: input.description,
      severity: input.severity,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true, clause: true, description: true, severity: true },
  });
  await auditAdmin(ctx, {
    action: "quality.finding.create",
    entityType: "QualityAudit",
    entityId: auditId,
    metadata: { findingId: finding.id, clause: input.clause, severity: input.severity },
  });
  if (input.openNc) await openFindingNc(ctx, audit, finding, input.ownerId);
  return await getAudit(ctx, auditId);
}

/** Opens the NC of a finding that doesn't have one yet. */
export async function findingNc(
  ctx: AdminContext,
  findingId: string,
  ownerId: string | null,
): Promise<AuditDetail> {
  await requireQuality(ctx);
  const finding = await ctx.db.qualityFinding.findFirst({
    where: { id: findingId },
    select: {
      id: true,
      auditId: true,
      clause: true,
      description: true,
      severity: true,
      ncId: true,
    },
  });
  if (finding === null) throw notFound();
  const audit = await loadAudit(ctx, finding.auditId);
  if (accessOf(ctx, audit) === "read") throw forbidden();
  if (finding.ncId !== null) {
    throw new AppError("CONFLICT", { message: qualityTexts.auditMessages.hasNc });
  }
  await openFindingNc(ctx, audit, finding, ownerId);
  return await getAudit(ctx, audit.id);
}

/** The audit a nonconformity came from (its record links it), if the person sees it. */
export async function auditOfNc(
  ctx: AdminContext,
  ncId: string,
): Promise<{ id: string; title: string; clause: string } | null> {
  const finding = await ctx.db.qualityFinding.findFirst({
    where: { ncId, audit: visibleWhere(ctx) },
    select: { clause: true, audit: { select: { id: true, title: true } } },
  });
  return finding === null
    ? null
    : { id: finding.audit.id, title: finding.audit.title, clause: finding.clause };
}
