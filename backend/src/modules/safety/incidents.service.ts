// Accidents and incidents (docs/spec/seguridad-salud.md, «Accidentes e incidentes»). Anyone reports one
// by filling in the module's base form; each record becomes a case here, with what's needed to filter
// and follow it. Health data: only `safety.health` lists, opens, closes and exports them, and sets their
// corrective measures; whoever has to do a measure sees it among their measures and marks it done.
import type { Jobs } from "../../jobs/boss.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import type { Answers } from "../forms/answers.ts";
import { toCsv } from "../members/members.csv.ts";
import { actionsOf, type ActionView } from "./actions.service.ts";
import { INCIDENT_FIELDS, INCIDENT_SEVERITIES, INCIDENT_TYPES } from "./incident-form.ts";
import { requireSafety, safetySettingsOf } from "./safety-access.ts";
import type { IncidentFilters, ListIncidentsQuery } from "./incidents.schemas.ts";

export const CSV_MAX = 10_000;

export const canSeeHealth = (ctx: Pick<AdminContext, "tenant">) =>
  ctx.tenant.capabilities.includes("safety.health");

export async function requireHealth(ctx: AdminContext): Promise<void> {
  await requireSafety(ctx);
  if (!canSeeHealth(ctx)) throw forbidden();
}

async function names(ctx: Pick<AdminContext, "db">, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: wanted } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

// ─── A record becomes a case ─────────────────────────────────────────────────────────────

/** Called when the incident form gets a record: the case, and a notice to `safety.health`. */
export async function recordIncident(
  ctx: AdminContext,
  record: { id: string; answers: Answers },
  jobs: Pick<Jobs, "enqueue">,
): Promise<void> {
  const f = INCIDENT_FIELDS;
  const text = (id: string) => {
    const value = record.answers[id];
    return typeof value === "string" && value !== "" ? value : null;
  };
  const typeId = text(f.type) as keyof typeof INCIDENT_TYPES | null;
  const severityId = text(f.severity) as keyof typeof INCIDENT_SEVERITIES | null;
  const membershipId = text(f.person);
  const department =
    membershipId === null
      ? null
      : await ctx.db.departmentMember.findFirst({
          where: { membershipId },
          select: { departmentId: true },
          orderBy: { departmentId: "asc" },
        });
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const occurredOn = text(f.date) ?? dayIn(new Date(), zoneOf(workspace?.settings));
  const incident = await ctx.db.safetyIncident.create({
    data: {
      recordId: record.id,
      type: typeId === null ? "incident" : INCIDENT_TYPES[typeId],
      severity: severityId === null ? null : INCIDENT_SEVERITIES[severityId],
      occurredOn: new Date(`${occurredOn}T00:00:00Z`),
      place: text(f.place),
      membershipId,
      departmentId: department?.departmentId ?? null,
      reportedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  const holders = await ctx.db.membership.findMany({
    where: { status: "ACTIVE", role: { capabilities: { has: "safety.health" } } },
    select: { id: true },
  });
  for (const holder of holders) {
    if (holder.id === ctx.tenant.membershipId) continue;
    const notice = await ctx.db.notification.create({
      data: {
        membershipId: holder.id,
        kind: "safety_incident",
        actorId: ctx.tenant.membershipId,
        detail: incident.id,
        dedupeKey: `safety-incident:${incident.id}`,
      },
      select: { id: true },
    });
    // Also by email, without what happened nor who: it's health data.
    await jobs.enqueue("email-send", { kind: "safety-incident-notice", notificationId: notice.id });
  }
  await auditAdmin(ctx, {
    action: "safety.incident.create",
    entityType: "SafetyIncident",
    entityId: incident.id,
    // Never what happened nor who: it's health data.
    metadata: { recordId: record.id },
  });
}

// ─── Cases ───────────────────────────────────────────────────────────────────────────────

/** Open (just reported), under investigation, or closed (every measure done). */
export type IncidentStatus = "OPEN" | "INVESTIGATING" | "CLOSED";

export interface IncidentView {
  id: string;
  recordId: string;
  formId: string | null;
  type: string;
  severity: string | null;
  occurredOn: string;
  place: string | null;
  person: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  reportedBy: { id: string; name: string };
  status: IncidentStatus;
  closed: { at: Date; by: { id: string; name: string } | null } | null;
  actions: { total: number; done: number };
  /** Days of sick leave (a number only), for the severity index. */
  lostDays: number | null;
}

const incidentSelect = {
  id: true,
  recordId: true,
  type: true,
  severity: true,
  occurredOn: true,
  place: true,
  membershipId: true,
  departmentId: true,
  reportedById: true,
  status: true,
  closedAt: true,
  closedById: true,
  lostDays: true,
  actions: { select: { doneAt: true } },
} as const;

type IncidentRow = Prisma.SafetyIncidentGetPayload<{ select: typeof incidentSelect }>;

async function incidentViews(ctx: AdminContext, rows: IncidentRow[]): Promise<IncidentView[]> {
  const people = await names(
    ctx,
    rows.flatMap((row) => [row.membershipId, row.reportedById, row.closedById]),
  );
  const departments = await ctx.db.department.findMany({
    where: {
      id: { in: rows.flatMap((row) => (row.departmentId === null ? [] : [row.departmentId])) },
    },
    select: { id: true, name: true },
  });
  const departmentById = new Map(departments.map((row) => [row.id, row.name]));
  const formId = (await safetySettingsOf(ctx.db)).incidentFormId ?? null;
  const who = (id: string) => ({ id, name: people.get(id) ?? "" });
  return rows.map((row) => ({
    id: row.id,
    recordId: row.recordId,
    formId,
    type: row.type,
    severity: row.severity,
    occurredOn: dayOf(row.occurredOn),
    place: row.place,
    person: row.membershipId === null ? null : who(row.membershipId),
    department:
      row.departmentId === null
        ? null
        : { id: row.departmentId, name: departmentById.get(row.departmentId) ?? "" },
    reportedBy: who(row.reportedById),
    status: row.status === "CLOSED" || row.status === "INVESTIGATING" ? row.status : "OPEN",
    closed:
      row.closedAt === null
        ? null
        : { at: row.closedAt, by: row.closedById === null ? null : who(row.closedById) },
    actions: {
      total: row.actions.length,
      done: row.actions.filter((action) => action.doneAt !== null).length,
    },
    lostDays: row.lostDays,
  }));
}

function incidentsWhere(filters: IncidentFilters): Prisma.SafetyIncidentWhereInput {
  return {
    ...(filters.type === undefined ? {} : { type: filters.type }),
    ...(filters.severity === undefined ? {} : { severity: filters.severity }),
    ...(filters.person === undefined ? {} : { membershipId: filters.person }),
    ...(filters.department === undefined ? {} : { departmentId: filters.department }),
    // «Open» is every case not closed yet: just reported or under investigation.
    ...(filters.status === "all"
      ? {}
      : filters.status === "open"
        ? { status: { in: ["OPEN", "INVESTIGATING"] } }
        : { status: filters.status === "investigating" ? "INVESTIGATING" : "CLOSED" }),
    ...(filters.from === undefined && filters.to === undefined
      ? {}
      : {
          occurredOn: {
            ...(filters.from === undefined ? {} : { gte: new Date(`${filters.from}T00:00:00Z`) }),
            ...(filters.to === undefined ? {} : { lte: new Date(`${filters.to}T00:00:00Z`) }),
          },
        }),
  };
}

/** The type's label (accident with leave, near miss…) in the active language. */
export function incidentTypeLabel(value: string): string {
  const form = safetyTexts.incidentForm;
  const id = Object.entries(INCIDENT_TYPES).find(([, type]) => type === value)?.[0];
  return id === undefined ? value : form.types[id as keyof typeof INCIDENT_TYPES];
}

export async function listIncidents(
  ctx: AdminContext,
  query: ListIncidentsQuery,
): Promise<Page<IncidentView>> {
  await requireHealth(ctx);
  const where = incidentsWhere(query);
  const [rows, total] = await Promise.all([
    ctx.db.safetyIncident.findMany({
      where,
      select: incidentSelect,
      orderBy: stableOrder([{ occurredOn: "desc" }, { createdAt: "desc" }]),
      ...offsetArgs(query),
    }),
    ctx.db.safetyIncident.count({ where }),
  ]);
  return pageOf(await incidentViews(ctx, rows), total, query);
}

export async function loadIncident(ctx: AdminContext, id: string): Promise<IncidentRow> {
  await requireHealth(ctx);
  const row = await ctx.db.safetyIncident.findFirst({ where: { id }, select: incidentSelect });
  if (row === null) throw notFound();
  return row;
}

export async function getIncident(
  ctx: AdminContext,
  id: string,
): Promise<{ incident: IncidentView; actions: ActionView[] }> {
  const row = await loadIncident(ctx, id);
  const [incident] = await incidentViews(ctx, [row]);
  if (incident === undefined) throw notFound();
  return { incident, actions: await actionsOf(ctx, { incidentId: id }) };
}

export async function setIncidentStatus(
  ctx: AdminContext,
  id: string,
  status: IncidentStatus,
): Promise<IncidentView> {
  const row = await loadIncident(ctx, id);
  const m = safetyTexts.incidents;
  if (row.status === status) {
    throw new AppError("CONFLICT", {
      message:
        status === "CLOSED"
          ? m.alreadyClosed
          : status === "INVESTIGATING"
            ? m.alreadyInvestigating
            : m.notClosed,
    });
  }
  if (status === "CLOSED" && row.actions.some((action) => action.doneAt === null)) {
    throw new AppError("CONFLICT", { message: m.notFoundActions });
  }
  await ctx.db.safetyIncident.update({
    where: { id },
    data:
      status === "CLOSED"
        ? { status, closedAt: new Date(), closedById: ctx.tenant.membershipId }
        : { status, closedAt: null, closedById: null },
  });
  await auditAdmin(ctx, {
    action:
      status === "CLOSED"
        ? "safety.incident.close"
        : status === "INVESTIGATING"
          ? "safety.incident.investigate"
          : "safety.incident.reopen",
    entityType: "SafetyIncident",
    entityId: id,
  });
  return (await getIncident(ctx, id)).incident;
}

export async function exportIncidentsCsv(
  ctx: AdminContext,
  filters: IncidentFilters,
): Promise<{ fileName: string; body: string }> {
  await requireHealth(ctx);
  const t = safetyTexts.incidents;
  const where = incidentsWhere(filters);
  const total = await ctx.db.safetyIncident.count({ where });
  if (total > CSV_MAX) {
    throw new AppError("BAD_REQUEST", {
      message: t.tooMany(CSV_MAX.toLocaleString(currentLocale())),
    });
  }
  const rows = await ctx.db.safetyIncident.findMany({
    where,
    select: incidentSelect,
    orderBy: stableOrder([{ occurredOn: "desc" }, { createdAt: "desc" }]),
    take: CSV_MAX,
  });
  const views = await incidentViews(ctx, rows);
  const form = safetyTexts.incidentForm;
  const typeLabel = Object.fromEntries(
    Object.entries(INCIDENT_TYPES).map(([id, value]) => [
      value,
      form.types[id as keyof typeof INCIDENT_TYPES],
    ]),
  );
  const severityLabel = Object.fromEntries(
    Object.entries(INCIDENT_SEVERITIES).map(([id, value]) => [
      value,
      form.severities[id as keyof typeof INCIDENT_SEVERITIES],
    ]),
  );
  const c = t.csv;
  const body = toCsv([
    [
      c.date,
      c.type,
      c.severity,
      c.place,
      c.person,
      c.department,
      c.reportedBy,
      c.status,
      c.actions,
    ],
    ...views.map((view) => [
      view.occurredOn,
      typeLabel[view.type] ?? view.type,
      view.severity === null ? "" : (severityLabel[view.severity] ?? view.severity),
      view.place ?? "",
      view.person?.name ?? "",
      view.department?.name ?? "",
      view.reportedBy.name,
      view.status === "OPEN"
        ? c.open
        : view.status === "INVESTIGATING"
          ? c.investigating
          : c.closed,
      `${String(view.actions.done)}/${String(view.actions.total)}`,
    ]),
  ]);
  await auditAdmin(ctx, {
    action: "safety.incidents.export",
    entityType: "SafetyIncident",
    metadata: { rows: views.length, filters: { ...filters } },
  });
  return { fileName: c.fileName, body };
}

/** Where to report one: the base form, for everyone with the module on. */
export async function incidentFormOf(
  ctx: AdminContext,
): Promise<{ formId: string; spaceId: string } | null> {
  const settings = await requireSafety(ctx);
  if (settings.incidentFormId === undefined) return null;
  const node = await ctx.db.node.findFirst({
    where: { id: settings.incidentFormId, trashedAt: null, type: "FORM" },
    select: { id: true, spaceId: true },
  });
  return node === null ? null : { formId: node.id, spaceId: node.spaceId };
}

/** The days of sick leave of an accident (only the number: no medical data). safety.health. */
export async function setLostDays(
  ctx: AdminContext,
  id: string,
  lostDays: number | null,
): Promise<IncidentView> {
  const row = await loadIncident(ctx, id);
  await ctx.db.safetyIncident.update({ where: { id }, data: { lostDays }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "safety.incident.lost_days",
    entityType: "SafetyIncident",
    entityId: id,
    metadata: { before: row.lostDays, after: lostDays },
  });
  const [view] = await incidentViews(ctx, [await loadIncident(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}
