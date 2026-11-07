// Preventive and corrective measures: the planning of the preventive activity (docs/spec/seguridad-
// salud.md, «Planificación de la actividad preventiva»; Ley 31/1995, art. 16). A measure comes from an
// accident or incident, a risk assessment (its EVR controlled document), an inspection (a non-conforming
// form record) or anything else; it has a responsible person, a day, a priority and an optional
// estimated cost, and is told as a `safety.action` expiry until it's done.
//
// Who does what: `safety.manage` plans (the «Planificación» screen, its CSV) and handles every measure
// except the accidents' ones, which stay with `safety.health` (health data). Whoever sees the planning
// without `safety.health` reads «Accidente o incidente» for those, never which one. Whoever has to do a
// measure sees it among their measures and marks it done.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { dayIn, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { toCsv } from "../members/members.csv.ts";
import { ACTION_EXPIRY } from "./action-expiry.ts";
import type {
  ActionFilters,
  ActionInput,
  ListActionsQuery,
  PlannedActionInput,
  UpdateActionInput,
} from "./incidents.schemas.ts";
import { canManageSafety, requireSafety } from "./safety-access.ts";

/** The risk assessment document type (safety.service.ts, RISK_ASSESSMENT_TYPE). */
const EVR = "EVR";
const CSV_MAX = 10_000;
const NOTICE_DAYS = [7, 1, 0] as const;

type Origin = "INCIDENT" | "RISK_ASSESSMENT" | "INSPECTION" | "OTHER";

const canSeeHealth = (ctx: Pick<AdminContext, "tenant">) =>
  ctx.tenant.capabilities.includes("safety.health");

/** What a measure comes from, as much as the viewer may see. */
export type ActionReference =
  | { kind: "incident"; id: string | null; label: string }
  | {
      kind: "document";
      id: string;
      spaceId: string | null;
      /** A page opens; a file, its folder. */
      page: boolean;
      parentId: string | null;
      label: string;
    }
  | { kind: "record"; id: string; formId: string | null; spaceId: string | null; label: string }
  | null;

export interface ActionView {
  id: string;
  origin: Origin;
  reference: ActionReference;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  /** Cents. */
  estimatedCost: number | null;
  responsible: { id: string; name: string };
  dueOn: string;
  overdue: boolean;
  done: { at: Date; by: { id: string; name: string } | null; note: string | null } | null;
  /** The viewer can change it (planning or health data, by origin). */
  canEdit: boolean;
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

async function today(ctx: Pick<AdminContext, "db">): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

const canEdit = (ctx: AdminContext, origin: Origin) =>
  origin === "INCIDENT" ? canSeeHealth(ctx) : canManageSafety(ctx);

type ActionRow = Prisma.SafetyActionGetPayload<{
  select: {
    id: true;
    origin: true;
    incidentId: true;
    nodeId: true;
    recordId: true;
    description: true;
    priority: true;
    estimatedCost: true;
    responsibleId: true;
    dueOn: true;
    doneAt: true;
    doneById: true;
    note: true;
  };
}>;

const actionSelect = {
  id: true,
  origin: true,
  incidentId: true,
  nodeId: true,
  recordId: true,
  description: true,
  priority: true,
  estimatedCost: true,
  responsibleId: true,
  dueOn: true,
  doneAt: true,
  doneById: true,
  note: true,
} as const;

/** The views, with each origin's reference resolved for this viewer. */
async function views(ctx: AdminContext, rows: ActionRow[]): Promise<ActionView[]> {
  const t = safetyTexts.planning;
  const locale = currentLocale();
  const day = await today(ctx);
  const health = canSeeHealth(ctx);
  const incidentIds = health
    ? [...new Set(rows.map((row) => row.incidentId).filter((id): id is string => id !== null))]
    : [];
  const nodeIds = [
    ...new Set(rows.map((row) => row.nodeId).filter((id): id is string => id !== null)),
  ];
  const recordIds = [
    ...new Set(rows.map((row) => row.recordId).filter((id): id is string => id !== null)),
  ];
  const [people, incidents, nodes, codes, records] = await Promise.all([
    names(
      ctx,
      rows.flatMap((row) => [row.responsibleId, row.doneById]),
    ),
    incidentIds.length === 0
      ? Promise.resolve([])
      : ctx.db.safetyIncident.findMany({
          where: { id: { in: incidentIds } },
          select: { id: true, occurredOn: true },
        }),
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds } },
          select: {
            id: true,
            name: true,
            spaceId: true,
            trashedAt: true,
            type: true,
            parentId: true,
          },
        }),
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.controlledDocument.findMany({
          where: { nodeId: { in: nodeIds } },
          select: { nodeId: true, code: true },
        }),
    recordIds.length === 0
      ? Promise.resolve([])
      : ctx.db.formRecord.findMany({
          where: { id: { in: recordIds } },
          select: {
            id: true,
            submittedAt: true,
            node: { select: { id: true, name: true, spaceId: true } },
          },
        }),
  ]);
  const incidentOf = new Map(incidents.map((row) => [row.id, row]));
  const nodeOf = new Map(nodes.map((row) => [row.id, row]));
  const codeOf = new Map(codes.map((row) => [row.nodeId, row.code]));
  const recordOf = new Map(records.map((row) => [row.id, row]));
  const reference = (row: ActionRow): ActionReference => {
    switch (row.origin) {
      case "INCIDENT": {
        // Without safety.health, only that it comes from one.
        const incident = row.incidentId === null ? undefined : incidentOf.get(row.incidentId);
        return incident === undefined
          ? { kind: "incident", id: null, label: t.origins.INCIDENT }
          : {
              kind: "incident",
              id: incident.id,
              label: t.incidentOf(formatUtcDay(incident.occurredOn, locale)),
            };
      }
      case "RISK_ASSESSMENT": {
        if (row.nodeId === null) return null;
        const node = nodeOf.get(row.nodeId);
        const code = codeOf.get(row.nodeId);
        return {
          kind: "document",
          id: row.nodeId,
          spaceId: node === undefined || node.trashedAt !== null ? null : node.spaceId,
          page: node?.type === "PAGE",
          parentId: node?.parentId ?? null,
          label: [code, node?.name]
            .filter((part): part is string => part !== undefined)
            .join(" · "),
        };
      }
      case "INSPECTION": {
        if (row.recordId === null) return null;
        const record = recordOf.get(row.recordId);
        return {
          kind: "record",
          id: row.recordId,
          formId: record?.node.id ?? null,
          spaceId: record?.node.spaceId ?? null,
          label:
            record === undefined
              ? t.origins.INSPECTION
              : t.recordOf(record.node.name, formatUtcDay(record.submittedAt, locale)),
        };
      }
      case "OTHER":
        return null;
    }
  };
  return rows.map((row) => ({
    id: row.id,
    origin: row.origin,
    reference: reference(row),
    description: row.description,
    priority: row.priority,
    estimatedCost: row.estimatedCost,
    responsible: { id: row.responsibleId, name: people.get(row.responsibleId) ?? "" },
    dueOn: dayOf(row.dueOn),
    overdue: row.doneAt === null && dayOf(row.dueOn) < day,
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
    canEdit: canEdit(ctx, row.origin),
  }));
}

/** Some measures (up to 200), by day: an incident's, someone's. */
export async function actionsOf(
  ctx: AdminContext,
  where: Prisma.SafetyActionWhereInput,
): Promise<ActionView[]> {
  const rows = await ctx.db.safetyAction.findMany({
    where,
    select: actionSelect,
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    take: 200,
  });
  return await views(ctx, rows);
}

async function oneView(ctx: AdminContext, id: string): Promise<ActionView> {
  const [view] = await actionsOf(ctx, { id });
  if (view === undefined) throw notFound();
  return view;
}

async function assertMember(ctx: AdminContext, membershipId: string): Promise<void> {
  const found = await ctx.db.membership.count({ where: { id: membershipId, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

/** Saves a new measure and its expiry. */
async function insertAction(
  ctx: AdminContext,
  data: {
    origin: Origin;
    incidentId?: string;
    nodeId?: string;
    recordId?: string;
  },
  input: ActionInput,
): Promise<string> {
  await assertMember(ctx, input.responsibleId);
  return await ctx.db.$transaction(async (tx) => {
    const created = await tx.safetyAction.create({
      data: {
        ...data,
        description: input.description,
        priority: input.priority,
        estimatedCost: input.estimatedCost ?? null,
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
      noticeDays: [...NOTICE_DAYS],
    });
    // A closed case gets one more open measure: it opens again.
    if (data.incidentId !== undefined) {
      await tx.safetyIncident.updateMany({
        where: { id: data.incidentId, status: "CLOSED" },
        data: { status: "OPEN", closedAt: null, closedById: null },
      });
    }
    return created.id;
  });
}

/** A measure of an accident or incident (health data: safety.health). */
export async function createAction(
  ctx: AdminContext,
  incidentId: string,
  input: ActionInput,
): Promise<ActionView> {
  await requireSafety(ctx);
  if (!canSeeHealth(ctx)) throw forbidden();
  const incident = await ctx.db.safetyIncident.count({ where: { id: incidentId } });
  if (incident === 0) throw notFound();
  const id = await insertAction(ctx, { origin: "INCIDENT", incidentId }, input);
  await auditAdmin(ctx, {
    action: "safety.action.create",
    entityType: "SafetyIncident",
    entityId: incidentId,
    metadata: { actionId: id, responsibleId: input.responsibleId, dueOn: input.dueOn },
  });
  return await oneView(ctx, id);
}

/** A planned measure from a risk assessment, an inspection or anything else (safety.manage). */
export async function createPlannedAction(
  ctx: AdminContext,
  input: PlannedActionInput,
): Promise<ActionView> {
  await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
  const m = safetyTexts.planning.messages;
  let reference: { nodeId?: string; recordId?: string } = {};
  if (input.origin === "RISK_ASSESSMENT") {
    const document = await ctx.db.controlledDocument.findFirst({
      where: { nodeId: input.nodeId, node: { trashedAt: null } },
      select: { docType: true },
    });
    if (document === null) throw notFound();
    if (document.docType !== EVR)
      throw new AppError("BAD_REQUEST", { message: m.notRiskAssessment });
    reference = { nodeId: input.nodeId };
  } else if (input.origin === "INSPECTION") {
    const record = await ctx.db.formRecord.findFirst({
      where: { id: input.recordId, voidedAt: null },
      select: { nonConforming: true },
    });
    if (record === null) throw notFound();
    if (record.nonConforming.length === 0) {
      throw new AppError("BAD_REQUEST", { message: m.recordConforming });
    }
    reference = { recordId: input.recordId };
  }
  const id = await insertAction(ctx, { origin: input.origin, ...reference }, input);
  await auditAdmin(ctx, {
    action: "safety.action.create",
    entityType: "SafetyAction",
    entityId: id,
    metadata: {
      origin: input.origin,
      ...reference,
      responsibleId: input.responsibleId,
      dueOn: input.dueOn,
    },
  });
  return await oneView(ctx, id);
}

async function loadAction(ctx: AdminContext, id: string) {
  const row = await ctx.db.safetyAction.findFirst({ where: { id }, select: actionSelect });
  if (row === null) throw notFound();
  return row;
}

export async function updateAction(
  ctx: AdminContext,
  id: string,
  input: UpdateActionInput,
): Promise<ActionView> {
  await requireSafety(ctx);
  const current = await loadAction(ctx, id);
  if (!canEdit(ctx, current.origin)) throw notFound();
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
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.estimatedCost === undefined ? {} : { estimatedCost: input.estimatedCost }),
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
  });
  await auditAdmin(ctx, {
    action: "safety.action.update",
    entityType: current.incidentId === null ? "SafetyAction" : "SafetyIncident",
    entityId: current.incidentId ?? id,
    metadata: { actionId: id, ...input },
  });
  return await oneView(ctx, id);
}

/** Done: by whoever has to do it, or by whoever handles it (planning or health data). */
export async function completeAction(
  ctx: AdminContext,
  id: string,
  note: string | null,
): Promise<ActionView> {
  await requireSafety(ctx);
  const current = await loadAction(ctx, id);
  if (current.responsibleId !== ctx.tenant.membershipId && !canEdit(ctx, current.origin)) {
    throw notFound();
  }
  if (current.doneAt !== null) {
    throw new AppError("CONFLICT", { message: safetyTexts.incidents.actionDone });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.safetyAction.update({
      where: { id },
      data: { doneAt: new Date(), doneById: ctx.tenant.membershipId, note },
      select: { id: true },
    });
    await resolveExpiry(tx, ACTION_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "safety.action.done",
    entityType: current.incidentId === null ? "SafetyAction" : "SafetyIncident",
    entityId: current.incidentId ?? id,
    metadata: { actionId: id },
  });
  return await oneView(ctx, id);
}

/** The measures someone has to do (an accident's, without saying which, unless safety.health). */
export async function myActions(ctx: AdminContext): Promise<ActionView[]> {
  await requireSafety(ctx);
  return await actionsOf(ctx, { responsibleId: ctx.tenant.membershipId });
}

// ─── Planning ────────────────────────────────────────────────────────────────────────────

function planningWhere(filters: ActionFilters, day: string): Prisma.SafetyActionWhereInput {
  const dayDate = new Date(`${day}T00:00:00Z`);
  return {
    ...(filters.origin === undefined ? {} : { origin: filters.origin }),
    ...(filters.responsible === undefined ? {} : { responsibleId: filters.responsible }),
    ...(filters.priority === undefined ? {} : { priority: filters.priority }),
    ...(filters.status === "open"
      ? { doneAt: null }
      : filters.status === "overdue"
        ? { doneAt: null, dueOn: { lt: dayDate } }
        : filters.status === "done"
          ? { doneAt: { not: null } }
          : {}),
    ...(filters.from === undefined && filters.to === undefined
      ? {}
      : {
          AND: [
            ...(filters.from === undefined
              ? []
              : [{ dueOn: { gte: new Date(`${filters.from}T00:00:00Z`) } }]),
            ...(filters.to === undefined
              ? []
              : [{ dueOn: { lte: new Date(`${filters.to}T00:00:00Z`) } }]),
          ],
        }),
  };
}

async function requirePlanner(ctx: AdminContext): Promise<void> {
  await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
}

/** Every measure, with filters and by day (safety.manage). */
export async function listPlanning(
  ctx: AdminContext,
  query: ListActionsQuery,
): Promise<Page<ActionView>> {
  await requirePlanner(ctx);
  const where = planningWhere(query, await today(ctx));
  const [rows, total] = await Promise.all([
    ctx.db.safetyAction.findMany({
      where,
      select: actionSelect,
      orderBy: stableOrder({ dueOn: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.safetyAction.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}

/** The planning as CSV (same filters and the same privacy as the screen). */
export async function exportPlanningCsv(
  ctx: AdminContext,
  filters: ActionFilters,
): Promise<{ fileName: string; body: string }> {
  await requirePlanner(ctx);
  const t = safetyTexts.planning;
  const where = planningWhere(filters, await today(ctx));
  const total = await ctx.db.safetyAction.count({ where });
  if (total > CSV_MAX) {
    throw new AppError("BAD_REQUEST", {
      message: safetyTexts.incidents.tooMany(CSV_MAX.toLocaleString(currentLocale())),
    });
  }
  const rows = await ctx.db.safetyAction.findMany({
    where,
    select: actionSelect,
    orderBy: stableOrder({ dueOn: "asc" as const }),
    take: CSV_MAX,
  });
  const list = await views(ctx, rows);
  const cost = (cents: number | null) =>
    cents === null
      ? ""
      : (cents / 100).toLocaleString(currentLocale(), {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const c = t.csv;
  const body = toCsv([
    [
      c.description,
      c.origin,
      c.reference,
      c.priority,
      c.cost,
      c.responsible,
      c.dueOn,
      c.status,
      c.doneOn,
    ],
    ...list.map((view) => [
      view.description,
      t.origins[view.origin],
      view.reference?.label ?? "",
      t.priorities[view.priority],
      cost(view.estimatedCost),
      view.responsible.name,
      view.dueOn,
      view.done !== null ? c.done : view.overdue ? c.overdue : c.open,
      view.done === null ? "" : view.done.at.toISOString().slice(0, 10),
    ]),
  ]);
  await auditAdmin(ctx, {
    action: "safety.actions.export",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { rows: list.length, ...filters },
  });
  return { fileName: c.fileName, body };
}
