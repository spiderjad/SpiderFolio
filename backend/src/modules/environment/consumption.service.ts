// Consumption and indicators (docs/spec/medio-ambiente.md, section 4): meters, their reading at the end
// of each month (the app works out the month's consumption), the month's production and the ratios per
// tonne, with the year's targets and the same month of the year before.
import type { TenantDb } from "../../db/tenant.ts";
import type { EnvMeterKind } from "../../generated/prisma/enums.ts";
import { notFound } from "../../lib/errors.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { requireCatalog, requireManage, requireRecord } from "./environment-access.ts";

export interface MeterView {
  id: string;
  name: string;
  kind: EnvMeterKind;
  unit: string;
  archived: boolean;
}

export interface MeterInput {
  name: string;
  kind: EnvMeterKind;
  unit: string;
}

export interface MonthPoint {
  month: string;
  reading: number | null;
  consumption: number | null;
  /** The same month the year before. */
  previous: number | null;
  perTonne: number | null;
}

export interface MeterYear {
  meter: MeterView;
  months: MonthPoint[];
  total: number;
  previousTotal: number | null;
  perTonne: number | null;
  target: number | null;
}

export interface ConsumptionYear {
  year: number;
  production: { month: string; tonnes: number | null }[];
  tonnes: number;
  meters: MeterYear[];
}

const num = (value: { toNumber: () => number } | null): number | null =>
  value === null ? null : value.toNumber();

const monthsOf = (year: number) =>
  Array.from({ length: 12 }, (_, index) => `${String(year)}-${String(index + 1).padStart(2, "0")}`);

/** «YYYY-MM» one month before. */
function previousMonth(month: string): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return value === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(value - 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return value === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(value + 1).padStart(2, "0")}`;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// ─── Meters ─────────────────────────────────────────────────────────────────────────────────

export async function listMeters(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<MeterView[]> {
  await requireCatalog(ctx);
  const rows = await ctx.db.envMeter.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    orderBy: [{ kind: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, kind: true, unit: true, archivedAt: true },
  });
  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }));
}

export async function createMeter(ctx: AdminContext, input: MeterInput): Promise<MeterView> {
  await requireManage(ctx);
  const row = await ctx.db.envMeter.create({
    data: input,
    select: { id: true, name: true, kind: true, unit: true },
  });
  await auditAdmin(ctx, {
    action: "environment.meter.create",
    entityType: "EnvMeter",
    entityId: row.id,
    metadata: { name: row.name, kind: row.kind },
  });
  return { ...row, archived: false };
}

export async function updateMeter(
  ctx: AdminContext,
  id: string,
  input: MeterInput & { archived?: boolean | undefined },
): Promise<MeterView> {
  await requireManage(ctx);
  const exists = await ctx.db.envMeter.findFirst({ where: { id }, select: { id: true } });
  if (exists === null) throw notFound();
  const { archived, ...fields } = input;
  const row = await ctx.db.envMeter.update({
    where: { id },
    data: {
      ...fields,
      ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
    },
    select: { id: true, name: true, kind: true, unit: true, archivedAt: true },
  });
  await auditAdmin(ctx, {
    action: "environment.meter.update",
    entityType: "EnvMeter",
    entityId: id,
    metadata: { name: row.name },
  });
  const { archivedAt, ...view } = row;
  return { ...view, archived: archivedAt !== null };
}

// ─── Readings ───────────────────────────────────────────────────────────────────────────────

async function readingOf(db: TenantDb, meterId: string, month: string) {
  return await db.envReading.findFirst({
    where: { meterId, month },
    select: { id: true, reading: true, consumption: true },
  });
}

/**
 * The reading at the end of a month. The consumption is the difference with the previous month's
 * reading; without one (the first month), or when the meter was replaced, it's typed by hand. The next
 * month's consumption is worked out again.
 */
export async function saveReading(
  ctx: AdminContext,
  input: { meterId: string; month: string; reading: number | null; consumption: number | null },
): Promise<void> {
  await requireRecord(ctx);
  const meter = await ctx.db.envMeter.findFirst({
    where: { id: input.meterId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (meter === null) throw notFound();
  const before = await readingOf(ctx.db, meter.id, previousMonth(input.month));
  const previousReading = num(before?.reading ?? null);
  const consumption =
    input.consumption ??
    (input.reading !== null && previousReading !== null
      ? Math.max(0, round(input.reading - previousReading))
      : 0);
  await ctx.db.envReading.upsert({
    where: { meterId_month: { meterId: meter.id, month: input.month } },
    create: {
      meterId: meter.id,
      month: input.month,
      reading: input.reading,
      consumption,
      recordedById: ctx.tenant.membershipId,
    },
    update: { reading: input.reading, consumption, recordedById: ctx.tenant.membershipId },
    select: { id: true },
  });
  // The following month's consumption depends on this reading.
  const after = await ctx.db.envReading.findFirst({
    where: { meterId: meter.id, month: nextMonth(input.month) },
    select: { reading: true },
  });
  const nextReading = num(after?.reading ?? null);
  if (nextReading !== null && input.reading !== null) {
    await ctx.db.envReading.upsert({
      where: { meterId_month: { meterId: meter.id, month: nextMonth(input.month) } },
      create: {
        meterId: meter.id,
        month: nextMonth(input.month),
        reading: nextReading,
        consumption: Math.max(0, round(nextReading - input.reading)),
        recordedById: ctx.tenant.membershipId,
      },
      update: { consumption: Math.max(0, round(nextReading - input.reading)) },
      select: { id: true },
    });
  }
  await auditAdmin(ctx, {
    action: "environment.reading",
    entityType: "EnvMeter",
    entityId: meter.id,
    metadata: { month: input.month, reading: input.reading, consumption },
  });
}

export async function deleteReading(
  ctx: AdminContext,
  input: { meterId: string; month: string },
): Promise<void> {
  await requireManage(ctx);
  const row = await readingOf(ctx.db, input.meterId, input.month);
  if (row === null) throw notFound();
  await ctx.db.envReading.delete({ where: { id: row.id }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "environment.reading.delete",
    entityType: "EnvMeter",
    entityId: input.meterId,
    metadata: { month: input.month },
  });
}

export async function saveProduction(
  ctx: AdminContext,
  input: { month: string; tonnes: number },
): Promise<void> {
  await requireRecord(ctx);
  await ctx.db.envProduction.upsert({
    where: { workspaceId_month: { workspaceId: ctx.db.workspaceId, month: input.month } },
    create: { month: input.month, tonnes: input.tonnes },
    update: { tonnes: input.tonnes },
    select: { month: true },
  });
  await auditAdmin(ctx, {
    action: "environment.production",
    entityType: "EnvProduction",
    entityId: input.month,
    metadata: { tonnes: input.tonnes },
  });
}

export async function saveTarget(
  ctx: AdminContext,
  input: { meterId: string; year: number; perTonne: number | null },
): Promise<void> {
  await requireManage(ctx);
  const meter = await ctx.db.envMeter.findFirst({
    where: { id: input.meterId },
    select: { id: true },
  });
  if (meter === null) throw notFound();
  if (input.perTonne === null) {
    await ctx.db.envTarget.deleteMany({ where: { meterId: meter.id, year: input.year } });
  } else {
    await ctx.db.envTarget.upsert({
      where: { meterId_year: { meterId: meter.id, year: input.year } },
      create: { meterId: meter.id, year: input.year, perTonne: input.perTonne },
      update: { perTonne: input.perTonne },
      select: { year: true },
    });
  }
  await auditAdmin(ctx, {
    action: "environment.target",
    entityType: "EnvMeter",
    entityId: meter.id,
    metadata: { year: input.year, perTonne: input.perTonne },
  });
}

/** A year's consumption by meter and month, with the year before and the ratios per tonne. */
export async function consumptionYear(ctx: AdminContext, year: number): Promise<ConsumptionYear> {
  await requireCatalog(ctx);
  const months = monthsOf(year);
  const previous = monthsOf(year - 1);
  const [meters, readings, production, targets] = await Promise.all([
    ctx.db.envMeter.findMany({
      where: { archivedAt: null },
      orderBy: [{ kind: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, kind: true, unit: true },
    }),
    ctx.db.envReading.findMany({
      where: { month: { in: [...months, ...previous] } },
      select: { meterId: true, month: true, reading: true, consumption: true },
    }),
    ctx.db.envProduction.findMany({
      where: { month: { in: months } },
      select: { month: true, tonnes: true },
    }),
    ctx.db.envTarget.findMany({ where: { year }, select: { meterId: true, perTonne: true } }),
  ]);
  const tonnesOf = new Map(production.map((row) => [row.month, row.tonnes.toNumber()]));
  const reading = new Map(readings.map((row) => [`${row.meterId}|${row.month}`, row]));
  const targetOf = new Map(targets.map((row) => [row.meterId, row.perTonne.toNumber()]));
  const tonnes = round([...tonnesOf.values()].reduce((sum, value) => sum + value, 0));
  return {
    year,
    production: months.map((month) => ({ month, tonnes: tonnesOf.get(month) ?? null })),
    tonnes,
    meters: meters.map((meter) => {
      let total = 0;
      const prior = { total: null as number | null };
      let producedWithData = 0;
      const points = months.map((month, index) => {
        const row = reading.get(`${meter.id}|${month}`);
        const before = reading.get(`${meter.id}|${previous[index] ?? ""}`);
        const consumption = row === undefined ? null : row.consumption.toNumber();
        const produced = tonnesOf.get(month) ?? null;
        if (consumption !== null) {
          total += consumption;
          if (produced !== null) producedWithData += produced;
        }
        if (before !== undefined) prior.total = (prior.total ?? 0) + before.consumption.toNumber();
        return {
          month,
          reading: row === undefined ? null : num(row.reading),
          consumption,
          previous: before === undefined ? null : before.consumption.toNumber(),
          perTonne:
            consumption !== null && produced !== null && produced > 0
              ? round(consumption / produced)
              : null,
        };
      });
      return {
        meter: { ...meter, archived: false },
        months: points,
        total: round(total),
        previousTotal: prior.total === null ? null : round(prior.total),
        perTonne: producedWithData > 0 ? round(total / producedWithData) : null,
        target: targetOf.get(meter.id) ?? null,
      };
    }),
  };
}
