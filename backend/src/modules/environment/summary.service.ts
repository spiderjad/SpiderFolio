// The Environment area's summary (docs/spec/medio-ambiente.md, «Pantallas»): what's due soon (permits,
// obligations, waste managers' authorizations, waste storage, leak checks), the last analyses out of
// their limits and last month's consumption against the same month the year before.
import { dayOf } from "../expiries/expiries.service.ts";
import { companyToday } from "../quality/prps.service.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { addMonths, dateOf, requireView } from "./environment-access.ts";
import { consumptionYear } from "./consumption.service.ts";
import { listCoolingUnits } from "./cooling.service.ts";

export interface DueItem {
  kind: "permit" | "obligation" | "contractor" | "storage" | "leak_check";
  id: string;
  name: string;
  dueOn: string;
}

export interface EnvironmentSummary {
  today: string;
  due: DueItem[];
  samplesOut: { id: string; permit: string; takenOn: string; outOfLimits: number }[];
  lastMonth: {
    month: string;
    meters: { name: string; unit: string; consumption: number | null; previous: number | null }[];
  };
}

/** Within this many days, an item counts as due soon. */
const WINDOW_DAYS = 60;

function addDays(day: string, days: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

export async function environmentSummary(ctx: AdminContext): Promise<EnvironmentSummary> {
  await requireView(ctx);
  const today = await companyToday(ctx.db);
  const limit = dateOf(addDays(today, WINDOW_DAYS));
  const [permits, obligations, contractors, wastes, samples, units] = await Promise.all([
    ctx.db.envPermit.findMany({
      where: {
        archivedAt: null,
        OR: [{ expiresOn: { lte: limit } }, { reviewOn: { lte: limit } }],
      },
      select: { id: true, name: true, expiresOn: true, reviewOn: true },
    }),
    ctx.db.envObligation.findMany({
      where: { archivedAt: null, nextDueOn: { lte: limit } },
      select: { id: true, name: true, nextDueOn: true },
    }),
    ctx.db.envContractor.findMany({
      where: { archivedAt: null, authorizationExpiresOn: { lte: limit } },
      select: { id: true, name: true, authorizationExpiresOn: true },
    }),
    ctx.db.envWaste.findMany({
      where: { archivedAt: null, storageSince: { not: null } },
      select: { id: true, name: true, storageSince: true, maxStorageMonths: true },
    }),
    ctx.db.envDischargeSample.findMany({
      where: { outOfLimits: { gt: 0 }, takenOn: { gte: dateOf(addDays(today, -180)) } },
      orderBy: [{ takenOn: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, permitId: true, takenOn: true, outOfLimits: true },
    }),
    listCoolingUnits(ctx, { archived: false }),
  ]);
  const due: DueItem[] = [
    ...permits.flatMap((row) => {
      const dates = [row.expiresOn, row.reviewOn].filter((date): date is Date => date !== null);
      if (dates.length === 0) return [];
      const first = dates.reduce((a, b) => (a < b ? a : b));
      return [{ kind: "permit" as const, id: row.id, name: row.name, dueOn: dayOf(first) }];
    }),
    ...obligations.map((row) => ({
      kind: "obligation" as const,
      id: row.id,
      name: row.name,
      dueOn: dayOf(row.nextDueOn),
    })),
    ...contractors.flatMap((row) =>
      row.authorizationExpiresOn === null
        ? []
        : [
            {
              kind: "contractor" as const,
              id: row.id,
              name: row.name,
              dueOn: dayOf(row.authorizationExpiresOn),
            },
          ],
    ),
    ...wastes.flatMap((row) => {
      if (row.storageSince === null) return [];
      const until = addMonths(dayOf(row.storageSince), row.maxStorageMonths);
      return until <= dayOf(limit)
        ? [{ kind: "storage" as const, id: row.id, name: row.name, dueOn: until }]
        : [];
    }),
    ...units.flatMap((unit) =>
      unit.nextCheckOn !== null && unit.nextCheckOn <= dayOf(limit)
        ? [{ kind: "leak_check" as const, id: unit.id, name: unit.name, dueOn: unit.nextCheckOn }]
        : [],
    ),
  ].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name));

  const permitNames = new Map(
    (
      await ctx.db.envPermit.findMany({
        where: { id: { in: [...new Set(samples.map((row) => row.permitId))] } },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row.name]),
  );

  // Last month (the company's), with the same month a year before.
  const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const year = await consumptionYear(ctx, Number(lastMonth.slice(0, 4)));
  return {
    today,
    due,
    samplesOut: samples.map((row) => ({
      id: row.id,
      permit: permitNames.get(row.permitId) ?? "",
      takenOn: dayOf(row.takenOn),
      outOfLimits: row.outOfLimits,
    })),
    lastMonth: {
      month: lastMonth,
      meters: year.meters.map((meter) => {
        const point = meter.months.find((entry) => entry.month === lastMonth);
        return {
          name: meter.meter.name,
          unit: meter.meter.unit,
          consumption: point?.consumption ?? null,
          previous: point?.previous ?? null,
        };
      }),
    },
  };
}
