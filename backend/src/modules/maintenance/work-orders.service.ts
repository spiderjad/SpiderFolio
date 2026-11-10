// Work orders (docs/spec/mantenimiento.md, section 2): reported by anyone but guests, planned and
// assigned by maintenance, worked on by technicians (time and parts), marked done, released for hygiene
// when the asset is in the product zone, and closed. Every change goes to the work order's timeline.
import { maintenanceLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type {
  MaintPriority,
  MaintSource,
  MaintWorkKind,
  MaintWorkStatus,
  Prisma,
} from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { maintenanceTexts, qualityTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { companyToday } from "../quality/prps.service.ts";
import {
  canManageMaintenance,
  canReleaseHygiene,
  canReport,
  canViewMaintenance,
  canWorkMaintenance,
  dateOf,
  maintenanceManagers,
  requireMaintenance,
  requireManage,
  requireWork,
} from "./maintenance-access.ts";
import { planWorkFinished } from "./plans.service.ts";
import { maintenanceEnabled, noteOnNc } from "./quality-link.ts";

export const WORK_ORDER_EXPIRY = "maintenance.work_order";

const OPEN: MaintWorkStatus[] = ["REPORTED", "PLANNED", "IN_PROGRESS", "ON_HOLD"];
const FINAL: MaintWorkStatus[] = ["CLOSED", "CANCELLED"];

export interface PersonRef {
  id: string;
  name: string;
}

export interface WorkOrderSummary {
  id: string;
  code: string;
  title: string;
  kind: MaintWorkKind;
  priority: MaintPriority;
  status: MaintWorkStatus;
  asset: { id: string; code: string; name: string } | null;
  assignedTo: PersonRef | null;
  reportedBy: PersonRef;
  reportedAt: Date;
  dueOn: string | null;
  source: MaintSource;
  lockout: boolean;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  description: string;
  holdReason: string;
  startedAt: Date | null;
  doneAt: Date | null;
  closedAt: Date | null;
  closedBy: PersonRef | null;
  downtimeMinutes: number | null;
  cause: string;
  solution: string;
  /** The asset is in the product zone: it needs the hygiene release to close. */
  needsHygiene: boolean;
  hygieneReleasedBy: PersonRef | null;
  hygieneReleasedAt: Date | null;
  labor: {
    id: string;
    person: PersonRef;
    startedAt: Date;
    endedAt: Date | null;
    minutes: number | null;
    note: string;
  }[];
  totalMinutes: number;
  parts: { id: string; partCode: string; description: string; quantity: number; unit: string }[];
  events: { id: string; action: string; detail: string; who: string | null; createdAt: Date }[];
  /** The preventive plan that generated it (section 5), and its steps. */
  plan: { id: string; name: string } | null;
  checklist: { text: string; done: boolean }[];
  /** The quality nonconformity it's for (section 8), if any. */
  nc: { id: string; code: string } | null;
  /** Voice notes (section 3): the transcript stays; the audio, 30 days. */
  recordings: {
    id: string;
    purpose: "REPORT" | "CLOSE";
    who: string;
    transcript: string;
    hasAudio: boolean;
    createdAt: Date;
  }[];
  can: {
    edit: boolean;
    work: boolean;
    close: boolean;
    releaseHygiene: boolean;
  };
}

export interface WorkOrdersQuery {
  page: number;
  pageSize: number;
  cursor?: string | undefined;
  status?: "open" | MaintWorkStatus | undefined;
  priority?: MaintPriority | undefined;
  kind?: MaintWorkKind | undefined;
  assetId?: string | undefined;
  mine?: boolean | undefined;
  q?: string | undefined;
}

export interface ReportInput {
  title: string;
  description: string;
  assetId: string | null;
  priority: MaintPriority;
  source: MaintSource;
}

export interface ReportByVoiceInput extends ReportInput {
  /** The voice note it came from (POST /maintenance/voice/report), if reported by talking. */
  recordingId: string | null;
}

export interface CreateInput extends ReportInput {
  kind: MaintWorkKind;
  assignedToId: string | null;
  dueOn: string | null;
  lockout: boolean;
}

export type UpdateInput = Omit<CreateInput, "source">;

export type WorkAction =
  | { action: "take" }
  | { action: "start" }
  | { action: "stop"; note: string }
  | { action: "hold"; reason: string }
  | { action: "resume" }
  | {
      action: "done";
      cause: string;
      solution: string;
      downtimeMinutes: number | null;
    }
  | { action: "release_hygiene" }
  | { action: "close" }
  | { action: "reopen" }
  | { action: "cancel"; reason: string }
  | { action: "labor"; minutes: number; note: string; day: string }
  | { action: "remove_labor"; laborId: string }
  | { action: "part"; partCode: string; description: string; quantity: number; unit: string }
  | { action: "remove_part"; partId: string }
  | { action: "check"; index: number; done: boolean };

const summarySelect = {
  id: true,
  year: true,
  number: true,
  title: true,
  kind: true,
  priority: true,
  status: true,
  assetId: true,
  assignedToId: true,
  reportedById: true,
  reportedAt: true,
  dueOn: true,
  source: true,
  lockout: true,
} as const;

type SummaryRow = Prisma.MaintWorkOrderGetPayload<{ select: typeof summarySelect }>;

export async function namesOf(db: TenantDb, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db.membership.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

async function assetsOf(db: TenantDb, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0)
    return new Map<string, { id: string; code: string; name: string; foodContact: boolean }>();
  const rows = await db.maintAsset.findMany({
    where: { id: { in: unique } },
    select: { id: true, code: true, name: true, foodContact: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

const person = (names: Map<string, string>, id: string | null): PersonRef | null =>
  id === null ? null : { id, name: names.get(id) ?? "" };

async function summaries(db: TenantDb, rows: SummaryRow[]): Promise<WorkOrderSummary[]> {
  const [names, assets] = await Promise.all([
    namesOf(db, [...rows.map((row) => row.assignedToId), ...rows.map((row) => row.reportedById)]),
    assetsOf(
      db,
      rows.map((row) => row.assetId),
    ),
  ]);
  return rows.map((row) => {
    const asset = row.assetId === null ? undefined : assets.get(row.assetId);
    return {
      id: row.id,
      code: maintenanceTexts.code(row.year, row.number),
      title: row.title,
      kind: row.kind,
      priority: row.priority,
      status: row.status,
      asset: asset === undefined ? null : { id: asset.id, code: asset.code, name: asset.name },
      assignedTo: person(names, row.assignedToId),
      reportedBy: person(names, row.reportedById) ?? { id: row.reportedById, name: "" },
      reportedAt: row.reportedAt,
      dueOn: row.dueOn === null ? null : dayOf(row.dueOn),
      source: row.source,
      lockout: row.lockout,
    };
  });
}

/** Whoever reports without seeing all: only their own. */
function visibleWhere(ctx: AdminContext): Prisma.MaintWorkOrderWhereInput {
  return canViewMaintenance(ctx) ? {} : { reportedById: ctx.tenant.membershipId };
}

const PRIORITY_ORDER: Record<MaintPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export async function listWorkOrders(
  ctx: AdminContext,
  query: WorkOrdersQuery,
): Promise<Page<WorkOrderSummary>> {
  await requireMaintenance(ctx);
  if (!canViewMaintenance(ctx) && !canReport(ctx)) throw forbidden();
  const q = query.q?.trim() ?? "";
  const where: Prisma.MaintWorkOrderWhereInput = {
    AND: [
      visibleWhere(ctx),
      query.status === undefined || query.status === "open"
        ? query.status === "open"
          ? { status: { in: OPEN } }
          : {}
        : { status: query.status },
      query.priority === undefined ? {} : { priority: query.priority },
      query.kind === undefined ? {} : { kind: query.kind },
      query.assetId === undefined ? {} : { assetId: query.assetId },
      query.mine === true ? { assignedToId: ctx.tenant.membershipId } : {},
      q === "" ? {} : { title: { contains: q, mode: "insensitive" as const } },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.maintWorkOrder.findMany({
      where,
      select: summarySelect,
      orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
      ...offsetArgs(query),
    }),
    ctx.db.maintWorkOrder.count({ where }),
  ]);
  const items = await summaries(ctx.db, rows);
  // Open ones: the most urgent first, then the newest.
  if (query.status === "open") {
    items.sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        b.reportedAt.getTime() - a.reportedAt.getTime(),
    );
  }
  return pageOf(items, total, query);
}

const detailSelect = {
  ...summarySelect,
  description: true,
  holdReason: true,
  startedAt: true,
  doneAt: true,
  closedAt: true,
  closedById: true,
  downtimeMinutes: true,
  cause: true,
  solution: true,
  hygieneReleasedById: true,
  hygieneReleasedAt: true,
  ncId: true,
  planId: true,
  checklist: true,
} as const;

async function rowOf(ctx: AdminContext, id: string) {
  const row = await ctx.db.maintWorkOrder.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select: detailSelect,
  });
  if (row === null) throw notFound();
  return row;
}

export async function getWorkOrder(ctx: AdminContext, id: string): Promise<WorkOrderDetail> {
  await requireMaintenance(ctx);
  const row = await rowOf(ctx, id);
  const [labor, parts, events, recordings, nc, plan] = await Promise.all([
    ctx.db.maintLabor.findMany({
      where: { workOrderId: id },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        membershipId: true,
        startedAt: true,
        endedAt: true,
        minutes: true,
        note: true,
      },
    }),
    ctx.db.maintPartUse.findMany({
      where: { workOrderId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, partCode: true, description: true, quantity: true, unit: true },
    }),
    ctx.db.maintEvent.findMany({
      where: { workOrderId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, action: true, detail: true, membershipId: true, createdAt: true },
    }),
    ctx.db.maintRecording.findMany({
      where: { workOrderId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        purpose: true,
        membershipId: true,
        transcript: true,
        storageKey: true,
        createdAt: true,
      },
    }),
    row.ncId === null
      ? Promise.resolve(null)
      : ctx.db.qualityNc.findFirst({
          where: { id: row.ncId },
          select: { id: true, year: true, number: true },
        }),
    row.planId === null
      ? Promise.resolve(null)
      : ctx.db.maintPlan.findFirst({ where: { id: row.planId }, select: { id: true, name: true } }),
  ]);
  const names = await namesOf(ctx.db, [
    ...recordings.map((entry) => entry.membershipId),
    row.closedById,
    row.hygieneReleasedById,
    ...labor.map((entry) => entry.membershipId),
    ...events.map((entry) => entry.membershipId),
  ]);
  const [summary] = await summaries(ctx.db, [row]);
  const asset =
    row.assetId === null ? undefined : (await assetsOf(ctx.db, [row.assetId])).get(row.assetId);
  const needsHygiene = asset?.foodContact === true;
  const isOpen = OPEN.includes(row.status);
  return {
    ...(summary as WorkOrderSummary),
    description: row.description,
    holdReason: row.holdReason,
    startedAt: row.startedAt,
    doneAt: row.doneAt,
    closedAt: row.closedAt,
    closedBy: person(names, row.closedById),
    downtimeMinutes: row.downtimeMinutes,
    cause: row.cause,
    solution: row.solution,
    needsHygiene,
    hygieneReleasedBy: person(names, row.hygieneReleasedById),
    hygieneReleasedAt: row.hygieneReleasedAt,
    labor: labor.map((entry) => ({
      id: entry.id,
      person: person(names, entry.membershipId) ?? { id: entry.membershipId, name: "" },
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      minutes: entry.minutes,
      note: entry.note,
    })),
    totalMinutes: labor.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0),
    parts: parts.map((part) => ({
      id: part.id,
      partCode: part.partCode,
      description: part.description,
      quantity: part.quantity.toNumber(),
      unit: part.unit,
    })),
    events: events.map((entry) => ({
      id: entry.id,
      action: entry.action,
      detail: entry.detail,
      who: entry.membershipId === null ? null : (names.get(entry.membershipId) ?? ""),
      createdAt: entry.createdAt,
    })),
    nc: nc === null ? null : { id: nc.id, code: qualityTexts.code(nc.year, nc.number) },
    plan,
    checklist: checklistOf(row.checklist),
    recordings: recordings.map((entry) => ({
      id: entry.id,
      purpose: entry.purpose,
      who: names.get(entry.membershipId) ?? "",
      transcript: entry.transcript,
      hasAudio: entry.storageKey !== null,
      createdAt: entry.createdAt,
    })),
    can: {
      edit: canManageMaintenance(ctx) && !FINAL.includes(row.status),
      work: canWorkMaintenance(ctx) && (isOpen || row.status === "DONE"),
      close: canManageMaintenance(ctx) && row.status === "DONE",
      releaseHygiene:
        needsHygiene &&
        row.status === "DONE" &&
        row.hygieneReleasedAt === null &&
        (await canReleaseHygiene(ctx)),
    },
  };
}

async function event(
  db: TenantDb,
  workOrderId: string,
  membershipId: string | null,
  action: string,
  detail = "",
): Promise<void> {
  await db.maintEvent.create({
    data: { workOrderId, membershipId, action, detail: detail.slice(0, 500) },
    select: { id: true },
  });
}

async function notify(db: TenantDb, to: string[], actorId: string, workOrderId: string) {
  for (const membershipId of new Set(to)) {
    if (membershipId === actorId) continue;
    await db.notification.create({
      data: { membershipId, kind: "maintenance_work_order", actorId, detail: workOrderId },
      select: { id: true },
    });
  }
}

/** The due date notice goes to whoever is assigned, while the work order is open. */
async function syncExpiry(
  db: TenantDb,
  row: { id: string; status: MaintWorkStatus; dueOn: Date | null; assignedToId: string | null },
): Promise<void> {
  if (!OPEN.includes(row.status) || row.dueOn === null) {
    await resolveExpiry(db, WORK_ORDER_EXPIRY, row.id);
    return;
  }
  await setExpiry(db, {
    kind: WORK_ORDER_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.dueOn),
    responsibleId: row.assignedToId ?? (await maintenanceManagers(db))[0] ?? null,
    noticeDays: [...maintenanceLimits.noticeDays],
  });
}

async function assertAsset(db: TenantDb, id: string | null): Promise<void> {
  if (id === null) return;
  const row = await db.maintAsset.findFirst({ where: { id }, select: { archivedAt: true } });
  if (row === null) throw notFound();
  if (row.archivedAt !== null) {
    throw new AppError("BAD_REQUEST", { message: maintenanceTexts.errors.archived });
  }
}

/** The assignee must be an active member who works on maintenance. */
export async function assertTechnician(db: TenantDb, id: string | null): Promise<void> {
  if (id === null) return;
  const row = await db.membership.findFirst({
    where: {
      id,
      status: "ACTIVE",
      role: {
        capabilities: { hasSome: ["maintenance.work", "maintenance.manage"] },
      },
    },
    select: { id: true },
  });
  if (row === null) throw notFound();
}

/** The steps of a work order, as stored ([{ text, done }]); anything else is dropped. */
export function checklistOf(value: unknown): { text: string; done: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step: unknown) => {
    if (typeof step !== "object" || step === null) return [];
    const { text, done } = step as { text?: unknown; done?: unknown };
    return typeof text === "string" ? [{ text, done: done === true }] : [];
  });
}

/** Creates a work order (its number, timeline, expiry, audit and notices). `actorId` reports it. */
export async function insertWorkOrder(
  ctx: Pick<AdminContext, "db" | "info">,
  actorId: string,
  input: ReportInput & {
    kind: MaintWorkKind;
    assignedToId: string | null;
    dueOn: string | null;
    lockout: boolean;
    ncId?: string | null;
    planId?: string | null;
    checklist?: string[];
  },
): Promise<string> {
  const year = Number((await companyToday(ctx.db)).slice(0, 4));
  const planned = input.assignedToId !== null && input.dueOn !== null;
  const row = await ctx.db.$transaction(async (tx) => {
    const counter = await tx.maintCounter.upsert({
      where: { workspaceId_year: { workspaceId: tx.workspaceId, year } },
      create: { year, last: 1 },
      update: { last: { increment: 1 } },
      select: { last: true },
    });
    return await tx.maintWorkOrder.create({
      data: {
        year,
        number: counter.last,
        title: input.title,
        description: input.description,
        assetId: input.assetId,
        kind: input.kind,
        priority: input.priority,
        status: planned ? "PLANNED" : "REPORTED",
        reportedById: actorId,
        assignedToId: input.assignedToId,
        dueOn: input.dueOn === null ? null : dateOf(input.dueOn),
        lockout: input.lockout,
        source: input.source,
        ncId: input.ncId ?? null,
        planId: input.planId ?? null,
        checklist: (input.checklist ?? []).map((text) => ({ text, done: false })),
      },
      select: { id: true, status: true, dueOn: true, assignedToId: true, year: true, number: true },
    });
  });
  await event(ctx.db, row.id, actorId, "reported");
  await syncExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "maintenance.work_order.create",
    entityType: "MaintWorkOrder",
    entityId: row.id,
    metadata: {
      code: maintenanceTexts.code(row.year, row.number),
      priority: input.priority,
      source: input.source,
    },
  });
  const to = [
    ...(input.assignedToId === null ? [] : [input.assignedToId]),
    ...(input.priority === "URGENT" ? await maintenanceManagers(ctx.db) : []),
  ];
  await notify(ctx.db, to, actorId, row.id);
  return row.id;
}

/** A breakdown reported by anyone with a full seat (from the app or the asset's QR). */
export async function reportWorkOrder(
  ctx: AdminContext,
  input: ReportByVoiceInput,
): Promise<WorkOrderDetail> {
  await requireMaintenance(ctx);
  if (!canReport(ctx) && !canWorkMaintenance(ctx)) throw forbidden();
  await assertAsset(ctx.db, input.assetId);
  // A voice note of this same person, not used yet (a stranger's id is a 404).
  if (input.recordingId !== null) {
    const recording = await ctx.db.maintRecording.findFirst({
      where: {
        id: input.recordingId,
        membershipId: ctx.tenant.membershipId,
        purpose: "REPORT",
        workOrderId: null,
      },
      select: { id: true },
    });
    if (recording === null) throw notFound();
  }
  const { recordingId, ...fields } = input;
  const id = await insertWorkOrder(ctx, ctx.tenant.membershipId, {
    ...fields,
    // Whoever only reports doesn't decide the source beyond the app, the QR or their voice.
    source: recordingId !== null ? "AUDIO" : input.source === "QR" ? "QR" : "APP",
    kind: "CORRECTIVE",
    assignedToId: null,
    dueOn: null,
    lockout: false,
  });
  if (recordingId !== null) {
    await ctx.db.maintRecording.updateMany({
      where: { id: recordingId, workOrderId: null },
      data: { workOrderId: id },
    });
  }
  return await getWorkOrder(ctx, id);
}

/**
 * The work order of a quality nonconformity (section 8): the one already linked, else the open one of
 * the same equipment (linked now, without duplicating), else a new urgent one. A system action (the NC
 * opens it, whoever filled in the record or handles the NC): no permission checks. Null with the module
 * off.
 */
export async function workOrderForNc(
  ctx: AdminContext,
  nc: { id: string; code: string; title: string; description: string },
  assetId: string | null,
): Promise<{ id: string; code: string; created: boolean } | null> {
  if (!(await maintenanceEnabled(ctx.db))) return null;
  const codeOf = (row: { year: number; number: number }) =>
    maintenanceTexts.code(row.year, row.number);
  const linked = await ctx.db.maintWorkOrder.findFirst({
    where: { ncId: nc.id, status: { in: OPEN } },
    select: { id: true, year: true, number: true },
  });
  if (linked !== null) return { id: linked.id, code: codeOf(linked), created: false };
  if (assetId !== null) {
    await assertAsset(ctx.db, assetId);
    const open = await ctx.db.maintWorkOrder.findFirst({
      where: { assetId, ncId: null, status: { in: OPEN } },
      orderBy: { reportedAt: "desc" },
      select: { id: true, year: true, number: true },
    });
    if (open !== null) {
      await ctx.db.maintWorkOrder.update({
        where: { id: open.id },
        data: { ncId: nc.id },
        select: { id: true },
      });
      await event(ctx.db, open.id, ctx.tenant.membershipId, "linked_nc", nc.code);
      return { id: open.id, code: codeOf(open), created: false };
    }
  }
  const id = await insertWorkOrder(ctx, ctx.tenant.membershipId, {
    title: `${nc.code} · ${nc.title}`.slice(0, maintenanceLimits.nameMax),
    description: nc.description.slice(0, maintenanceLimits.textMax),
    assetId,
    priority: "URGENT",
    source: "QUALITY",
    kind: "CORRECTIVE",
    assignedToId: null,
    dueOn: null,
    lockout: false,
    ncId: nc.id,
  });
  const created = await ctx.db.maintWorkOrder.findFirst({
    where: { id },
    select: { year: true, number: true },
  });
  return { id, code: created === null ? "" : codeOf(created), created: true };
}

/** The work orders of a nonconformity, for its screen (whoever sees the NC sees how they're going). */
export async function workOrdersOfNc(
  db: TenantDb,
  ncId: string,
): Promise<
  {
    id: string;
    code: string;
    title: string;
    status: MaintWorkStatus;
    asset: { code: string; name: string } | null;
    solution: string;
    doneAt: Date | null;
  }[]
> {
  if (!(await maintenanceEnabled(db))) return [];
  const rows = await db.maintWorkOrder.findMany({
    where: { ncId },
    orderBy: { reportedAt: "asc" },
    take: 20,
    select: {
      id: true,
      year: true,
      number: true,
      title: true,
      status: true,
      assetId: true,
      solution: true,
      doneAt: true,
    },
  });
  const assets = await assetsOf(
    db,
    rows.flatMap((row) => (row.assetId === null ? [] : [row.assetId])),
  );
  return rows.map((row) => {
    const asset = row.assetId === null ? undefined : assets.get(row.assetId);
    return {
      id: row.id,
      code: maintenanceTexts.code(row.year, row.number),
      title: row.title,
      status: row.status,
      asset: asset === undefined ? null : { code: asset.code, name: asset.name },
      solution: row.solution,
      doneAt: row.doneAt,
    };
  });
}

/** A work order created by maintenance, with everything. */
export async function createWorkOrder(
  ctx: AdminContext,
  input: CreateInput,
): Promise<WorkOrderDetail> {
  await requireManage(ctx);
  await assertAsset(ctx.db, input.assetId);
  await assertTechnician(ctx.db, input.assignedToId);
  const id = await insertWorkOrder(ctx, ctx.tenant.membershipId, { ...input, source: "APP" });
  return await getWorkOrder(ctx, id);
}

export async function updateWorkOrder(
  ctx: AdminContext,
  id: string,
  input: UpdateInput,
): Promise<WorkOrderDetail> {
  await requireManage(ctx);
  const row = await rowOf(ctx, id);
  if (FINAL.includes(row.status)) {
    throw new AppError("CONFLICT", { message: maintenanceTexts.errors.wrongState });
  }
  await assertAsset(ctx.db, input.assetId);
  await assertTechnician(ctx.db, input.assignedToId);
  const status: MaintWorkStatus =
    row.status === "REPORTED" && input.assignedToId !== null && input.dueOn !== null
      ? "PLANNED"
      : row.status;
  const saved = await ctx.db.maintWorkOrder.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description,
      assetId: input.assetId,
      kind: input.kind,
      priority: input.priority,
      assignedToId: input.assignedToId,
      dueOn: input.dueOn === null ? null : dateOf(input.dueOn),
      lockout: input.lockout,
      status,
    },
    select: { id: true, status: true, dueOn: true, assignedToId: true },
  });
  await syncExpiry(ctx.db, saved);
  await event(ctx.db, id, ctx.tenant.membershipId, "updated");
  if (input.assignedToId !== null && input.assignedToId !== row.assignedToId) {
    await event(ctx.db, id, ctx.tenant.membershipId, "assigned");
    await notify(ctx.db, [input.assignedToId], ctx.tenant.membershipId, id);
  }
  await auditAdmin(ctx, {
    action: "maintenance.work_order.update",
    entityType: "MaintWorkOrder",
    entityId: id,
    metadata: { priority: input.priority, status },
  });
  return await getWorkOrder(ctx, id);
}

function wrongState(): AppError {
  return new AppError("CONFLICT", { message: maintenanceTexts.errors.wrongState });
}

/** The person's running stretch of work on this work order, if any. */
async function runningLabor(db: TenantDb, workOrderId: string, membershipId: string) {
  return await db.maintLabor.findFirst({
    where: { workOrderId, membershipId, endedAt: null },
    select: { id: true, startedAt: true },
  });
}

async function stopLabor(
  db: TenantDb,
  labor: { id: string; startedAt: Date },
  note: string,
): Promise<void> {
  const endedAt = new Date();
  const minutes = Math.max(1, Math.round((endedAt.getTime() - labor.startedAt.getTime()) / 60_000));
  await db.maintLabor.update({
    where: { id: labor.id },
    data: {
      endedAt,
      minutes: Math.min(minutes, maintenanceLimits.laborMinutesMax),
      ...(note === "" ? {} : { note }),
    },
    select: { id: true },
  });
}

/** Stops every running stretch of work (when the work order is done, put on hold or cancelled). */
async function stopAll(db: TenantDb, workOrderId: string): Promise<void> {
  const running = await db.maintLabor.findMany({
    where: { workOrderId, endedAt: null },
    select: { id: true, startedAt: true },
  });
  for (const labor of running) await stopLabor(db, labor, "");
}

export async function actOnWorkOrder(
  ctx: AdminContext,
  id: string,
  input: WorkAction,
): Promise<WorkOrderDetail> {
  await requireMaintenance(ctx);
  const row = await rowOf(ctx, id);
  const me = ctx.tenant.membershipId;
  const now = new Date();
  const open = OPEN.includes(row.status);
  const update = async (data: Prisma.MaintWorkOrderUpdateInput) => {
    const saved = await ctx.db.maintWorkOrder.update({
      where: { id },
      data,
      select: { id: true, status: true, dueOn: true, assignedToId: true },
    });
    await syncExpiry(ctx.db, saved);
  };
  let detail = "";

  switch (input.action) {
    case "take":
      await requireWork(ctx);
      if (!open) throw wrongState();
      await update({
        assignedToId: me,
        ...(row.status === "REPORTED" ? { status: "PLANNED" } : {}),
      });
      break;
    case "start": {
      await requireWork(ctx);
      if (!open) throw wrongState();
      if ((await runningLabor(ctx.db, id, me)) !== null) {
        throw new AppError("CONFLICT", { message: maintenanceTexts.errors.timerRunning });
      }
      await ctx.db.maintLabor.create({
        data: { workOrderId: id, membershipId: me, startedAt: now },
        select: { id: true },
      });
      await update({
        status: "IN_PROGRESS",
        holdReason: "",
        ...(row.startedAt === null ? { startedAt: now } : {}),
        ...(row.assignedToId === null ? { assignedToId: me } : {}),
      });
      break;
    }
    case "stop": {
      await requireWork(ctx);
      const running = await runningLabor(ctx.db, id, me);
      if (running === null) {
        throw new AppError("CONFLICT", { message: maintenanceTexts.errors.noTimer });
      }
      await stopLabor(ctx.db, running, input.note);
      break;
    }
    case "hold":
      await requireWork(ctx);
      if (!open) throw wrongState();
      await stopAll(ctx.db, id);
      await update({ status: "ON_HOLD", holdReason: input.reason });
      detail = input.reason;
      break;
    case "resume":
      await requireWork(ctx);
      if (row.status !== "ON_HOLD") throw wrongState();
      await update({ status: row.startedAt === null ? "PLANNED" : "IN_PROGRESS", holdReason: "" });
      break;
    case "done":
      await requireWork(ctx);
      if (!open) throw wrongState();
      await stopAll(ctx.db, id);
      await update({
        status: "DONE",
        doneAt: now,
        cause: input.cause,
        solution: input.solution,
        downtimeMinutes: input.downtimeMinutes,
        holdReason: "",
      });
      if (row.reportedById !== me) await notify(ctx.db, [row.reportedById], me, id);
      break;
    case "release_hygiene": {
      if (row.status !== "DONE" || row.hygieneReleasedAt !== null) throw wrongState();
      const asset =
        row.assetId === null ? undefined : (await assetsOf(ctx.db, [row.assetId])).get(row.assetId);
      if (asset?.foodContact !== true) {
        throw new AppError("BAD_REQUEST", { message: maintenanceTexts.errors.hygieneNotNeeded });
      }
      if (!(await canReleaseHygiene(ctx))) throw forbidden();
      await update({ hygieneReleasedById: me, hygieneReleasedAt: now });
      break;
    }
    case "close": {
      await requireManage(ctx);
      if (row.status !== "DONE") throw wrongState();
      const asset =
        row.assetId === null ? undefined : (await assetsOf(ctx.db, [row.assetId])).get(row.assetId);
      if (asset?.foodContact === true && row.hygieneReleasedAt === null) {
        throw new AppError("CONFLICT", { message: maintenanceTexts.errors.needsHygiene });
      }
      await update({ status: "CLOSED", closedAt: now, closedById: me });
      break;
    }
    case "reopen":
      await requireManage(ctx);
      if (row.status !== "DONE") throw wrongState();
      await update({
        status: "IN_PROGRESS",
        doneAt: null,
        hygieneReleasedAt: null,
        hygieneReleasedById: null,
      });
      break;
    case "cancel":
      await requireManage(ctx);
      if (!open) throw wrongState();
      await stopAll(ctx.db, id);
      await update({
        status: "CANCELLED",
        closedAt: now,
        closedById: me,
        holdReason: input.reason,
      });
      detail = input.reason;
      break;
    case "labor": {
      await requireWork(ctx);
      if (FINAL.includes(row.status)) throw wrongState();
      if (input.minutes > maintenanceLimits.laborMinutesMax) {
        throw new AppError("BAD_REQUEST", { message: maintenanceTexts.errors.tooLong });
      }
      const today = await companyToday(ctx.db);
      const startedAt = dateOf(input.day > today ? today : input.day);
      await ctx.db.maintLabor.create({
        data: {
          workOrderId: id,
          membershipId: me,
          startedAt,
          endedAt: new Date(startedAt.getTime() + input.minutes * 60_000),
          minutes: input.minutes,
          note: input.note,
        },
        select: { id: true },
      });
      detail = String(input.minutes);
      break;
    }
    case "remove_labor": {
      await requireWork(ctx);
      if (FINAL.includes(row.status)) throw wrongState();
      const labor = await ctx.db.maintLabor.findFirst({
        where: { id: input.laborId, workOrderId: id },
        select: { id: true, membershipId: true },
      });
      if (labor === null) throw notFound();
      if (labor.membershipId !== me && !canManageMaintenance(ctx)) throw forbidden();
      await ctx.db.maintLabor.delete({ where: { id: labor.id }, select: { id: true } });
      break;
    }
    case "part":
      await requireWork(ctx);
      if (FINAL.includes(row.status)) throw wrongState();
      await ctx.db.maintPartUse.create({
        data: {
          workOrderId: id,
          partCode: input.partCode,
          description: input.description,
          quantity: input.quantity,
          unit: input.unit,
          recordedById: me,
        },
        select: { id: true },
      });
      detail = `${input.partCode} ${input.description} × ${String(input.quantity)}`.trim();
      break;
    case "check": {
      await requireWork(ctx);
      if (!open) throw wrongState();
      const steps = checklistOf(row.checklist);
      const step = steps[input.index];
      if (step === undefined) throw notFound();
      step.done = input.done;
      await update({ checklist: steps });
      detail = `${input.done ? "✓" : "✗"} ${step.text}`;
      break;
    }
    case "remove_part": {
      await requireWork(ctx);
      if (FINAL.includes(row.status)) throw wrongState();
      const part = await ctx.db.maintPartUse.findFirst({
        where: { id: input.partId, workOrderId: id },
        select: { id: true },
      });
      if (part === null) throw notFound();
      await ctx.db.maintPartUse.delete({ where: { id: part.id }, select: { id: true } });
      break;
    }
  }
  await event(ctx.db, id, me, input.action, detail);
  // Its plan moves on to the next one when it's done or cancelled (section 5).
  if ((input.action === "done" || input.action === "cancel") && row.planId !== null) {
    await planWorkFinished(ctx, row.planId, input.action);
  }
  // Its nonconformity hears when it's done, closed, cancelled or reopened (section 8).
  if (["done", "close", "cancel", "reopen"].includes(input.action) && row.ncId !== null) {
    const after = await ctx.db.maintWorkOrder.findFirst({
      where: { id },
      select: { status: true, year: true, number: true },
    });
    if (after !== null) {
      await noteOnNc(
        ctx.db,
        {
          ncId: row.ncId,
          code: maintenanceTexts.code(after.year, after.number),
          status: after.status,
        },
        me,
      );
    }
  }
  await auditAdmin(ctx, {
    action: `maintenance.work_order.${input.action}`,
    entityType: "MaintWorkOrder",
    entityId: id,
  });
  return await getWorkOrder(ctx, id);
}

/**
 * For the menu: the open work orders the person has assigned, the urgent ones, and (for whoever manages
 * maintenance) the ones waiting for them: new reports nobody took and done ones still to close.
 */
export async function workOrderCounts(
  ctx: AdminContext,
): Promise<{ mine: number; urgent: number; pending: number }> {
  await requireMaintenance(ctx);
  if (!canWorkMaintenance(ctx)) return { mine: 0, urgent: 0, pending: 0 };
  const [mine, urgent, pending] = await Promise.all([
    ctx.db.maintWorkOrder.count({
      where: { assignedToId: ctx.tenant.membershipId, status: { in: OPEN } },
    }),
    ctx.db.maintWorkOrder.count({ where: { priority: "URGENT", status: { in: OPEN } } }),
    canManageMaintenance(ctx)
      ? ctx.db.maintWorkOrder.count({
          where: {
            OR: [{ status: "REPORTED", assignedToId: null }, { status: "DONE" }],
          },
        })
      : Promise.resolve(0),
  ]);
  return { mine, urgent, pending };
}
