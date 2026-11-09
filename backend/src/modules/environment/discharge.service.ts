// Discharges (docs/spec/medio-ambiente.md, section 3): a discharge permit's limits per parameter and the
// analyses compared with them. A value out of its limit is shown in red and whoever manages the module is
// told; with the quality module on, a nonconformity can be opened from the analysis.
import { environmentLimits } from "@spiderfolio/limits";
import { z } from "zod";
import type { TenantDb } from "../../db/tenant.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { environmentTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { companyToday } from "../quality/prps.service.ts";
import { reportNc } from "../quality/ncs.service.ts";
import {
  canManageEnvironment,
  dateOf,
  environmentManagers,
  requireCatalog,
  requireManage,
  requireRecord,
  requireView,
} from "./environment-access.ts";

export interface LimitInput {
  parameter: string;
  unit: string;
  min: number | null;
  max: number | null;
}

export interface LimitView extends LimitInput {
  id: string;
}

export interface SampleValue {
  parameter: string;
  value: number;
}

export interface EvaluatedValue extends SampleValue {
  unit: string;
  min: number | null;
  max: number | null;
  /** Out of its limit (false when the parameter has no limit). */
  out: boolean;
}

export interface SampleView {
  id: string;
  permit: { id: string; name: string };
  takenOn: string;
  point: string;
  laboratory: string;
  notes: string;
  values: EvaluatedValue[];
  outOfLimits: number;
  ncId: string | null;
  recordedBy: string;
}

export interface SampleInput {
  permitId: string;
  takenOn: string;
  point: string;
  laboratory: string;
  notes: string;
  values: SampleValue[];
}

const ValuesSchema = z.array(z.object({ parameter: z.string(), value: z.number() }));

const num = (value: { toNumber: () => number } | null): number | null =>
  value === null ? null : value.toNumber();

/** The DISCHARGE permit, else 404. */
async function dischargePermit(db: TenantDb, id: string) {
  const permit = await db.envPermit.findFirst({
    where: { id, kind: "DISCHARGE" },
    select: { id: true, name: true },
  });
  if (permit === null) throw notFound();
  return permit;
}

async function limitsOf(db: TenantDb, permitIds: string[]): Promise<Map<string, LimitView[]>> {
  const rows = await db.envDischargeLimit.findMany({
    where: { permitId: { in: permitIds } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, permitId: true, parameter: true, unit: true, min: true, max: true },
  });
  const out = new Map<string, LimitView[]>();
  for (const row of rows) {
    const list = out.get(row.permitId) ?? [];
    list.push({
      id: row.id,
      parameter: row.parameter,
      unit: row.unit,
      min: num(row.min),
      max: num(row.max),
    });
    out.set(row.permitId, list);
  }
  return out;
}

const keyOf = (parameter: string) => parameter.trim().toLowerCase();

function evaluate(values: SampleValue[], limits: LimitView[]): EvaluatedValue[] {
  const byKey = new Map(limits.map((limit) => [keyOf(limit.parameter), limit]));
  return values.map((entry) => {
    const limit = byKey.get(keyOf(entry.parameter));
    const min = limit?.min ?? null;
    const max = limit?.max ?? null;
    return {
      parameter: limit?.parameter ?? entry.parameter,
      value: entry.value,
      unit: limit?.unit ?? "",
      min,
      max,
      out: (min !== null && entry.value < min) || (max !== null && entry.value > max),
    };
  });
}

/** The discharge permits with their limits. */
export async function listDischargePermits(
  ctx: AdminContext,
): Promise<{ id: string; name: string; reference: string; limits: LimitView[] }[]> {
  await requireCatalog(ctx);
  const permits = await ctx.db.envPermit.findMany({
    where: { kind: "DISCHARGE", archivedAt: null },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, reference: true },
  });
  const limits = await limitsOf(
    ctx.db,
    permits.map((permit) => permit.id),
  );
  return permits.map((permit) => ({ ...permit, limits: limits.get(permit.id) ?? [] }));
}

/** Replaces a discharge permit's limits. */
export async function setDischargeLimits(
  ctx: AdminContext,
  permitId: string,
  limits: LimitInput[],
): Promise<LimitView[]> {
  await requireManage(ctx);
  await dischargePermit(ctx.db, permitId);
  await ctx.db.$transaction(async (tx) => {
    await tx.envDischargeLimit.deleteMany({ where: { permitId } });
    for (const [position, limit] of limits.entries()) {
      await tx.envDischargeLimit.create({
        data: { permitId, position, ...limit },
        select: { id: true },
      });
    }
  });
  await auditAdmin(ctx, {
    action: "environment.discharge.limits",
    entityType: "EnvPermit",
    entityId: permitId,
    metadata: { parameters: limits.map((limit) => limit.parameter).join(", ") },
  });
  return (await limitsOf(ctx.db, [permitId])).get(permitId) ?? [];
}

const sampleSelect = {
  id: true,
  permitId: true,
  takenOn: true,
  point: true,
  laboratory: true,
  notes: true,
  values: true,
  outOfLimits: true,
  ncId: true,
  recordedById: true,
} as const;

type SampleRow = {
  id: string;
  permitId: string;
  takenOn: Date;
  point: string;
  laboratory: string;
  notes: string;
  values: unknown;
  outOfLimits: number;
  ncId: string | null;
  recordedById: string;
};

async function sampleViews(db: TenantDb, rows: SampleRow[]): Promise<SampleView[]> {
  const permitIds = [...new Set(rows.map((row) => row.permitId))];
  const [permits, limits, people] = await Promise.all([
    db.envPermit.findMany({ where: { id: { in: permitIds } }, select: { id: true, name: true } }),
    limitsOf(db, permitIds),
    db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.recordedById))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  const permitName = new Map(permits.map((permit) => [permit.id, permit.name]));
  const who = new Map(people.map((person) => [person.id, person.user.name]));
  return rows.map((row) => {
    const parsed = ValuesSchema.safeParse(row.values);
    const values = evaluate(parsed.success ? parsed.data : [], limits.get(row.permitId) ?? []);
    return {
      id: row.id,
      permit: { id: row.permitId, name: permitName.get(row.permitId) ?? "" },
      takenOn: dayOf(row.takenOn),
      point: row.point,
      laboratory: row.laboratory,
      notes: row.notes,
      values,
      outOfLimits: values.filter((value) => value.out).length,
      ncId: row.ncId,
      recordedBy: who.get(row.recordedById) ?? "",
    };
  });
}

/** The analyses of the last months, newest first (for the list and the chart). */
export async function listSamples(
  ctx: AdminContext,
  query: { permitId?: string | undefined },
): Promise<SampleView[]> {
  await requireView(ctx);
  const rows = await ctx.db.envDischargeSample.findMany({
    where: query.permitId === undefined ? {} : { permitId: query.permitId },
    orderBy: [{ takenOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: environmentLimits.samplesShown,
    select: sampleSelect,
  });
  return await sampleViews(ctx.db, rows);
}

export async function createSample(ctx: AdminContext, input: SampleInput): Promise<SampleView> {
  await requireRecord(ctx);
  await dischargePermit(ctx.db, input.permitId);
  const today = await companyToday(ctx.db);
  const takenOn = input.takenOn > today ? today : input.takenOn;
  const limits = (await limitsOf(ctx.db, [input.permitId])).get(input.permitId) ?? [];
  const out = evaluate(input.values, limits).filter((value) => value.out).length;
  const row = await ctx.db.envDischargeSample.create({
    data: {
      permitId: input.permitId,
      takenOn: dateOf(takenOn),
      point: input.point,
      laboratory: input.laboratory,
      notes: input.notes,
      values: input.values.map((entry) => ({ parameter: entry.parameter, value: entry.value })),
      outOfLimits: out,
      recordedById: ctx.tenant.membershipId,
    },
    select: sampleSelect,
  });
  await auditAdmin(ctx, {
    action: "environment.discharge.sample",
    entityType: "EnvDischargeSample",
    entityId: row.id,
    metadata: { takenOn, outOfLimits: out },
  });
  if (out > 0) {
    for (const membershipId of await environmentManagers(ctx.db)) {
      if (membershipId === ctx.tenant.membershipId) continue;
      await ctx.db.notification.create({
        data: {
          membershipId,
          kind: "environment_discharge",
          actorId: ctx.tenant.membershipId,
          detail: row.id,
        },
        select: { id: true },
      });
    }
  }
  return (await sampleViews(ctx.db, [row]))[0] as SampleView;
}

export async function deleteSample(ctx: AdminContext, id: string): Promise<void> {
  await requireManage(ctx);
  const row = await ctx.db.envDischargeSample.findFirst({
    where: { id },
    select: { takenOn: true },
  });
  if (row === null) throw notFound();
  await ctx.db.envDischargeSample.delete({ where: { id }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "environment.discharge.sample.delete",
    entityType: "EnvDischargeSample",
    entityId: id,
    metadata: { takenOn: dayOf(row.takenOn) },
  });
}

/**
 * Opens a quality nonconformity from an analysis out of its limits (with the quality module on; the
 * quality module checks who may report one). Once: the analysis keeps the nonconformity's id.
 */
export async function openNcFromSample(ctx: AdminContext, id: string): Promise<{ ncId: string }> {
  await requireView(ctx);
  if (!canManageEnvironment(ctx)) {
    throw new AppError("FORBIDDEN");
  }
  const [sample] = await sampleViews(ctx.db, [
    await ctx.db.envDischargeSample
      .findFirst({ where: { id }, select: sampleSelect })
      .then((row) => {
        if (row === null) throw notFound();
        return row;
      }),
  ]);
  if (sample === undefined) throw notFound();
  if (sample.ncId !== null) return { ncId: sample.ncId };
  const t = environmentTexts.discharge;
  const outValues = sample.values.filter((value) => value.out);
  const nc = await reportNc(ctx, {
    title: t.ncTitle(sample.permit.name).slice(0, 160),
    description: [
      t.ncIntro(sample.takenOn, sample.point, sample.laboratory),
      ...outValues.map((value) =>
        t.ncLine(value.parameter, value.value, value.unit, value.min, value.max),
      ),
    ].join("\n"),
    detectedOn: sample.takenOn,
    location: sample.point === "" ? null : sample.point.slice(0, 120),
    productAffected: false,
    productNote: null,
    correction: null,
  });
  await ctx.db.envDischargeSample.update({
    where: { id },
    data: { ncId: nc.id },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "environment.discharge.nc",
    entityType: "EnvDischargeSample",
    entityId: id,
    metadata: { ncId: nc.id },
  });
  return { ncId: nc.id };
}
