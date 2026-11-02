// Accidents and incidents (docs/spec/seguridad-salud.md, «Accidentes e incidentes»). Anyone reports one
// by filling in the module's base form; each record becomes a case here, with what's needed to filter
// and follow it. Health data: only `safety.health` lists, opens, closes and exports them, and sets their
// corrective measures; whoever has to do a measure sees it among their measures and marks it done.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import type { Answers } from "../forms/answers.ts";
import { toCsv } from "../members/members.csv.ts";
import { ACTION_EXPIRY } from "./action-expiry.ts";
import { INCIDENT_FIELDS, INCIDENT_SEVERITIES, INCIDENT_TYPES } from "./incident-form.ts";
import { requireSafety, safetySettingsOf } from "./safety-access.ts";
import type {
  ActionInput,
  IncidentFilters,
  ListIncidentsQuery,
  UpdateActionInput,
} from "./incidents.schemas.ts";

export const CSV_MAX = 10_000;

const canSeeHealth = (ctx: Pick<AdminContext, "tenant">) =>
  ctx.tenant.capabilities.includes("safety.health");

async function requireHealth(ctx: AdminContext): Promise<void> {
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
    await ctx.db.notification.create({
      data: {
        membershipId: holder.id,
        kind: "safety_incident",
        actorId: ctx.tenant.membershipId,
        detail: incident.id,
        dedupeKey: `safety-incident:${incident.id}`,
      },
    });
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

export interface ActionView {
  id: string;
  description: string;
  responsible: { id: string; name: string };
  dueOn: string;
  done: { at: Date; by: { id: string; name: string } | null; note: string | null } | null;
}

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
  status: "OPEN" | "CLOSED";
  closed: { at: Date; by: { id: string; name: string } | null } | null;
  actions: { total: number; done: number };
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
    status: row.status === "CLOSED" ? "CLOSED" : "OPEN",
    closed:
      row.closedAt === null
        ? null
        : { at: row.closedAt, by: row.closedById === null ? null : who(row.closedById) },
    actions: {
      total: row.actions.length,
      done: row.actions.filter((action) => action.doneAt !== null).length,
    },
  }));
}

function incidentsWhere(filters: IncidentFilters): Prisma.SafetyIncidentWhereInput {
  return {
    ...(filters.type === undefined ? {} : { type: filters.type }),
    ...(filters.severity === undefined ? {} : { severity: filters.severity }),
    ...(filters.person === undefined ? {} : { membershipId: filters.person }),
    ...(filters.department === undefined ? {} : { departmentId: filters.department }),
    ...(filters.status === "all"
      ? {}
      : { status: filters.status === "open" ? "OPEN" : "CLOSED" }),
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

async function loadIncident(ctx: AdminContext, id: string): Promise<IncidentRow> {
  await requireHealth(ctx);
  const row = await ctx.db.safetyIncident.findFirst({ where: { id }, select: incidentSelect });
  if (row === null) throw notFound();
  return row;
}

async function actionsOf(ctx: AdminContext, where: Prisma.SafetyActionWhereInput) {
  const rows = await ctx.db.safetyAction.findMany({
    where,
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    take: 200,
  });
  const people = await names(
    ctx,
    rows.flatMap((row) => [row.responsibleId, row.doneById]),
  );
  return rows.map((row): ActionView & { incidentId: string } => ({
    id: row.id,
    incidentId: row.incidentId,
    description: row.description,
    responsible: { id: row.responsibleId, name: people.get(row.responsibleId) ?? "" },
    dueOn: dayOf(row.dueOn),
    done:
      row.doneAt === null
        ? null
        : {
            at: row.doneAt,
            by:
              row.doneById === null
                ? null
                : { id: row.doneById, name: people.get(row.doneById) ?? "" },
            note: row.note,
          },
  }));
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
  status: "OPEN" | "CLOSED",
): Promise<IncidentView> {
  const row = await loadIncident(ctx, id);
  const m = safetyTexts.incidents;
  if (row.status === status) {
    throw new AppError("CONFLICT", {
      message: status === "CLOSED" ? m.alreadyClosed : m.notClosed,
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
    action: status === "CLOSED" ? "safety.incident.close" : "safety.incident.reopen",
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
      view.status === "OPEN" ? c.open : c.closed,
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

// ─── Corrective measures ─────────────────────────────────────────────────────────────────

async function assertMember(ctx: AdminContext, membershipId: string): Promise<void> {
  const found = await ctx.db.membership.count({ where: { id: membershipId, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

export async function createAction(
  ctx: AdminContext,
  incidentId: string,
  input: ActionInput,
): Promise<ActionView> {
  await loadIncident(ctx, incidentId);
  await assertMember(ctx, input.responsibleId);
  const action = await ctx.db.$transaction(async (tx) => {
    const created = await tx.safetyAction.create({
      data: {
        incidentId,
        description: input.description,
        responsibleId: input.responsibleId,
        dueOn: new Date(`${input.dueOn}T00:00:00Z`),
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    await setExpiry(tx, {
      kind: ACTION_EXPIRY,
      subjectId: created.id,
      dueOn: input.dueOn,
      responsibleId: input.responsibleId,
      noticeDays: [7, 1, 0],
    });
    // A new measure reopens nothing by itself, but a closed case gets one more open.
    await tx.safetyIncident.updateMany({
      where: { id: incidentId, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    return created;
  });
  await auditAdmin(ctx, {
    action: "safety.action.create",
    entityType: "SafetyIncident",
    entityId: incidentId,
    metadata: { actionId: action.id, responsibleId: input.responsibleId, dueOn: input.dueOn },
  });
  const [view] = await actionsOf(ctx, { id: action.id });
  if (view === undefined) throw notFound();
  return view;
}

export async function updateAction(
  ctx: AdminContext,
  id: string,
  input: UpdateActionInput,
): Promise<ActionView> {
  await requireHealth(ctx);
  const current = await ctx.db.safetyAction.findFirst({ where: { id } });
  if (current === null) throw notFound();
  if (current.doneAt !== null) {
    throw new AppError("CONFLICT", { message: safetyTexts.incidents.actionDone });
  }
  if (input.responsibleId !== undefined) await assertMember(ctx, input.responsibleId);
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.safetyAction.update({
      where: { id },
      data: {
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.responsibleId === undefined ? {} : { responsibleId: input.responsibleId }),
        ...(input.dueOn === undefined ? {} : { dueOn: new Date(`${input.dueOn}T00:00:00Z`) }),
      },
    });
    await setExpiry(tx, {
      kind: ACTION_EXPIRY,
      subjectId: id,
      dueOn: dayOf(updated.dueOn),
      responsibleId: updated.responsibleId,
      noticeDays: [7, 1, 0],
    });
  });
  await auditAdmin(ctx, {
    action: "safety.action.update",
    entityType: "SafetyIncident",
    entityId: current.incidentId,
    metadata: { actionId: id, ...input },
  });
  const [view] = await actionsOf(ctx, { id });
  if (view === undefined) throw notFound();
  return view;
}

/** Done: by whoever has to do it, or by `safety.health`. */
export async function completeAction(
  ctx: AdminContext,
  id: string,
  note: string | null,
): Promise<ActionView> {
  await requireSafety(ctx);
  const current = await ctx.db.safetyAction.findFirst({ where: { id } });
  if (current === null) throw notFound();
  if (current.responsibleId !== ctx.tenant.membershipId && !canSeeHealth(ctx)) throw notFound();
  if (current.doneAt !== null) {
    throw new AppError("CONFLICT", { message: safetyTexts.incidents.actionDone });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.safetyAction.update({
      where: { id },
      data: { doneAt: new Date(), doneById: ctx.tenant.membershipId, note },
    });
    await resolveExpiry(tx, ACTION_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "safety.action.done",
    entityType: "SafetyIncident",
    entityId: current.incidentId,
    metadata: { actionId: id },
  });
  const [view] = await actionsOf(ctx, { id });
  if (view === undefined) throw notFound();
  return view;
}

/** The measures someone has to do (only the measure: never the incident's details). */
export async function myActions(ctx: AdminContext): Promise<ActionView[]> {
  await requireSafety(ctx);
  const rows = await actionsOf(ctx, { responsibleId: ctx.tenant.membershipId });
  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    responsible: row.responsible,
    dueOn: row.dueOn,
    done: row.done,
  }));
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
