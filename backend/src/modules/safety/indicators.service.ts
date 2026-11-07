// Accident rates (docs/spec/seguridad-salud.md, «Indicadores de siniestralidad»): each month's hours
// worked and average headcount (entered by safety.manage, for the company or a department) and the
// accidents with leave (and their days of leave) of the module's cases give the frequency, severity
// and incidence indices per month, year to date and last 12 months.
//
// Who sees what: the company's figures are aggregated counts, so safety.manage sees them (and
// safety.health); the breakdown by department could point at a person (a department with one accident),
// so it's only for safety.health, who sees the cases anyway. Nothing about any case goes out here.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { toCsv } from "../members/members.csv.ts";
import {
  addMonths,
  indicesOf,
  totalsOf,
  type Indices,
  type MonthFigures,
  type PeriodTotals,
} from "./indicators.ts";
import { canManageSafety, requireSafety } from "./safety-access.ts";

/** Accidents with sick leave: the incident type the indices count. */
const WITH_LEAVE = "leave";

const canSeeHealth = (ctx: Pick<AdminContext, "tenant">) =>
  ctx.tenant.capabilities.includes("safety.health");

async function requireReader(ctx: AdminContext): Promise<void> {
  await requireSafety(ctx);
  if (!canManageSafety(ctx) && !canSeeHealth(ctx)) throw forbidden();
}

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
}

const monthDate = (month: string) => new Date(`${month}T00:00:00Z`);
const monthOf = (date: Date) => `${date.toISOString().slice(0, 7)}-01`;

async function currentMonth(ctx: AdminContext): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return `${dayIn(new Date(), zoneOf(workspace?.settings)).slice(0, 7)}-01`;
}

export interface MonthRow extends MonthFigures, Indices {
  /** «YYYY-MM-01». */
  month: string;
}

export interface PeriodRow extends PeriodTotals, Indices {
  from: string;
  to: string;
  /** Months of the period without hours or headcount (the indices leave them out). */
  missing: number;
}

export interface DepartmentRow {
  id: string;
  name: string;
  ytd: PeriodRow;
}

export interface IndicatorsView {
  year: number;
  months: MonthRow[];
  ytd: PeriodRow;
  last12: PeriodRow;
  /** Only with safety.health: per department (where there's data). */
  departments: DepartmentRow[] | null;
}

/** Each month's figures between two months (both «YYYY-MM-01»), for the company or a department. */
async function figures(
  ctx: AdminContext,
  from: string,
  to: string,
  departmentId: string | null,
): Promise<Map<string, MonthFigures>> {
  const end = addMonths(to, 1);
  const [stats, incidents] = await Promise.all([
    ctx.db.safetyMonthStat.findMany({
      where: { departmentId, month: { gte: monthDate(from), lt: monthDate(end) } },
      select: { month: true, hoursWorked: true, avgHeadcount: true },
    }),
    ctx.db.safetyIncident.findMany({
      where: {
        type: WITH_LEAVE,
        occurredOn: { gte: monthDate(from), lt: monthDate(end) },
        ...(departmentId === null ? {} : { departmentId }),
      },
      select: { occurredOn: true, lostDays: true },
    }),
  ]);
  const result = new Map<string, MonthFigures>();
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    result.set(month, { hours: null, headcount: null, accidents: 0, lostDays: 0 });
  }
  for (const row of stats) {
    const entry = result.get(monthOf(row.month));
    if (entry !== undefined) {
      entry.hours = row.hoursWorked;
      entry.headcount = row.avgHeadcount;
    }
  }
  for (const row of incidents) {
    const entry = result.get(monthOf(row.occurredOn));
    if (entry !== undefined) {
      entry.accidents += 1;
      entry.lostDays += row.lostDays ?? 0;
    }
  }
  return result;
}

function period(byMonth: Map<string, MonthFigures>, from: string, to: string): PeriodRow {
  const months: MonthFigures[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    const entry = byMonth.get(month);
    if (entry !== undefined) months.push(entry);
  }
  const totals = totalsOf(months);
  return {
    from,
    to,
    ...totals,
    ...indicesOf(totals),
    missing: months.filter((month) => month.hours === null || month.headcount === null).length,
  };
}

/** The year's months, its year to date (up to this month) and the last 12 months. */
export async function getIndicators(ctx: AdminContext, year: number): Promise<IndicatorsView> {
  await requireReader(ctx);
  const now = await currentMonth(ctx);
  const first = `${String(year)}-01-01`;
  const last = `${String(year)}-12-01`;
  const ytdEnd = now.startsWith(String(year)) ? now : last;
  const last12From = addMonths(now, -11);
  const from = first < last12From ? first : last12From;
  const to = last > now ? last : now;
  const byMonth = await figures(ctx, from, to, null);
  const months: MonthRow[] = [];
  for (let month = first; month <= last; month = addMonths(month, 1)) {
    const entry = byMonth.get(month) ?? { hours: null, headcount: null, accidents: 0, lostDays: 0 };
    months.push({ month, ...entry, ...indicesOf(totalsOf([entry])) });
  }
  let departments: DepartmentRow[] | null = null;
  if (canSeeHealth(ctx)) {
    const [withStats, withAccidents] = await Promise.all([
      ctx.db.safetyMonthStat.findMany({
        where: {
          departmentId: { not: null },
          month: { gte: monthDate(first), lte: monthDate(ytdEnd) },
        },
        select: { departmentId: true },
        distinct: ["departmentId"],
      }),
      ctx.db.safetyIncident.findMany({
        where: {
          type: WITH_LEAVE,
          departmentId: { not: null },
          occurredOn: { gte: monthDate(first), lt: monthDate(addMonths(ytdEnd, 1)) },
        },
        select: { departmentId: true },
        distinct: ["departmentId"],
      }),
    ]);
    const ids = [
      ...new Set(
        [...withStats, ...withAccidents]
          .map((row) => row.departmentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const names = await ctx.db.department.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    departments = [];
    for (const department of names) {
      const data = await figures(ctx, first, ytdEnd, department.id);
      departments.push({
        id: department.id,
        name: department.name,
        ytd: period(data, first, ytdEnd),
      });
    }
  }
  return {
    year,
    months,
    ytd: period(byMonth, first, ytdEnd),
    last12: period(byMonth, last12From, now),
    departments,
  };
}

// ─── Monthly figures ─────────────────────────────────────────────────────────────────────

export interface StatRow {
  month: string;
  hoursWorked: number | null;
  avgHeadcount: number | null;
}

async function assertDepartment(ctx: AdminContext, departmentId: string | null): Promise<void> {
  if (departmentId === null) return;
  const found = await ctx.db.department.count({ where: { id: departmentId } });
  if (found === 0) throw notFound();
}

/** The year's twelve months as they were entered (for the company or a department). */
export async function listStats(
  ctx: AdminContext,
  year: number,
  departmentId: string | null,
): Promise<StatRow[]> {
  await requireManager(ctx);
  await assertDepartment(ctx, departmentId);
  const rows = await ctx.db.safetyMonthStat.findMany({
    where: {
      departmentId,
      month: { gte: monthDate(`${String(year)}-01-01`), lte: monthDate(`${String(year)}-12-01`) },
    },
    select: { month: true, hoursWorked: true, avgHeadcount: true },
  });
  const byMonth = new Map(rows.map((row) => [monthOf(row.month), row]));
  const result: StatRow[] = [];
  for (let n = 1; n <= 12; n++) {
    const month = `${String(year)}-${String(n).padStart(2, "0")}-01`;
    const row = byMonth.get(month);
    result.push({
      month,
      hoursWorked: row?.hoursWorked ?? null,
      avgHeadcount: row?.avgHeadcount ?? null,
    });
  }
  return result;
}

/** Enters or corrects one month (company or department). */
export async function setStat(
  ctx: AdminContext,
  input: { month: string; departmentId: string | null; hoursWorked: number; avgHeadcount: number },
): Promise<StatRow> {
  await requireManager(ctx);
  await assertDepartment(ctx, input.departmentId);
  if (!input.month.endsWith("-01")) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.indicators.messages.notMonth });
  }
  const current = await ctx.db.safetyMonthStat.findFirst({
    where: { month: monthDate(input.month), departmentId: input.departmentId },
    select: { id: true, hoursWorked: true, avgHeadcount: true },
  });
  const data = {
    hoursWorked: input.hoursWorked,
    avgHeadcount: input.avgHeadcount,
    updatedById: ctx.tenant.membershipId,
  };
  if (current === null) {
    await ctx.db.safetyMonthStat.create({
      data: { ...data, month: monthDate(input.month), departmentId: input.departmentId },
      select: { id: true },
    });
  } else {
    await ctx.db.safetyMonthStat.update({ where: { id: current.id }, data, select: { id: true } });
  }
  await auditAdmin(ctx, {
    action: "safety.stats.update",
    entityType: "SafetyMonthStat",
    entityId: input.month,
    metadata: {
      month: input.month,
      departmentId: input.departmentId,
      hoursWorked: input.hoursWorked,
      avgHeadcount: input.avgHeadcount,
      ...(current === null
        ? {}
        : { before: { hoursWorked: current.hoursWorked, avgHeadcount: current.avgHeadcount } }),
    },
  });
  return {
    month: input.month,
    hoursWorked: input.hoursWorked,
    avgHeadcount: input.avgHeadcount,
  };
}

/** The year's months and its two periods, as CSV (the company's figures only). */
export async function exportIndicatorsCsv(
  ctx: AdminContext,
  year: number,
): Promise<{ fileName: string; body: string }> {
  const view = await getIndicators(ctx, year);
  const c = safetyTexts.indicators.csv;
  const number = (value: number | null) =>
    value === null ? "" : value.toLocaleString(currentLocale(), { maximumFractionDigits: 2 });
  const line = (label: string, row: PeriodTotals & Indices) => [
    label,
    number(row.hours),
    number(row.headcount),
    String(row.accidents),
    String(row.lostDays),
    number(row.frequency),
    number(row.severity),
    number(row.incidence),
  ];
  const body = toCsv([
    [c.period, c.hours, c.headcount, c.accidents, c.lostDays, c.frequency, c.severity, c.incidence],
    ...view.months.map((month) =>
      line(month.month.slice(0, 7), { ...month, hours: month.hours, headcount: month.headcount }),
    ),
    line(c.ytd(year), view.ytd),
    line(c.last12, view.last12),
  ]);
  await auditAdmin(ctx, {
    action: "safety.indicators.export",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { year },
  });
  return { fileName: c.fileName(year), body };
}
