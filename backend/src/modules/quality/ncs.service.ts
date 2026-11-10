// Nonconformities and their CAPA (docs/spec/calidad.md, «Fase 1»). A nonconformity (NC) goes
// OPEN → ANALYSIS → ACTIONS → VERIFICATION → CLOSED, or CANCELLED with a reason before closing:
//   - ANALYSIS when its root cause is written; ACTIONS with its first action;
//   - VERIFICATION by itself once every action is done (the check is proposed `verifyDays` later and
//     told to its owner as a `quality.verification` expiry);
//   - CLOSED when quality.manage records it was effective; not effective goes back to ACTIONS.
// Every step goes into its history (QualityNcEvent) and the audit log.
//
// Who sees what: quality.manage handles everything; quality.view reads everything; the owner handles
// their NC (not the closing); whoever reported it, whoever has one of its actions and the heads of its
// department read it. Anyone else gets 404.
import { qualityLimits } from "@spiderfolio/limits";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { currentLocale, readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { TenantDb } from "../../db/tenant.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { ledDepartmentIds } from "../departments/departments.scope.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { FieldsSchema } from "../forms/forms.schemas.ts";
import { assetNamedByRecord, maintenanceEnabled } from "../maintenance/quality-link.ts";
import { workOrderForNc, workOrdersOfNc } from "../maintenance/work-orders.service.ts";
import { responsiblesOf } from "../forms/settings.service.ts";
import { toCsv } from "../members/members.csv.ts";
import { lastPosition } from "../nodes/nodes.service.ts";
import {
  canManageQuality,
  canViewQuality,
  qualitySettingsOf,
  requireQuality,
} from "./quality-access.ts";
import { ACTION_EXPIRY, VERIFICATION_EXPIRY } from "./quality-expiry.ts";
import { holdsOfNc, type HoldView } from "./holds.service.ts";
import { auditOfNc } from "./audits.service.ts";
import { assertSupplier, supplierOfNc } from "./suppliers.service.ts";
import {
  analysisOf,
  type ActionInput,
  type CreateNcInput,
  type ListActionsQuery,
  type ListNcsQuery,
  type NcFilters,
  type ReportNcInput,
  type UpdateActionInput,
  type UpdateNcInput,
} from "./quality.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;
const VERIFY_NOTICE_DAYS = [0] as const;

type Status = "OPEN" | "ANALYSIS" | "ACTIONS" | "VERIFICATION" | "CLOSED" | "CANCELLED";
const FINAL: readonly Status[] = ["CLOSED", "CANCELLED"];
const SEVERITY_RANK = { CRITICAL: 0, MAJOR: 1, MINOR: 2 } as const;

/** What the viewer may do with one NC. */
type Access = "manage" | "edit" | "read";

interface Person {
  id: string;
  name: string;
}

export interface NcSummary {
  id: string;
  code: string;
  title: string;
  origin: string;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  status: Status;
  detectedOn: string;
  owner: Person;
  department: { id: string; name: string } | null;
  actions: { total: number; open: number; overdue: number };
  createdAt: Date;
}

export interface QualityActionView {
  id: string;
  nc: { id: string; code: string; title: string };
  kind: "CORRECTION" | "CORRECTIVE" | "PREVENTIVE";
  description: string;
  responsible: Person;
  dueOn: string;
  overdue: boolean;
  done: { at: Date; by: Person | null; note: string | null } | null;
  /** The viewer can change it (quality.manage or the NC's owner), and mark it done (also its own). */
  canEdit: boolean;
  canComplete: boolean;
}

export interface NcDetail extends NcSummary {
  /** Its maintenance work orders (docs/spec/mantenimiento.md, section 8); empty with the module off. */
  maintenance: Awaited<ReturnType<typeof workOrdersOfNc>>;
  /** The Maintenance module is on: «Ask maintenance» is offered. */
  maintenanceEnabled: boolean;
  description: string;
  location: string | null;
  record: { id: string; formId: string; spaceId: string; label: string } | null;
  fieldIds: string[];
  productAffected: boolean;
  productNote: string | null;
  correction: string | null;
  causeMethod: "FIVE_WHYS" | "ISHIKAWA" | "OTHER" | null;
  causeAnalysis: unknown;
  rootCause: string | null;
  verifyOn: string | null;
  cancelReason: string | null;
  folder: { id: string; spaceId: string } | null;
  reportedBy: Person;
  closedAt: Date | null;
  closedBy: Person | null;
  actionItems: QualityActionView[];
  verifications: { id: string; effective: boolean; note: string; by: Person; at: Date }[];
  /** Product put on hold for it (phase 2). */
  holds: HoldView[];
  /** The audit whose finding opened it (phase 3). */
  audit: { id: string; title: string; clause: string } | null;
  /** The supplier it's about (phase 4). */
  supplier: { id: string; name: string } | null;
  /** manage: everything; edit: the owner (not the closing); read: only reading. */
  access: Access;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────

async function names(
  db: TenantDb,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (wanted.length === 0) return new Map();
  const rows = await db.membership.findMany({
    where: { id: { in: wanted } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

const person = (people: Map<string, string>, id: string): Person => ({
  id,
  name: people.get(id) ?? "",
});

async function today(db: TenantDb): Promise<string> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function addDays(day: string, days: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

async function assertMember(db: TenantDb, membershipId: string): Promise<void> {
  const found = await db.membership.count({ where: { id: membershipId, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

async function assertDepartment(db: TenantDb, departmentId: string | null): Promise<void> {
  if (departmentId === null) return;
  const found = await db.department.count({ where: { id: departmentId } });
  if (found === 0) throw notFound();
}

const codeOf = (nc: { year: number; number: number }) => qualityTexts.code(nc.year, nc.number);

/** Whose NCs someone sees beyond their own role: none (everything) or a filter. */
async function visibleWhere(ctx: AdminContext): Promise<Prisma.QualityNcWhereInput | null> {
  if (canViewQuality(ctx)) return null;
  const me = ctx.tenant.membershipId;
  const led = await ledDepartmentIds(ctx, me);
  return {
    OR: [
      { ownerId: me },
      { reportedById: me },
      { actions: { some: { responsibleId: me } } },
      ...(led.length === 0 ? [] : [{ departmentId: { in: led } }]),
    ],
  };
}

function accessOf(ctx: AdminContext, nc: { ownerId: string }): Access {
  if (canManageQuality(ctx)) return "manage";
  if (nc.ownerId === ctx.tenant.membershipId) return "edit";
  return "read";
}

const ncSelect = {
  id: true,
  year: true,
  number: true,
  title: true,
  description: true,
  origin: true,
  severity: true,
  status: true,
  detectedOn: true,
  location: true,
  departmentId: true,
  recordId: true,
  fieldIds: true,
  productAffected: true,
  productNote: true,
  correction: true,
  causeMethod: true,
  causeAnalysis: true,
  rootCause: true,
  ownerId: true,
  verifyOn: true,
  cancelReason: true,
  folderId: true,
  supplierId: true,
  reportedById: true,
  createdAt: true,
  closedAt: true,
  closedById: true,
} as const;

type NcRow = Prisma.QualityNcGetPayload<{ select: typeof ncSelect }>;

/** The NC if this person sees it (404 otherwise), with what they may do. */
async function loadNc(ctx: AdminContext, id: string): Promise<{ row: NcRow; access: Access }> {
  await requireQuality(ctx);
  const visible = await visibleWhere(ctx);
  const row = await ctx.db.qualityNc.findFirst({
    where: visible === null ? { id } : { AND: [{ id }, visible] },
    select: ncSelect,
  });
  if (row === null) throw notFound();
  return { row, access: accessOf(ctx, row) };
}

async function loadEditable(ctx: AdminContext, id: string): Promise<NcRow> {
  const { row, access } = await loadNc(ctx, id);
  if (access === "read") throw forbidden();
  if (FINAL.includes(row.status)) {
    throw new AppError("CONFLICT", { message: qualityTexts.messages.closed });
  }
  return row;
}

async function addEvent(
  db: TenantDb,
  ncId: string,
  kind: string,
  actorId: string | null,
  data: Prisma.InputJsonValue = {},
): Promise<void> {
  await db.qualityNcEvent.create({ data: { ncId, kind, actorId, data } });
}

export async function notifyNc(
  db: TenantDb,
  ncId: string,
  recipients: readonly string[],
  actorId: string,
): Promise<void> {
  for (const membershipId of new Set(recipients)) {
    if (membershipId === actorId) continue;
    await db.notification.create({
      data: { membershipId, kind: "quality_nc", actorId, detail: ncId },
      select: { id: true },
    });
  }
}

/** Whoever has quality.manage, active. */
export async function managers(db: TenantDb): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { status: "ACTIVE", role: { capabilities: { has: "quality.manage" } } },
    select: { id: true, role: { select: { base: true } } },
    orderBy: { createdAt: "asc" },
  });
  // The company's owner first: a reported NC is theirs until it's assigned.
  return [
    ...rows.filter((row) => row.role.base === "OWNER"),
    ...rows.filter((row) => row.role.base !== "OWNER"),
  ].map((row) => row.id);
}

// ─── Views ───────────────────────────────────────────────────────────────────────────────

async function summaries(ctx: AdminContext, rows: NcRow[]): Promise<NcSummary[]> {
  if (rows.length === 0) return [];
  const day = await today(ctx.db);
  const ids = rows.map((row) => row.id);
  const [people, departments, open, total, overdue] = await Promise.all([
    names(
      ctx.db,
      rows.map((row) => row.ownerId),
    ),
    ctx.db.department.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              rows.map((row) => row.departmentId).filter((id): id is string => id !== null),
            ),
          ],
        },
      },
      select: { id: true, name: true },
    }),
    ctx.db.qualityAction.groupBy({
      by: ["ncId"],
      where: { ncId: { in: ids }, doneAt: null },
      _count: { _all: true },
    }),
    ctx.db.qualityAction.groupBy({
      by: ["ncId"],
      where: { ncId: { in: ids } },
      _count: { _all: true },
    }),
    ctx.db.qualityAction.groupBy({
      by: ["ncId"],
      where: { ncId: { in: ids }, doneAt: null, dueOn: { lt: dateOf(day) } },
      _count: { _all: true },
    }),
  ]);
  const departmentOf = new Map(departments.map((row) => [row.id, row]));
  const countOf = (list: { ncId: string; _count: { _all: number } }[]) =>
    new Map(list.map((row) => [row.ncId, row._count._all]));
  const openOf = countOf(open);
  const totalOf = countOf(total);
  const overdueOf = countOf(overdue);
  return rows.map((row) => ({
    id: row.id,
    code: codeOf(row),
    title: row.title,
    origin: row.origin,
    severity: row.severity,
    status: row.status,
    detectedOn: dayOf(row.detectedOn),
    owner: person(people, row.ownerId),
    department: row.departmentId === null ? null : (departmentOf.get(row.departmentId) ?? null),
    actions: {
      total: totalOf.get(row.id) ?? 0,
      open: openOf.get(row.id) ?? 0,
      overdue: overdueOf.get(row.id) ?? 0,
    },
    createdAt: row.createdAt,
  }));
}

const actionSelect = {
  id: true,
  ncId: true,
  kind: true,
  description: true,
  responsibleId: true,
  dueOn: true,
  doneAt: true,
  doneById: true,
  note: true,
  nc: { select: { id: true, year: true, number: true, title: true, ownerId: true, status: true } },
} as const;

type ActionRow = Prisma.QualityActionGetPayload<{ select: typeof actionSelect }>;

async function actionViews(ctx: AdminContext, rows: ActionRow[]): Promise<QualityActionView[]> {
  const day = await today(ctx.db);
  const people = await names(
    ctx.db,
    rows.flatMap((row) => [row.responsibleId, row.doneById]),
  );
  const manage = canManageQuality(ctx);
  return rows.map((row) => {
    const open = !FINAL.includes(row.nc.status) && row.doneAt === null;
    const handles = manage || row.nc.ownerId === ctx.tenant.membershipId;
    return {
      id: row.id,
      nc: { id: row.nc.id, code: codeOf(row.nc), title: row.nc.title },
      kind: row.kind,
      description: row.description,
      responsible: person(people, row.responsibleId),
      dueOn: dayOf(row.dueOn),
      overdue: row.doneAt === null && dayOf(row.dueOn) < day,
      done:
        row.doneAt === null
          ? null
          : {
              at: row.doneAt,
              by: row.doneById === null ? null : person(people, row.doneById),
              note: row.note,
            },
      canEdit: open && handles,
      canComplete: open && (handles || row.responsibleId === ctx.tenant.membershipId),
    };
  });
}

async function detailOf(ctx: AdminContext, row: NcRow, access: Access): Promise<NcDetail> {
  const [summary] = await summaries(ctx, [row]);
  if (summary === undefined) throw notFound();
  const [actions, verifications, record, folder] = await Promise.all([
    ctx.db.qualityAction.findMany({
      where: { ncId: row.id },
      select: actionSelect,
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: qualityLimits.actionsPerNc,
    }),
    ctx.db.qualityVerification.findMany({
      where: { ncId: row.id },
      select: { id: true, effective: true, note: true, verifiedById: true, verifiedAt: true },
      orderBy: { verifiedAt: "asc" },
    }),
    row.recordId === null
      ? Promise.resolve(null)
      : ctx.db.formRecord.findFirst({
          where: { id: row.recordId },
          select: {
            id: true,
            submittedAt: true,
            node: { select: { id: true, name: true, spaceId: true } },
          },
        }),
    row.folderId === null
      ? Promise.resolve(null)
      : ctx.db.node.findFirst({
          where: { id: row.folderId, type: "FOLDER", trashedAt: null },
          select: { id: true, spaceId: true },
        }),
  ]);
  const people = await names(ctx.db, [
    row.reportedById,
    row.closedById,
    ...verifications.map((v) => v.verifiedById),
  ]);
  const locale = currentLocale();
  return {
    ...summary,
    description: row.description,
    location: row.location,
    record:
      record === null
        ? null
        : {
            id: record.id,
            formId: record.node.id,
            spaceId: record.node.spaceId,
            label: `${record.node.name} · ${record.submittedAt.toLocaleDateString(locale)}`,
          },
    fieldIds: row.fieldIds,
    productAffected: row.productAffected,
    productNote: row.productNote,
    correction: row.correction,
    causeMethod: row.causeMethod,
    causeAnalysis: row.causeAnalysis,
    rootCause: row.rootCause,
    verifyOn: row.verifyOn === null ? null : dayOf(row.verifyOn),
    cancelReason: row.cancelReason,
    folder,
    reportedBy: person(people, row.reportedById),
    closedAt: row.closedAt,
    closedBy: row.closedById === null ? null : person(people, row.closedById),
    actionItems: await actionViews(ctx, actions),
    verifications: verifications.map((v) => ({
      id: v.id,
      effective: v.effective,
      note: v.note,
      by: person(people, v.verifiedById),
      at: v.verifiedAt,
    })),
    holds: await holdsOfNc(ctx, row.id),
    maintenance: await workOrdersOfNc(ctx.db, row.id),
    maintenanceEnabled: await maintenanceEnabled(ctx.db),
    audit: await auditOfNc(ctx, row.id),
    supplier: await supplierOfNc(ctx, row.supplierId),
    access,
  };
}

export async function getNc(ctx: AdminContext, id: string): Promise<NcDetail> {
  const { row, access } = await loadNc(ctx, id);
  return await detailOf(ctx, row, access);
}

// ─── Creating ────────────────────────────────────────────────────────────────────────────

export interface NewNc {
  title: string;
  description: string;
  origin: CreateNcInput["origin"];
  severity: CreateNcInput["severity"];
  detectedOn: string;
  location?: string | null | undefined;
  departmentId?: string | null;
  ownerId: string;
  recordId?: string;
  fieldIds?: string[];
  productAffected?: boolean;
  productNote?: string | null | undefined;
  correction?: string | null | undefined;
  reportedById: string;
  supplierId?: string | null;
}

/** Saves a new NC with its consecutive number of the company's year, and its first event. */
export async function insertNc(
  ctx: Pick<AdminContext, "db" | "info">,
  input: NewNc,
): Promise<string> {
  const year = Number((await today(ctx.db)).slice(0, 4));
  return await ctx.db.$transaction(async (tx) => {
    const counter = await tx.qualityNcCounter.upsert({
      where: { workspaceId_year: { workspaceId: tx.workspaceId, year } },
      create: { year, last: 1 },
      update: { last: { increment: 1 } },
      select: { last: true },
    });
    const created = await tx.qualityNc.create({
      data: {
        year,
        number: counter.last,
        title: input.title,
        description: input.description,
        origin: input.origin,
        severity: input.severity,
        detectedOn: dateOf(input.detectedOn),
        location: input.location ?? null,
        departmentId: input.departmentId ?? null,
        recordId: input.recordId ?? null,
        fieldIds: input.fieldIds ?? [],
        productAffected: input.productAffected ?? false,
        productNote: input.productNote ?? null,
        correction: input.correction ?? null,
        ownerId: input.ownerId,
        reportedById: input.reportedById,
        supplierId: input.supplierId ?? null,
      },
      select: { id: true },
    });
    await addEvent(tx, created.id, "created", input.reportedById, {
      origin: input.origin,
      severity: input.severity,
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "quality.nc.create",
        entityType: "QualityNc",
        entityId: created.id,
        metadata: {
          code: qualityTexts.code(year, counter.last),
          origin: input.origin,
          severity: input.severity,
          ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
        },
      },
    );
    return created.id;
  });
}

/** A nonconformity created by quality.manage, with everything. */
export async function createNc(ctx: AdminContext, input: CreateNcInput): Promise<NcDetail> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await assertMember(ctx.db, input.ownerId);
  await assertDepartment(ctx.db, input.departmentId);
  if (input.supplierId !== null) {
    if (input.origin !== "SUPPLIER") {
      throw new AppError("BAD_REQUEST", {
        message: qualityTexts.supplierMessages.supplierNeedsOrigin,
      });
    }
    await assertSupplier(ctx, input.supplierId);
  }
  const id = await insertNc(ctx, { ...input, reportedById: ctx.tenant.membershipId });
  await notifyNc(ctx.db, id, [input.ownerId], ctx.tenant.membershipId);
  return await getNc(ctx, id);
}

/**
 * Anyone reports one: internal, major by default, and it's the company owner's (or the first
 * quality.manage's) until it's assigned; everyone with quality.manage is told.
 */
export async function reportNc(ctx: AdminContext, input: ReportNcInput): Promise<NcDetail> {
  await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST") throw forbidden();
  const holders = await managers(ctx.db);
  const ownerId = canManageQuality(ctx)
    ? ctx.tenant.membershipId
    : (holders[0] ?? ctx.tenant.membershipId);
  const id = await insertNc(ctx, {
    ...input,
    origin: "INTERNAL",
    severity: "MAJOR",
    ownerId,
    reportedById: ctx.tenant.membershipId,
  });
  await notifyNc(ctx.db, id, holders, ctx.tenant.membershipId);
  return await getNc(ctx, id);
}

/** The labels of a record's non-conforming fields. */
async function fieldLabels(
  db: TenantDb,
  record: { nodeId: string; version: number; nonConforming: string[] },
): Promise<string[]> {
  const row = await db.formVersion.findFirst({
    where: { nodeId: record.nodeId, version: record.version },
    select: { fields: true },
  });
  const parsed = FieldsSchema.safeParse(row?.fields);
  if (!parsed.success) return record.nonConforming;
  const labelOf = new Map(parsed.data.map((field) => [field.id, field.label]));
  return record.nonConforming.map((id) => labelOf.get(id) ?? id);
}

/** The open NC of a record, if it has one. */
async function openNcOfRecord(db: TenantDb, recordId: string): Promise<string | null> {
  const found = await db.qualityNc.findFirst({
    where: { recordId, status: { notIn: [...FINAL] } },
    select: { id: true },
  });
  return found?.id ?? null;
}

/**
 * Opens the NC of a non-conforming record (origin CCP), as its form's quality settings say. Returns the
 * NC already open for that record, if there is one.
 */
async function ncFromRecord(
  ctx: Pick<AdminContext, "db" | "info">,
  recordId: string,
  actorId: string,
): Promise<{ id: string; created: boolean; ownerId: string }> {
  const record = await ctx.db.formRecord.findFirst({
    where: { id: recordId, voidedAt: null },
    select: {
      id: true,
      nodeId: true,
      version: true,
      nonConforming: true,
      submittedAt: true,
      submittedById: true,
      node: { select: { name: true } },
    },
  });
  if (record === null) throw notFound();
  if (record.nonConforming.length === 0) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.messages.recordConforming });
  }
  const existing = await openNcOfRecord(ctx.db, recordId);
  if (existing !== null) {
    const owner = await ctx.db.qualityNc.findFirst({
      where: { id: existing },
      select: { ownerId: true },
    });
    return { id: existing, created: false, ownerId: owner?.ownerId ?? actorId };
  }
  const settings = await ctx.db.formSettings.findFirst({
    where: { nodeId: record.nodeId },
    select: { qualitySeverity: true, qualityOwnerId: true },
  });
  let ownerId = settings?.qualityOwnerId ?? null;
  if (ownerId !== null) {
    const active = await ctx.db.membership.count({ where: { id: ownerId, status: "ACTIVE" } });
    if (active === 0) ownerId = null;
  }
  ownerId ??=
    (await responsiblesOf(ctx.db, record.nodeId))[0] ?? (await managers(ctx.db))[0] ?? actorId;
  const labels = await fieldLabels(ctx.db, record);
  const companySettings = (
    await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } })
  )?.settings;
  const zone = zoneOf(companySettings);
  // Written by the system: in the company's language, whoever sent the record.
  const written = withLocale(readWorkspaceLocale(companySettings), () => ({
    title: qualityTexts.fromRecord(record.node.name),
    description: qualityTexts.fromRecordDescription(labels.join(", ")),
  }));
  const id = await insertNc(ctx, {
    title: cleanName(written.title).slice(0, qualityLimits.titleMax),
    description: written.description,
    origin: "CCP",
    severity: settings?.qualitySeverity ?? "MAJOR",
    detectedOn: dayIn(record.submittedAt, zone),
    ownerId,
    recordId: record.id,
    fieldIds: record.nonConforming,
    reportedById: actorId,
  });
  return { id, created: true, ownerId };
}

/** «Abrir no conformidad» on a record: quality.manage or whoever is in charge of the form. */
export async function createNcFromRecord(ctx: AdminContext, recordId: string): Promise<NcDetail> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) {
    const record = await ctx.db.formRecord.findFirst({
      where: { id: recordId },
      select: { nodeId: true },
    });
    if (record === null) throw notFound();
    const responsibles = await responsiblesOf(ctx.db, record.nodeId);
    if (!responsibles.includes(ctx.tenant.membershipId)) throw notFound();
  }
  const opened = await ncFromRecord(ctx, recordId, ctx.tenant.membershipId);
  if (opened.created) await notifyNc(ctx.db, opened.id, [opened.ownerId], ctx.tenant.membershipId);
  // Its responsible may not see every NC: they see this one as whoever reported it.
  return await getNc(ctx, opened.id);
}

/**
 * After a record is saved: opens its NC by itself when its form asks for it and the module is on.
 * Never fails the record: a problem here is left for the person to open it by hand.
 */
export async function autoNcFromRecord(
  ctx: AdminContext,
  record: { id: string; nodeId: string; nonConforming: readonly string[] },
): Promise<void> {
  if (record.nonConforming.length === 0) return;
  if (!(await qualitySettingsOf(ctx.db)).enabled) return;
  const settings = await ctx.db.formSettings.findFirst({
    where: { nodeId: record.nodeId },
    select: { qualityAutoNc: true },
  });
  if (settings?.qualityAutoNc !== true) return;
  const opened = await ncFromRecord(ctx, record.id, ctx.tenant.membershipId);
  if (opened.created) await notifyNc(ctx.db, opened.id, [opened.ownerId], ctx.tenant.membershipId);
  // The record names a piece of equipment (the cold room, the dryer): maintenance gets its urgent work
  // order, linked to the NC (docs/spec/mantenimiento.md, section 8).
  if (opened.created) {
    const assetId = await assetNamedByRecord(ctx.db, record.id);
    if (assetId !== null) await linkMaintenance(ctx, opened.id, assetId);
  }
}

/** Opens (or links) the NC's work order and notes it in the NC's history. */
async function linkMaintenance(
  ctx: AdminContext,
  ncId: string,
  assetId: string | null,
): Promise<{ id: string; code: string; created: boolean } | null> {
  const nc = await ctx.db.qualityNc.findFirst({
    where: { id: ncId },
    select: { id: true, year: true, number: true, title: true, description: true },
  });
  if (nc === null) return null;
  const order = await workOrderForNc(
    ctx,
    { id: nc.id, code: codeOf(nc), title: nc.title, description: nc.description },
    assetId,
  );
  if (order !== null) {
    await addEvent(ctx.db, nc.id, "maintenance", ctx.tenant.membershipId, {
      code: order.code,
      status: order.created ? "REPORTED" : "linked",
    });
  }
  return order;
}

/** «Ask maintenance» from the NC: whoever can handle it, with the equipment (or without one). */
export async function askMaintenance(
  ctx: AdminContext,
  ncId: string,
  assetId: string | null,
): Promise<NcDetail> {
  const row = await loadEditable(ctx, ncId);
  if (!(await maintenanceEnabled(ctx.db))) throw notFound();
  const order = await linkMaintenance(ctx, row.id, assetId);
  if (order === null) throw notFound();
  await auditAdmin(ctx, {
    action: "quality.nc.maintenance",
    entityType: "QualityNc",
    entityId: row.id,
    metadata: { workOrder: order.code, created: order.created },
  });
  return await getNc(ctx, row.id);
}

/** The NC open for a record (its form screen links to it), if the person sees it. */
export async function ncOfRecord(
  ctx: AdminContext,
  recordId: string,
): Promise<{ id: string; code: string } | null> {
  if (!(await qualitySettingsOf(ctx.db)).enabled) return null;
  const visible = await visibleWhere(ctx);
  const row = await ctx.db.qualityNc.findFirst({
    where: {
      AND: [{ recordId, status: { notIn: [...FINAL] } }, ...(visible === null ? [] : [visible])],
    },
    select: { id: true, year: true, number: true },
  });
  return row === null ? null : { id: row.id, code: codeOf(row) };
}

// ─── Changing ────────────────────────────────────────────────────────────────────────────

/** Sets the verification's expiry to the NC's owner on its day. */
async function setVerificationExpiry(db: TenantDb, ncId: string, day: string, ownerId: string) {
  await setExpiry(db, {
    kind: VERIFICATION_EXPIRY,
    subjectId: ncId,
    dueOn: day,
    responsibleId: ownerId,
    noticeDays: [...VERIFY_NOTICE_DAYS],
  });
}

/**
 * After its actions change: every action done → VERIFICATION (with the proposed day); some open →
 * ACTIONS (leaving a pending verification).
 */
async function settleStatus(db: TenantDb, ncId: string, actorId: string): Promise<void> {
  const nc = await db.qualityNc.findFirst({
    where: { id: ncId },
    select: { status: true, ownerId: true },
  });
  if (nc === null || FINAL.includes(nc.status)) return;
  const [total, open] = await Promise.all([
    db.qualityAction.count({ where: { ncId } }),
    db.qualityAction.count({ where: { ncId, doneAt: null } }),
  ]);
  if (total > 0 && open === 0 && nc.status !== "VERIFICATION") {
    const settings = await qualitySettingsOf(db);
    const day = addDays(await today(db), settings.verifyDays);
    await db.qualityNc.update({
      where: { id: ncId },
      data: { status: "VERIFICATION", verifyOn: dateOf(day) },
      select: { id: true },
    });
    await setVerificationExpiry(db, ncId, day, nc.ownerId);
    await addEvent(db, ncId, "status", actorId, {
      from: nc.status,
      to: "VERIFICATION",
      verifyOn: day,
    });
  } else if (open > 0 && nc.status !== "ACTIONS") {
    await db.qualityNc.update({
      where: { id: ncId },
      data: { status: "ACTIONS", verifyOn: null },
      select: { id: true },
    });
    await resolveExpiry(db, VERIFICATION_EXPIRY, ncId);
    await addEvent(db, ncId, "status", actorId, { from: nc.status, to: "ACTIONS" });
  }
}

/** The NC's data and its root cause analysis (quality.manage or its owner). */
export async function updateNc(
  ctx: AdminContext,
  id: string,
  input: UpdateNcInput,
): Promise<NcDetail> {
  const current = await loadEditable(ctx, id);
  if (input.ownerId !== undefined) {
    // Reassigning is quality.manage's.
    if (!canManageQuality(ctx)) throw forbidden();
    await assertMember(ctx.db, input.ownerId);
  }
  if (input.departmentId !== undefined) await assertDepartment(ctx.db, input.departmentId);
  const method = input.causeMethod === undefined ? current.causeMethod : input.causeMethod;
  let analysis: Prisma.InputJsonValue | undefined;
  if (input.causeAnalysis !== undefined) {
    if (method === null) {
      throw new AppError("BAD_REQUEST", { message: qualityTexts.messages.analysisInvalid });
    }
    const parsed = analysisOf[method].safeParse(input.causeAnalysis);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", { message: qualityTexts.messages.analysisInvalid });
    }
    analysis = parsed.data;
  }
  const { detectedOn } = input;
  // Only the plain fields that came in (exact optional types: no undefined values for Prisma).
  const plain = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && key !== "causeAnalysis" && key !== "detectedOn",
    ),
  ) as Prisma.QualityNcUncheckedUpdateInput;
  const analysed = (input.rootCause ?? current.rootCause ?? "") !== "" || analysis !== undefined;
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityNc.update({
      where: { id },
      data: {
        ...plain,
        ...(detectedOn === undefined ? {} : { detectedOn: dateOf(detectedOn) }),
        ...(analysis === undefined ? {} : { causeAnalysis: analysis }),
        ...(current.status === "OPEN" && analysed ? { status: "ANALYSIS" } : {}),
      },
      select: { id: true },
    });
    await addEvent(tx, id, "updated", ctx.tenant.membershipId, {
      fields: Object.keys(input),
    });
    if (current.status === "OPEN" && analysed) {
      await addEvent(tx, id, "status", ctx.tenant.membershipId, { from: "OPEN", to: "ANALYSIS" });
    }
    // The owner changes: their pending check goes with them.
    if (
      input.ownerId !== undefined &&
      current.status === "VERIFICATION" &&
      current.verifyOn !== null
    ) {
      await setVerificationExpiry(tx, id, dayOf(current.verifyOn), input.ownerId);
    }
  });
  await auditAdmin(ctx, {
    action: "quality.nc.update",
    entityType: "QualityNc",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await notifyNc(ctx.db, id, [input.ownerId], ctx.tenant.membershipId);
  }
  return await getNc(ctx, id);
}

export async function cancelNc(ctx: AdminContext, id: string, reason: string): Promise<NcDetail> {
  const current = await loadEditable(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  const open = await ctx.db.qualityAction.findMany({
    where: { ncId: id, doneAt: null },
    select: { id: true },
  });
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityNc.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelReason: reason,
        closedAt: new Date(),
        closedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    for (const action of open) await resolveExpiry(tx, ACTION_EXPIRY, action.id);
    await resolveExpiry(tx, VERIFICATION_EXPIRY, id);
    await addEvent(tx, id, "cancelled", ctx.tenant.membershipId, { from: current.status, reason });
  });
  await auditAdmin(ctx, {
    action: "quality.nc.cancel",
    entityType: "QualityNc",
    entityId: id,
    metadata: { reason },
  });
  await notifyNc(ctx.db, id, [current.reportedById, current.ownerId], ctx.tenant.membershipId);
  return await getNc(ctx, id);
}

/** A closed NC back to ACTIONS, to add new ones (quality.manage). */
export async function reopenNc(ctx: AdminContext, id: string, reason: string): Promise<NcDetail> {
  const { row } = await loadNc(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (row.status !== "CLOSED") {
    throw new AppError("CONFLICT", { message: qualityTexts.messages.notClosed });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityNc.update({
      where: { id },
      data: { status: "ACTIONS", closedAt: null, closedById: null, verifyOn: null },
      select: { id: true },
    });
    await addEvent(tx, id, "reopened", ctx.tenant.membershipId, { reason });
  });
  await auditAdmin(ctx, {
    action: "quality.nc.reopen",
    entityType: "QualityNc",
    entityId: id,
    metadata: { reason },
  });
  await notifyNc(ctx.db, id, [row.ownerId], ctx.tenant.membershipId);
  return await getNc(ctx, id);
}

/** The NC's history, oldest first (up to 500 steps). */
export async function ncEvents(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; kind: string; actor: Person | null; data: unknown; at: Date }[]> {
  await loadNc(ctx, id);
  const rows = await ctx.db.qualityNcEvent.findMany({
    where: { ncId: id },
    select: { id: true, kind: true, actorId: true, data: true, at: true },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    take: 500,
  });
  const people = await names(
    ctx.db,
    rows.map((row) => row.actorId),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    actor: row.actorId === null ? null : person(people, row.actorId),
    data: row.data,
    at: row.at,
  }));
}

// ─── Actions ─────────────────────────────────────────────────────────────────────────────

export async function addAction(
  ctx: AdminContext,
  ncId: string,
  input: ActionInput,
): Promise<NcDetail> {
  await loadEditable(ctx, ncId);
  await assertMember(ctx.db, input.responsibleId);
  const count = await ctx.db.qualityAction.count({ where: { ncId } });
  if (count >= qualityLimits.actionsPerNc) {
    throw new AppError("BAD_REQUEST", {
      message: qualityTexts.messages.tooManyActions(qualityLimits.actionsPerNc),
    });
  }
  const actionId = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qualityAction.create({
      data: {
        ncId,
        kind: input.kind,
        description: input.description,
        responsibleId: input.responsibleId,
        dueOn: dateOf(input.dueOn),
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    await setExpiry(tx, {
      kind: ACTION_EXPIRY,
      subjectId: created.id,
      dueOn: input.dueOn,
      responsibleId: input.responsibleId,
      noticeDays: [...NOTICE_DAYS],
    });
    await addEvent(tx, ncId, "action_added", ctx.tenant.membershipId, {
      actionId: created.id,
      kind: input.kind,
      responsibleId: input.responsibleId,
      dueOn: input.dueOn,
    });
    await settleStatus(tx, ncId, ctx.tenant.membershipId);
    return created.id;
  });
  await auditAdmin(ctx, {
    action: "quality.action.create",
    entityType: "QualityNc",
    entityId: ncId,
    metadata: {
      actionId,
      kind: input.kind,
      responsibleId: input.responsibleId,
      dueOn: input.dueOn,
    },
  });
  return await getNc(ctx, ncId);
}

async function loadAction(ctx: AdminContext, id: string): Promise<ActionRow> {
  await requireQuality(ctx);
  const row = await ctx.db.qualityAction.findFirst({ where: { id }, select: actionSelect });
  if (row === null) throw notFound();
  // Seeing the action means seeing its NC.
  await loadNc(ctx, row.ncId);
  return row;
}

export async function updateQualityAction(
  ctx: AdminContext,
  id: string,
  input: UpdateActionInput,
): Promise<NcDetail> {
  const current = await loadAction(ctx, id);
  const [view] = await actionViews(ctx, [current]);
  if (view?.canEdit !== true) {
    if (current.doneAt !== null) {
      throw new AppError("CONFLICT", { message: qualityTexts.messages.actionDone });
    }
    throw forbidden();
  }
  if (input.responsibleId !== undefined) await assertMember(ctx.db, input.responsibleId);
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityAction.update({
      where: { id },
      data: {
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.responsibleId === undefined ? {} : { responsibleId: input.responsibleId }),
        ...(input.dueOn === undefined ? {} : { dueOn: dateOf(input.dueOn) }),
      },
      select: { dueOn: true, responsibleId: true },
    });
    await setExpiry(tx, {
      kind: ACTION_EXPIRY,
      subjectId: id,
      dueOn: dayOf(updated.dueOn),
      responsibleId: updated.responsibleId,
      noticeDays: [...NOTICE_DAYS],
    });
    await addEvent(tx, current.ncId, "action_updated", ctx.tenant.membershipId, {
      actionId: id,
      fields: Object.keys(input),
    });
  });
  await auditAdmin(ctx, {
    action: "quality.action.update",
    entityType: "QualityNc",
    entityId: current.ncId,
    metadata: { actionId: id, fields: Object.keys(input) },
  });
  return await getNc(ctx, current.ncId);
}

/** Done: by its responsible, the NC's owner or quality.manage. */
export async function completeQualityAction(
  ctx: AdminContext,
  id: string,
  note: string | null,
): Promise<QualityActionView> {
  const current = await loadAction(ctx, id);
  const [view] = await actionViews(ctx, [current]);
  if (view?.canComplete !== true) {
    if (current.doneAt !== null) {
      throw new AppError("CONFLICT", { message: qualityTexts.messages.actionDone });
    }
    throw forbidden();
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityAction.update({
      where: { id },
      data: { doneAt: new Date(), doneById: ctx.tenant.membershipId, note },
      select: { id: true },
    });
    await resolveExpiry(tx, ACTION_EXPIRY, id);
    await addEvent(tx, current.ncId, "action_done", ctx.tenant.membershipId, { actionId: id });
    await settleStatus(tx, current.ncId, ctx.tenant.membershipId);
  });
  await auditAdmin(ctx, {
    action: "quality.action.done",
    entityType: "QualityNc",
    entityId: current.ncId,
    metadata: { actionId: id },
  });
  const row = await ctx.db.qualityAction.findFirst({ where: { id }, select: actionSelect });
  if (row === null) throw notFound();
  const [done] = await actionViews(ctx, [row]);
  if (done === undefined) throw notFound();
  return done;
}

function actionsWhere(
  ctx: AdminContext,
  query: ListActionsQuery,
  day: string,
  visible: Prisma.QualityNcWhereInput | null,
): Prisma.QualityActionWhereInput {
  const status: Prisma.QualityActionWhereInput =
    query.status === "open"
      ? { doneAt: null, nc: { status: { notIn: [...FINAL] } } }
      : query.status === "overdue"
        ? { doneAt: null, dueOn: { lt: dateOf(day) }, nc: { status: { notIn: [...FINAL] } } }
        : query.status === "done"
          ? { doneAt: { not: null } }
          : {};
  return {
    AND: [
      status,
      ...(query.kind === undefined ? [] : [{ kind: query.kind }]),
      ...(query.responsible === undefined ? [] : [{ responsibleId: query.responsible }]),
      ...(query.mine === undefined ? [] : [{ responsibleId: ctx.tenant.membershipId }]),
      // Beyond quality.view: their own actions and those of the NCs they see.
      ...(visible === null
        ? []
        : [{ OR: [{ responsibleId: ctx.tenant.membershipId }, { nc: visible }] }]),
    ],
  };
}

export async function listQualityActions(
  ctx: AdminContext,
  query: ListActionsQuery,
): Promise<Page<QualityActionView>> {
  await requireQuality(ctx);
  const where = actionsWhere(ctx, query, await today(ctx.db), await visibleWhere(ctx));
  const [rows, total] = await Promise.all([
    ctx.db.qualityAction.findMany({
      where,
      select: actionSelect,
      orderBy: stableOrder({ dueOn: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.qualityAction.count({ where }),
  ]);
  return pageOf(await actionViews(ctx, rows), total, query);
}

// ─── Verification ────────────────────────────────────────────────────────────────────────

export async function setVerifyOn(ctx: AdminContext, id: string, date: string): Promise<NcDetail> {
  const current = await loadEditable(ctx, id);
  if (current.status !== "VERIFICATION") {
    throw new AppError("CONFLICT", { message: qualityTexts.messages.notInVerification });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityNc.update({
      where: { id },
      data: { verifyOn: dateOf(date) },
      select: { id: true },
    });
    await setVerificationExpiry(tx, id, date, current.ownerId);
    await addEvent(tx, id, "verify_on", ctx.tenant.membershipId, { date });
  });
  return await getNc(ctx, id);
}

/** Records the effectiveness check (quality.manage): effective closes; not effective, back to ACTIONS. */
export async function verifyNc(
  ctx: AdminContext,
  id: string,
  input: { effective: boolean; note: string },
): Promise<NcDetail> {
  const current = await loadEditable(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.status !== "VERIFICATION") {
    const actions = await ctx.db.qualityAction.count({ where: { ncId: id } });
    throw new AppError("CONFLICT", {
      message:
        actions === 0 ? qualityTexts.messages.noActions : qualityTexts.messages.actionsPending,
    });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityVerification.create({
      data: {
        ncId: id,
        effective: input.effective,
        note: input.note,
        verifiedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    await tx.qualityNc.update({
      where: { id },
      data: input.effective
        ? { status: "CLOSED", closedAt: new Date(), closedById: ctx.tenant.membershipId }
        : { status: "ACTIONS", verifyOn: null },
      select: { id: true },
    });
    await resolveExpiry(tx, VERIFICATION_EXPIRY, id);
    await addEvent(tx, id, "verified", ctx.tenant.membershipId, {
      effective: input.effective,
      to: input.effective ? "CLOSED" : "ACTIONS",
    });
  });
  await auditAdmin(ctx, {
    action: input.effective ? "quality.nc.close" : "quality.nc.not_effective",
    entityType: "QualityNc",
    entityId: id,
  });
  await notifyNc(
    ctx.db,
    id,
    input.effective ? [current.reportedById, current.ownerId] : [current.ownerId],
    ctx.tenant.membershipId,
  );
  return await getNc(ctx, id);
}

// ─── Lists ───────────────────────────────────────────────────────────────────────────────

function ncsWhere(
  ctx: AdminContext,
  filters: NcFilters,
  visible: Prisma.QualityNcWhereInput | null,
): Prisma.QualityNcWhereInput {
  const q = filters.q?.trim() ?? "";
  const code = /^nc-?(\d{4})-?(\d{1,6})$/iu.exec(q);
  return {
    AND: [
      filters.status === "open"
        ? { status: { notIn: [...FINAL] } }
        : filters.status === "all"
          ? {}
          : { status: filters.status },
      ...(filters.origin === undefined ? [] : [{ origin: filters.origin }]),
      ...(filters.severity === undefined ? [] : [{ severity: filters.severity }]),
      ...(filters.owner === undefined ? [] : [{ ownerId: filters.owner }]),
      ...(filters.department === undefined ? [] : [{ departmentId: filters.department }]),
      ...(filters.from === undefined ? [] : [{ detectedOn: { gte: dateOf(filters.from) } }]),
      ...(filters.to === undefined ? [] : [{ detectedOn: { lte: dateOf(filters.to) } }]),
      ...(filters.mine === "reported" ? [{ reportedById: ctx.tenant.membershipId }] : []),
      ...(q === ""
        ? []
        : code !== null
          ? [{ year: Number(code[1]), number: Number(code[2]) }]
          : [{ title: { contains: q, mode: "insensitive" as const } }]),
      ...(visible === null ? [] : [visible]),
    ],
  };
}

export async function listNcs(ctx: AdminContext, query: ListNcsQuery): Promise<Page<NcSummary>> {
  await requireQuality(ctx);
  const where = ncsWhere(ctx, query, await visibleWhere(ctx));
  const orderBy =
    query.sort === "severity"
      ? stableOrder([
          { severity: query.dir === "asc" ? "desc" : "asc" },
          { createdAt: "desc" },
        ] as const)
      : stableOrder({ [query.sort]: query.dir } as Record<
          "detectedOn" | "createdAt",
          "asc" | "desc"
        >);
  const [rows, total] = await Promise.all([
    ctx.db.qualityNc.findMany({ where, select: ncSelect, orderBy, ...offsetArgs(query) }),
    ctx.db.qualityNc.count({ where }),
  ]);
  return pageOf(await summaries(ctx, rows), total, query);
}

/** The area's summary: open NCs by severity, overdue actions, today's checks and the latest NCs. */
export async function qualitySummary(ctx: AdminContext): Promise<{
  open: Record<"MINOR" | "MAJOR" | "CRITICAL", number>;
  overdueActions: number;
  verificationsDue: number;
  latest: NcSummary[];
}> {
  await requireQuality(ctx);
  const visible = await visibleWhere(ctx);
  const day = await today(ctx.db);
  const scope = (where: Prisma.QualityNcWhereInput): Prisma.QualityNcWhereInput =>
    visible === null ? where : { AND: [where, visible] };
  const [bySeverity, overdueActions, verificationsDue, latest] = await Promise.all([
    ctx.db.qualityNc.groupBy({
      by: ["severity"],
      where: scope({ status: { notIn: [...FINAL] } }),
      _count: { _all: true },
    }),
    ctx.db.qualityAction.count({
      where: {
        doneAt: null,
        dueOn: { lt: dateOf(day) },
        nc: scope({ status: { notIn: [...FINAL] } }),
      },
    }),
    ctx.db.qualityNc.count({
      where: scope({ status: "VERIFICATION", verifyOn: { lte: dateOf(day) } }),
    }),
    ctx.db.qualityNc.findMany({
      where: scope({ status: { notIn: [...FINAL] } }),
      select: ncSelect,
      orderBy: stableOrder({ createdAt: "desc" as const }),
      take: 5,
    }),
  ]);
  const open = { MINOR: 0, MAJOR: 0, CRITICAL: 0 };
  for (const row of bySeverity) open[row.severity] = row._count._all;
  const sorted = [...latest].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { open, overdueActions, verificationsDue, latest: await summaries(ctx, sorted) };
}

export async function exportNcsCsv(
  ctx: AdminContext,
  filters: NcFilters,
): Promise<{ fileName: string; body: string }> {
  await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
  const t = qualityTexts;
  const where = ncsWhere(ctx, filters, null);
  const total = await ctx.db.qualityNc.count({ where });
  if (total > qualityLimits.csvMax) {
    throw new AppError("BAD_REQUEST", {
      message: t.messages.tooMany(qualityLimits.csvMax.toLocaleString(currentLocale())),
    });
  }
  const rows = await ctx.db.qualityNc.findMany({
    where,
    select: ncSelect,
    orderBy: stableOrder({ createdAt: "asc" as const }),
    take: qualityLimits.csvMax,
  });
  const list = await summaries(ctx, rows);
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  const c = t.csv;
  const body = toCsv([
    [
      c.code,
      c.title,
      c.origin,
      c.severity,
      c.status,
      c.detectedOn,
      c.owner,
      c.department,
      c.actions,
      c.actionsOpen,
      c.rootCause,
      c.closedOn,
    ],
    ...list.map((nc) => {
      const row = rowOf.get(nc.id);
      return [
        nc.code,
        nc.title,
        t.origins[nc.origin as keyof typeof t.origins],
        t.severities[nc.severity],
        t.statuses[nc.status],
        nc.detectedOn,
        nc.owner.name,
        nc.department?.name ?? "",
        String(nc.actions.total),
        String(nc.actions.open),
        row?.rootCause ?? "",
        row?.closedAt === null || row?.closedAt === undefined
          ? ""
          : row.closedAt.toISOString().slice(0, 10),
      ];
    }),
  ]);
  await auditAdmin(ctx, {
    action: "quality.ncs.export",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { rows: list.length, ...filters },
  });
  return { fileName: c.fileName, body };
}

// ─── Evidence folder ─────────────────────────────────────────────────────────────────────

/** A valid node name: no slashes nor control characters, up to 120 characters. */
function folderName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = cleanName(name.replace(/[/\\]/gu, "-").replace(/[\x00-\x1f\x7f]/gu, ""));
  const short = clean.slice(0, 120);
  return short === "" || short === "." || short === ".." ? "-" : short;
}

async function createFolder(
  ctx: AdminContext,
  spaceId: string,
  parentId: string | null,
  wanted: string,
): Promise<string> {
  let name = folderName(wanted);
  for (let n = 2; n < 1000; n += 1) {
    const taken = await ctx.db.node.count({
      where: { spaceId, parentId, nameKey: nameKeyOf(name), trashedAt: null },
    });
    if (taken === 0) break;
    name = `${folderName(wanted)} (${String(n)})`;
  }
  const created = await ctx.db.node.create({
    data: {
      spaceId,
      parentId,
      type: "FOLDER",
      name,
      nameKey: nameKeyOf(name),
      position: await lastPosition(ctx, spaceId, parentId),
      createdById: ctx.tenant.membershipId,
      updatedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "folder.create",
    entityType: "Node",
    entityId: created.id,
    metadata: { spaceId, parentId, name },
  });
  return created.id;
}

/**
 * The NC's evidence folder, «No conformidades/NC-2026-0001 · title» in the module's space, created by the
 * system (like CAE's) the first time; recreated if it's gone. Whoever sees its files is decided by the
 * folder's access, like any other file.
 */
export async function ncFolder(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; spaceId: string }> {
  const nc = await loadEditable(ctx, id);
  const settings = await requireQuality(ctx);
  if (settings.spaceId === undefined) throw notFound();
  const space = await ctx.db.space.findFirst({
    where: { id: settings.spaceId },
    select: { id: true },
  });
  if (space === null) throw notFound();
  if (nc.folderId !== null) {
    const live = await ctx.db.node.findFirst({
      where: { id: nc.folderId, type: "FOLDER", trashedAt: null },
      select: { id: true, spaceId: true },
    });
    if (live !== null) return live;
  }
  const rootName = qualityTexts.ncFolder;
  const root =
    (
      await ctx.db.node.findFirst({
        where: {
          spaceId: space.id,
          parentId: null,
          type: "FOLDER",
          nameKey: nameKeyOf(rootName),
          trashedAt: null,
        },
        select: { id: true },
      })
    )?.id ?? (await createFolder(ctx, space.id, null, rootName));
  const folderId = await createFolder(ctx, space.id, root, `${codeOf(nc)} · ${nc.title}`);
  await ctx.db.qualityNc.update({ where: { id }, data: { folderId }, select: { id: true } });
  return { id: folderId, spaceId: space.id };
}
