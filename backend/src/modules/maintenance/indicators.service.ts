// Maintenance indicators (docs/spec/mantenimiento.md, section 7), for a period and for the whole plant or
// one line or machine (with everything under it). A breakdown is a corrective, safety or hygiene work order
// (not cancelled). Hours of the period are calendar hours (24 a day), as plants that run around the clock
// count them; the downtime is what the technicians wrote when marking any work order done (a planned stop
// leaves the machine without producing too), while MTBF and MTTR only count breakdowns.
//   MTBF = (period hours × equipment − downtime hours) ÷ breakdowns
//   MTTR = average hours from the report to «done», of the breakdowns done in the period
//   Availability = 1 − downtime hours ÷ (period hours × equipment)
// Preventive compliance: the plans' work orders due in the period (up to today), done by their day.
import type { TenantDb } from "../../db/tenant.ts";
import type { MaintWorkKind, MaintWorkStatus } from "../../generated/prisma/client.ts";
import { toCsv } from "../../lib/csv.ts";
import { forbidden } from "../../lib/errors.ts";
import { maintenanceTexts } from "../../i18n/index.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { companyToday } from "../quality/prps.service.ts";
import { canViewMaintenance, dateOf, requireMaintenance } from "./maintenance-access.ts";
import { addDays } from "./plans.service.ts";

const BREAKDOWNS: readonly MaintWorkKind[] = ["CORRECTIVE", "SAFETY", "HYGIENE"];
const PLANNED: readonly MaintWorkKind[] = ["PREVENTIVE", "CALIBRATION"];
const OPEN: readonly MaintWorkStatus[] = ["REPORTED", "PLANNED", "IN_PROGRESS", "ON_HOLD"];
const HOUR = 3_600_000;

export interface AssetIndicators {
  id: string;
  code: string;
  name: string;
  /** The line it hangs from (its top ancestor), or itself. */
  line: string;
  breakdowns: number;
  downtimeHours: number;
  mttrHours: number | null;
  mtbfHours: number | null;
  availability: number;
}

export interface Indicators {
  from: string;
  to: string;
  days: number;
  equipment: number;
  breakdowns: number;
  downtimeHours: number;
  mttrHours: number | null;
  mtbfHours: number | null;
  availability: number | null;
  preventiveDone: number;
  correctiveDone: number;
  /** Planned work (preventive and calibration) over all the work done, 0 to 1. */
  preventiveShare: number | null;
  open: number;
  overdue: number;
  onHold: number;
  compliance: { due: number; onTime: number; rate: number | null };
  top: AssetIndicators[];
  assets: AssetIndicators[];
}

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export async function maintenanceIndicators(
  ctx: AdminContext,
  query: { from: string | undefined; to: string | undefined; assetId: string | undefined },
): Promise<Indicators> {
  await requireMaintenance(ctx);
  if (!canViewMaintenance(ctx)) throw forbidden();
  return await compute(ctx.db, query);
}

async function compute(
  db: TenantDb,
  query: { from: string | undefined; to: string | undefined; assetId: string | undefined },
): Promise<Indicators> {
  const today = await companyToday(db);
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -89);
  const start = dateOf(from);
  const end = dateOf(addDays(to, 1));
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * HOUR)));
  const periodHours = days * 24;

  // The equipment in scope: all of it, or one with everything under it.
  const all = await db.maintAsset.findMany({
    select: { id: true, code: true, name: true, parentId: true, archivedAt: true },
    take: 5000,
  });
  const byId = new Map(all.map((asset) => [asset.id, asset]));
  const lineOf = (id: string): string => {
    let current = byId.get(id);
    for (let guard = 0; current?.parentId != null && guard < 10; guard += 1) {
      const parent = byId.get(current.parentId);
      if (parent === undefined) break;
      current = parent;
    }
    return current?.code ?? "";
  };
  const inScope = new Set<string>();
  if (query.assetId === undefined) {
    for (const asset of all) inScope.add(asset.id);
  } else {
    const children = new Map<string, string[]>();
    for (const asset of all) {
      if (asset.parentId !== null) {
        children.set(asset.parentId, [...(children.get(asset.parentId) ?? []), asset.id]);
      }
    }
    const walk = (id: string) => {
      if (inScope.has(id)) return;
      inScope.add(id);
      for (const child of children.get(id) ?? []) walk(child);
    };
    if (byId.has(query.assetId)) walk(query.assetId);
  }
  const scoped = all.filter((asset) => inScope.has(asset.id));
  const equipment = scoped.filter((asset) => asset.archivedAt === null).length;
  const assetFilter = query.assetId === undefined ? {} : { assetId: { in: [...inScope] } };

  const [inPeriod, openRows, dueRows] = await Promise.all([
    db.maintWorkOrder.findMany({
      where: {
        ...assetFilter,
        status: { not: "CANCELLED" },
        OR: [{ reportedAt: { gte: start, lt: end } }, { doneAt: { gte: start, lt: end } }],
      },
      select: {
        assetId: true,
        kind: true,
        reportedAt: true,
        doneAt: true,
        downtimeMinutes: true,
      },
      take: 20_000,
    }),
    db.maintWorkOrder.findMany({
      where: { ...assetFilter, status: { in: [...OPEN] } },
      select: { status: true, dueOn: true },
      take: 20_000,
    }),
    db.maintWorkOrder.findMany({
      where: {
        ...assetFilter,
        planId: { not: null },
        status: { not: "CANCELLED" },
        dueOn: { gte: start, lt: dateOf(addDays(to < today ? to : today, 1)) },
      },
      select: { dueOn: true, doneAt: true },
      take: 20_000,
    }),
  ]);

  const inRange = (date: Date | null) => date !== null && date >= start && date < end;
  const per = new Map<string, { breakdowns: number; downtime: number; repairs: number[] }>();
  const slot = (id: string) => {
    let entry = per.get(id);
    if (entry === undefined) {
      entry = { breakdowns: 0, downtime: 0, repairs: [] };
      per.set(id, entry);
    }
    return entry;
  };
  let breakdowns = 0;
  let downtimeMinutes = 0;
  const repairs: number[] = [];
  let preventiveDone = 0;
  let correctiveDone = 0;
  for (const row of inPeriod) {
    const isBreakdown = BREAKDOWNS.includes(row.kind);
    const entry = row.assetId === null ? null : slot(row.assetId);
    if (isBreakdown && inRange(row.reportedAt)) {
      breakdowns += 1;
      if (entry !== null) entry.breakdowns += 1;
    }
    if (row.doneAt !== null && inRange(row.doneAt)) {
      if (PLANNED.includes(row.kind)) preventiveDone += 1;
      downtimeMinutes += row.downtimeMinutes ?? 0;
      if (entry !== null) entry.downtime += row.downtimeMinutes ?? 0;
      if (isBreakdown) {
        correctiveDone += 1;
        const hours = (row.doneAt.getTime() - row.reportedAt.getTime()) / HOUR;
        repairs.push(hours);
        entry?.repairs.push(hours);
      }
    }
  }

  const average = (values: number[]) =>
    values.length === 0
      ? null
      : round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const downtimeHours = downtimeMinutes / 60;
  const assets: AssetIndicators[] = scoped
    .filter((asset) => asset.archivedAt === null || per.has(asset.id))
    .map((asset) => {
      const entry = per.get(asset.id) ?? { breakdowns: 0, downtime: 0, repairs: [] };
      const hours = entry.downtime / 60;
      return {
        id: asset.id,
        code: asset.code,
        name: asset.name,
        line: lineOf(asset.id),
        breakdowns: entry.breakdowns,
        downtimeHours: round(hours),
        mttrHours: average(entry.repairs),
        mtbfHours: entry.breakdowns === 0 ? null : round((periodHours - hours) / entry.breakdowns),
        availability: round(Math.max(0, 1 - hours / periodHours), 6),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const operating = periodHours * Math.max(equipment, 1);
  const onTime = dueRows.filter(
    (row) => row.doneAt !== null && row.dueOn !== null && dayOf(row.doneAt) <= dayOf(row.dueOn),
  ).length;
  return {
    from,
    to,
    days,
    equipment,
    breakdowns,
    downtimeHours: round(downtimeHours),
    mttrHours: average(repairs),
    mtbfHours: breakdowns === 0 ? null : round((operating - downtimeHours) / breakdowns),
    availability: equipment === 0 ? null : round(Math.max(0, 1 - downtimeHours / operating), 6),
    preventiveDone,
    correctiveDone,
    preventiveShare:
      preventiveDone + correctiveDone === 0
        ? null
        : round(preventiveDone / (preventiveDone + correctiveDone), 4),
    open: openRows.length,
    overdue: openRows.filter((row) => row.dueOn !== null && dayOf(row.dueOn) < today).length,
    onHold: openRows.filter((row) => row.status === "ON_HOLD").length,
    compliance: {
      due: dueRows.length,
      onTime,
      rate: dueRows.length === 0 ? null : round(onTime / dueRows.length, 4),
    },
    top: assets
      .filter((asset) => asset.breakdowns > 0)
      .sort((a, b) => b.breakdowns - a.breakdowns || b.downtimeHours - a.downtimeHours)
      .slice(0, 10),
    assets,
  };
}

/** The indicators of each piece of equipment, as CSV (for a spreadsheet). */
export async function indicatorsCsv(
  ctx: AdminContext,
  query: { from: string | undefined; to: string | undefined; assetId: string | undefined },
): Promise<{ fileName: string; body: string }> {
  const data = await maintenanceIndicators(ctx, query);
  const h = maintenanceTexts.indicatorsCsv;
  return {
    fileName: `${h.file}-${data.from}-${data.to}.csv`,
    body: toCsv(
      [h.code, h.name, h.line, h.breakdowns, h.downtime, h.mttr, h.mtbf, h.availability],
      data.assets.map((asset) => [
        asset.code,
        asset.name,
        asset.line,
        asset.breakdowns,
        asset.downtimeHours,
        asset.mttrHours,
        asset.mtbfHours,
        round(asset.availability * 100, 2),
      ]),
    ),
  };
}
