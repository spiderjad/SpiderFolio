// Cooling units and fluorinated gases (docs/spec/medio-ambiente.md, section 5): each unit's refrigerant
// and charge give its CO2 equivalent and its leak check period (Regulation (EU) 2024/573); its log of
// leak checks, recharges and recoveries; and the notice of the next check.
import { environmentLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type { EnvCoolingEventKind } from "../../generated/prisma/enums.ts";
import { notFound } from "../../lib/errors.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { companyToday } from "../quality/prps.service.ts";
import {
  addMonths,
  dateOf,
  environmentManagers,
  requireCatalog,
  requireManage,
  requireRecord,
} from "./environment-access.ts";

export const LEAK_CHECK_EXPIRY = "environment.leak_check";

/**
 * Reference global warming potentials (IPCC AR4, the values of the F-gas regulations' annexes), for the
 * usual refrigerants. Editable on each unit: «other» or a blend not listed takes the one typed.
 */
export const REFRIGERANT_GWP: Readonly<Record<string, number>> = {
  "R-404A": 3922,
  "R-507A": 3985,
  "R-410A": 2088,
  "R-407C": 1774,
  "R-407F": 1825,
  "R-422D": 2729,
  "R-134a": 1430,
  "R-448A": 1387,
  "R-449A": 1397,
  "R-452A": 2140,
  "R-513A": 631,
  "R-32": 675,
  "R-1234yf": 4,
  "R-1234ze": 7,
  "R-290": 3,
  "R-744": 1,
  "R-717": 0,
};

/** Natural refrigerants (ammonia, CO2, hydrocarbons): not fluorinated gases. */
const NATURAL = new Set(["R-717", "R-744", "R-290", "R-600A", "R-1270"]);

export interface CoolingFacts {
  /** Tonnes of CO2 equivalent: charge × GWP / 1000. */
  co2Tonnes: number;
  fluorinated: boolean;
  /** Months between leak checks; null when none is required. */
  checkEveryMonths: number | null;
  /** GWP ≥ 2500 and ≥ 40 t CO2e: servicing restrictions apply. */
  restricted: boolean;
}

/** The leak check period: 5 to 50 t, 12 months; 50 to 500, 6; from 500, 3; twice with leak detection. */
export function coolingFacts(input: {
  refrigerant: string;
  chargeKg: number;
  gwp: number;
  leakDetection: boolean;
}): CoolingFacts {
  const co2Tonnes = Math.round(((input.chargeKg * input.gwp) / 1000) * 100) / 100;
  const fluorinated = !NATURAL.has(input.refrigerant.trim().toUpperCase());
  const base = !fluorinated || co2Tonnes < 5 ? null : co2Tonnes < 50 ? 12 : co2Tonnes < 500 ? 6 : 3;
  return {
    co2Tonnes,
    fluorinated,
    checkEveryMonths: base === null ? null : input.leakDetection ? base * 2 : base,
    restricted: fluorinated && input.gwp >= 2500 && co2Tonnes >= 40,
  };
}

export interface CoolingUnitView extends CoolingFacts {
  id: string;
  name: string;
  location: string;
  refrigerant: string;
  chargeKg: number;
  gwp: number;
  leakDetection: boolean;
  installer: string;
  installedOn: string | null;
  lastCheckOn: string | null;
  nextCheckOn: string | null;
  archived: boolean;
}

export interface CoolingUnitInput {
  name: string;
  location: string;
  refrigerant: string;
  chargeKg: number;
  gwp: number | null;
  leakDetection: boolean;
  installer: string;
  installedOn: string | null;
}

export interface CoolingEventView {
  id: string;
  date: string;
  kind: EnvCoolingEventKind;
  kgAdded: number | null;
  kgRecovered: number | null;
  leakFound: boolean | null;
  company: string;
  certificateRef: string;
  notes: string;
  recordedBy: string;
}

export interface CoolingEventInput {
  unitId: string;
  date: string;
  kind: EnvCoolingEventKind;
  kgAdded: number | null;
  kgRecovered: number | null;
  leakFound: boolean | null;
  company: string;
  certificateRef: string;
  notes: string;
}

const unitSelect = {
  id: true,
  name: true,
  location: true,
  refrigerant: true,
  chargeKg: true,
  gwp: true,
  leakDetection: true,
  installer: true,
  installedOn: true,
  archivedAt: true,
  createdAt: true,
} as const;

type UnitRow = {
  id: string;
  name: string;
  location: string;
  refrigerant: string;
  chargeKg: { toNumber: () => number };
  gwp: number;
  leakDetection: boolean;
  installer: string;
  installedOn: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
};

async function lastChecks(db: TenantDb, unitIds: string[]): Promise<Map<string, string>> {
  if (unitIds.length === 0) return new Map();
  const rows = await db.envCoolingEvent.findMany({
    where: { unitId: { in: unitIds }, kind: "LEAK_CHECK" },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { unitId: true, date: true },
  });
  const out = new Map<string, string>();
  for (const row of rows) if (!out.has(row.unitId)) out.set(row.unitId, dayOf(row.date));
  return out;
}

function viewOf(row: UnitRow, lastCheckOn: string | null): CoolingUnitView {
  const chargeKg = row.chargeKg.toNumber();
  const facts = coolingFacts({
    refrigerant: row.refrigerant,
    chargeKg,
    gwp: row.gwp,
    leakDetection: row.leakDetection,
  });
  const from =
    lastCheckOn ?? (row.installedOn === null ? dayOf(row.createdAt) : dayOf(row.installedOn));
  return {
    ...facts,
    id: row.id,
    name: row.name,
    location: row.location,
    refrigerant: row.refrigerant,
    chargeKg,
    gwp: row.gwp,
    leakDetection: row.leakDetection,
    installer: row.installer,
    installedOn: row.installedOn === null ? null : dayOf(row.installedOn),
    lastCheckOn,
    nextCheckOn:
      facts.checkEveryMonths === null || row.archivedAt !== null
        ? null
        : addMonths(from, facts.checkEveryMonths),
    archived: row.archivedAt !== null,
  };
}

async function syncCheckExpiry(db: TenantDb, view: CoolingUnitView): Promise<void> {
  if (view.nextCheckOn === null) {
    await resolveExpiry(db, LEAK_CHECK_EXPIRY, view.id);
    return;
  }
  await setExpiry(db, {
    kind: LEAK_CHECK_EXPIRY,
    subjectId: view.id,
    dueOn: view.nextCheckOn,
    responsibleId: (await environmentManagers(db))[0] ?? null,
    noticeDays: [...environmentLimits.storageNoticeDays],
  });
}

async function unitView(db: TenantDb, id: string): Promise<CoolingUnitView> {
  const row = await db.envCoolingUnit.findFirst({ where: { id }, select: unitSelect });
  if (row === null) throw notFound();
  return viewOf(row, (await lastChecks(db, [id])).get(id) ?? null);
}

export async function listCoolingUnits(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<CoolingUnitView[]> {
  await requireCatalog(ctx);
  const rows = await ctx.db.envCoolingUnit.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: unitSelect,
  });
  const checks = await lastChecks(
    ctx.db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => viewOf(row, checks.get(row.id) ?? null));
}

const gwpOf = (input: CoolingUnitInput): number =>
  input.gwp ?? REFRIGERANT_GWP[input.refrigerant] ?? 0;

export async function createCoolingUnit(
  ctx: AdminContext,
  input: CoolingUnitInput,
): Promise<CoolingUnitView> {
  await requireManage(ctx);
  const row = await ctx.db.envCoolingUnit.create({
    data: {
      name: input.name,
      location: input.location,
      refrigerant: input.refrigerant,
      chargeKg: input.chargeKg,
      gwp: gwpOf(input),
      leakDetection: input.leakDetection,
      installer: input.installer,
      installedOn: input.installedOn === null ? null : dateOf(input.installedOn),
    },
    select: { id: true },
  });
  const view = await unitView(ctx.db, row.id);
  await syncCheckExpiry(ctx.db, view);
  await auditAdmin(ctx, {
    action: "environment.cooling.create",
    entityType: "EnvCoolingUnit",
    entityId: row.id,
    metadata: { name: view.name, refrigerant: view.refrigerant, co2Tonnes: view.co2Tonnes },
  });
  return view;
}

export async function updateCoolingUnit(
  ctx: AdminContext,
  id: string,
  input: CoolingUnitInput & { archived?: boolean | undefined },
): Promise<CoolingUnitView> {
  await requireManage(ctx);
  const exists = await ctx.db.envCoolingUnit.findFirst({ where: { id }, select: { id: true } });
  if (exists === null) throw notFound();
  await ctx.db.envCoolingUnit.update({
    where: { id },
    data: {
      name: input.name,
      location: input.location,
      refrigerant: input.refrigerant,
      chargeKg: input.chargeKg,
      gwp: gwpOf(input),
      leakDetection: input.leakDetection,
      installer: input.installer,
      installedOn: input.installedOn === null ? null : dateOf(input.installedOn),
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
    },
    select: { id: true },
  });
  const view = await unitView(ctx.db, id);
  await syncCheckExpiry(ctx.db, view);
  await auditAdmin(ctx, {
    action: input.archived === true ? "environment.cooling.archive" : "environment.cooling.update",
    entityType: "EnvCoolingUnit",
    entityId: id,
    metadata: { name: view.name, refrigerant: view.refrigerant, co2Tonnes: view.co2Tonnes },
  });
  return view;
}

export async function listCoolingEvents(
  ctx: AdminContext,
  unitId: string,
): Promise<CoolingEventView[]> {
  await requireCatalog(ctx);
  const rows = await ctx.db.envCoolingEvent.findMany({
    where: { unitId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 300,
    select: {
      id: true,
      date: true,
      kind: true,
      kgAdded: true,
      kgRecovered: true,
      leakFound: true,
      company: true,
      certificateRef: true,
      notes: true,
      recordedById: true,
    },
  });
  const people = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.recordedById))] } },
    select: { id: true, user: { select: { name: true } } },
  });
  const who = new Map(people.map((person) => [person.id, person.user.name]));
  return rows.map((row) => ({
    id: row.id,
    date: dayOf(row.date),
    kind: row.kind,
    kgAdded: row.kgAdded === null ? null : row.kgAdded.toNumber(),
    kgRecovered: row.kgRecovered === null ? null : row.kgRecovered.toNumber(),
    leakFound: row.leakFound,
    company: row.company,
    certificateRef: row.certificateRef,
    notes: row.notes,
    recordedBy: who.get(row.recordedById) ?? "",
  }));
}

/** A leak check, recharge, recovery, repair or inspection; a leak check moves the next one. */
export async function createCoolingEvent(
  ctx: AdminContext,
  input: CoolingEventInput,
): Promise<CoolingUnitView> {
  await requireRecord(ctx);
  const unit = await ctx.db.envCoolingUnit.findFirst({
    where: { id: input.unitId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (unit === null) throw notFound();
  const today = await companyToday(ctx.db);
  const date = input.date > today ? today : input.date;
  await ctx.db.envCoolingEvent.create({
    data: {
      unitId: unit.id,
      date: dateOf(date),
      kind: input.kind,
      kgAdded: input.kgAdded,
      kgRecovered: input.kgRecovered,
      leakFound: input.kind === "LEAK_CHECK" ? (input.leakFound ?? false) : input.leakFound,
      company: input.company,
      certificateRef: input.certificateRef,
      notes: input.notes,
      recordedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  const view = await unitView(ctx.db, unit.id);
  await syncCheckExpiry(ctx.db, view);
  await auditAdmin(ctx, {
    action: "environment.cooling.event",
    entityType: "EnvCoolingUnit",
    entityId: unit.id,
    metadata: { kind: input.kind, date, kgAdded: input.kgAdded, kgRecovered: input.kgRecovered },
  });
  return view;
}

export async function deleteCoolingEvent(ctx: AdminContext, id: string): Promise<void> {
  await requireManage(ctx);
  const row = await ctx.db.envCoolingEvent.findFirst({
    where: { id },
    select: { unitId: true, kind: true, date: true },
  });
  if (row === null) throw notFound();
  await ctx.db.envCoolingEvent.delete({ where: { id }, select: { id: true } });
  await syncCheckExpiry(ctx.db, await unitView(ctx.db, row.unitId));
  await auditAdmin(ctx, {
    action: "environment.cooling.event.delete",
    entityType: "EnvCoolingUnit",
    entityId: row.unitId,
    metadata: { kind: row.kind, date: dayOf(row.date) },
  });
}
