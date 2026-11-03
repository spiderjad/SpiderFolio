// The module's people (docs/spec/seguridad-salud.md, «Ficha por persona» and «Resumen»): whoever
// manages it sees everyone, heads their area. Each person's alerts: PPE their position requires and they
// lack, PPE to replace soon or already, training expired or pending and, only with safety.health, fitness
// about to expire or expired. The summary counts what needs attention, and each person sees their own
// alerts on Home.
import { forbidden } from "../../lib/errors.ts";
import { decodeOffsetCursor, pageOf, type Page } from "../../lib/pagination.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { expiryState } from "../expiries/expiry-rules.ts";
import { personPpe } from "./ppe.service.ts";
import { canManageSafety, requireSafety, visiblePeople } from "./safety-access.ts";
import { personTraining } from "./training.service.ts";

/** How many people are worked out at most for a filtered list or the summary. */
const MAX_PEOPLE = 1000;

export type SafetyAlert = "ppe" | "replace" | "training" | "fitness";

export interface PersonAlerts {
  /** PPE their position requires and they lack (or have expired). */
  missingPpe: number;
  /** PPE they have to replace within 30 days or already. */
  replace: number;
  /** Courses expired or never done. */
  training: number;
  /** Courses about to expire. */
  trainingSoon: number;
  /** Fitness about to expire or expired; null without safety.health. */
  fitness: "due_soon" | "expired" | null;
}

export interface SafetyPersonRow {
  id: string;
  name: string;
  position: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  alerts: PersonAlerts;
}

const health = (ctx: Pick<AdminContext, "tenant">) =>
  ctx.tenant.capabilities.includes("safety.health");

async function today(ctx: Pick<AdminContext, "db">): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

async function alertsOf(
  ctx: AdminContext,
  membershipId: string,
  day: string,
): Promise<PersonAlerts> {
  const ppe = await personPpe(ctx, membershipId);
  const training = await personTraining(ctx, membershipId);
  let fitness: PersonAlerts["fitness"] = null;
  if (health(ctx)) {
    const latest = await ctx.db.safetyFitness.findFirst({
      where: { membershipId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { validUntil: true },
    });
    if (latest?.validUntil != null) {
      const state = expiryState(day, dayOf(latest.validUntil), [30, 7, 0]);
      fitness = state === "valid" ? null : state;
    }
  }
  return {
    missingPpe: ppe.missing.length,
    replace: ppe.current.filter((item) => item.state !== "valid").length,
    training: training.filter((course) => course.state === "expired" || course.state === "pending")
      .length,
    trainingSoon: training.filter((course) => course.state === "due_soon").length,
    fitness,
  };
}

const matches = (alerts: PersonAlerts, alert: SafetyAlert | undefined): boolean =>
  alert === undefined ||
  (alert === "ppe" && alerts.missingPpe > 0) ||
  (alert === "replace" && alerts.replace > 0) ||
  (alert === "training" && alerts.training + alerts.trainingSoon > 0) ||
  (alert === "fitness" && alerts.fitness !== null);

async function peopleWhere(
  ctx: AdminContext,
  query: { q?: string | undefined; position?: string | undefined; department?: string | undefined },
): Promise<Prisma.MembershipWhereInput> {
  const visible = await visiblePeople(ctx);
  return {
    status: "ACTIVE",
    role: { base: { not: "GUEST" } },
    ...(visible === null ? {} : { id: { in: visible } }),
    ...(query.position === undefined ? {} : { positionId: query.position }),
    ...(query.department === undefined
      ? {}
      : { departments: { some: { departmentId: query.department } } }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { user: { name: { contains: query.q, mode: "insensitive" } } }),
  };
}

export async function listSafetyPeople(
  ctx: AdminContext,
  query: {
    q?: string | undefined;
    position?: string | undefined;
    department?: string | undefined;
    alert?: SafetyAlert | undefined;
    page: number;
    pageSize: number;
    cursor?: string | undefined;
  },
): Promise<Page<SafetyPersonRow>> {
  await requireSafety(ctx);
  const where = await peopleWhere(ctx, query);
  const rows = await ctx.db.membership.findMany({
    where,
    select: {
      id: true,
      positionId: true,
      user: { select: { name: true } },
      departments: { select: { department: { select: { id: true, name: true } } } },
    },
    orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
    take: MAX_PEOPLE,
  });
  const positions = new Map(
    (
      await ctx.db.position.findMany({
        where: {
          id: { in: rows.flatMap((row) => (row.positionId === null ? [] : [row.positionId])) },
        },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row]),
  );
  const day = await today(ctx);
  // The alerts are worked out per person: filtered, every person of the filter; otherwise, the page.
  const start = (query.page - 1) * query.pageSize;
  const offset = query.cursor === undefined ? start : (decodeOffsetCursor(query.cursor) ?? start);
  const candidates = query.alert === undefined ? rows.slice(offset, offset + query.pageSize) : rows;
  const items: SafetyPersonRow[] = [];
  for (const row of candidates) {
    const alerts = await alertsOf(ctx, row.id, day);
    if (!matches(alerts, query.alert)) continue;
    items.push({
      id: row.id,
      name: row.user.name,
      position: row.positionId === null ? null : (positions.get(row.positionId) ?? null),
      departments: row.departments.map((member) => member.department),
      alerts,
    });
  }
  if (query.alert === undefined) return pageOf(items, rows.length, query);
  return pageOf(items.slice(offset, offset + query.pageSize), items.length, query);
}

export interface SafetySummary {
  people: number;
  missingPpe: number;
  replace: number;
  training: number;
  trainingSoon: number;
  /** Only with safety.health (null without it). */
  fitness: number | null;
  actions: { open: number; overdue: number } | null;
  incidents: { open: number; recent: number } | null;
}

/** What needs attention, for whoever manages the module (and the health data with safety.health). */
export async function safetySummary(ctx: AdminContext): Promise<SafetySummary> {
  await requireSafety(ctx);
  if (!canManageSafety(ctx) && !health(ctx)) throw forbidden();
  const rows = await ctx.db.membership.findMany({
    where: await peopleWhere(ctx, {}),
    select: { id: true },
    take: MAX_PEOPLE,
  });
  const day = await today(ctx);
  const summary: SafetySummary = {
    people: rows.length,
    missingPpe: 0,
    replace: 0,
    training: 0,
    trainingSoon: 0,
    fitness: health(ctx) ? 0 : null,
    actions: null,
    incidents: null,
  };
  for (const row of rows) {
    const alerts = await alertsOf(ctx, row.id, day);
    if (alerts.missingPpe > 0) summary.missingPpe += 1;
    if (alerts.replace > 0) summary.replace += 1;
    if (alerts.training > 0) summary.training += 1;
    if (alerts.trainingSoon > 0) summary.trainingSoon += 1;
    if (summary.fitness !== null && alerts.fitness !== null) summary.fitness += 1;
  }
  if (health(ctx)) {
    const dayDate = new Date(`${day}T00:00:00Z`);
    const [open, overdue, openIncidents, recent] = await Promise.all([
      ctx.db.safetyAction.count({ where: { doneAt: null } }),
      ctx.db.safetyAction.count({ where: { doneAt: null, dueOn: { lt: dayDate } } }),
      ctx.db.safetyIncident.count({ where: { status: "OPEN" } }),
      ctx.db.safetyIncident.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
    ]);
    summary.actions = { open, overdue };
    summary.incidents = { open: openIncidents, recent };
  }
  return summary;
}

/** The person's own alerts, for Home: what their position requires and they lack, and training. */
export async function myAlerts(
  ctx: AdminContext,
): Promise<{ missingPpe: number; training: number } | null> {
  const settings = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const enabled = (settings?.settings as { safety?: { enabled?: unknown } } | null)?.safety
    ?.enabled;
  if (enabled !== true) return null;
  const alerts = await alertsOf(ctx, ctx.tenant.membershipId, await today(ctx));
  return { missingPpe: alerts.missingPpe, training: alerts.training };
}

/**
 * The number on «Prevención» in the side menu: whoever manages the module, the summary's total; everyone
 * else, the PPE they lack, their pending training and their open measures. null with the module off.
 */
export async function myCount(ctx: AdminContext): Promise<number | null> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const enabled = (workspace?.settings as { safety?: { enabled?: unknown } } | null)?.safety
    ?.enabled;
  if (enabled !== true) return null;
  if (canManageSafety(ctx) || health(ctx)) {
    const summary = await safetySummary(ctx);
    return (
      summary.missingPpe +
      summary.replace +
      summary.training +
      summary.trainingSoon +
      (summary.fitness ?? 0) +
      (summary.actions?.open ?? 0) +
      (summary.incidents?.open ?? 0)
    );
  }
  const alerts = await alertsOf(ctx, ctx.tenant.membershipId, await today(ctx));
  const actions = await ctx.db.safetyAction.count({
    where: { responsibleId: ctx.tenant.membershipId, doneAt: null },
  });
  return alerts.missingPpe + alerts.training + actions;
}
