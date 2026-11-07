// The Quality dashboard (docs/spec/calidad.md, «Fase 6a»): one page with the figures of every part of
// the module (nonconformities, HACCP, suppliers, complaints, audits and prerequisites) for quality.view.
import { forbidden } from "../../lib/errors.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { canViewQuality, requireQuality } from "./quality-access.ts";
import { auditCoverage } from "./audits.service.ts";
import { companyToday } from "./prps.service.ts";

const SOON_DAYS = 30;
const AUDIT_DAYS = 60;
const WINDOW_DAYS = 30;
const FINAL = ["CLOSED", "CANCELLED"] as const;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function addDays(day: string, days: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

export interface QualityDashboard {
  ncs: {
    bySeverity: Record<"MINOR" | "MAJOR" | "CRITICAL", number>;
    byOrigin: { origin: string; count: number }[];
    overdueActions: number;
    verificationsDue: number;
    /** Average days from opening to closing, of the NCs closed in the last 12 months. */
    averageCloseDays: number | null;
  };
  haccp: { records: number; outOfLimits: number; holdsPending: number };
  suppliers: { docsExpired: number; docsExpiring: number; reviewsOverdue: number };
  complaints: { open: number; overdue: number; perMillion: number | null; year: number };
  audits: {
    upcoming: { id: string; title: string; scheme: string; plannedOn: string }[];
    coverage: { standard: "IFS8" | "BRCGS9"; covered: number; chapters: number }[];
  };
  prps: { overdue: number; dueSoon: number; nonConforming: number };
}

export async function qualityDashboard(ctx: AdminContext): Promise<QualityDashboard> {
  await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
  const day = await companyToday(ctx.db);
  const today = dateOf(day);
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const sinceDay = dateOf(addDays(day, -WINDOW_DAYS));
  const year = Number(day.slice(0, 4));
  const open = { status: { notIn: [...FINAL] } };
  const ccpForms = await ctx.db.qualityCcp.findMany({
    where: { archivedAt: null, formId: { not: null } },
    select: { formId: true },
    take: 200,
  });
  const formIds = ccpForms.map((row) => row.formId).filter((id): id is string => id !== null);
  const [
    bySeverity,
    byOrigin,
    overdueActions,
    verificationsDue,
    closed,
    records,
    outOfLimits,
    holdsPending,
    docsExpired,
    docsExpiring,
    reviewsOverdue,
    complaintsOpen,
    complaintsOverdue,
    upcoming,
    coverage,
    prpsOverdue,
    prpsDueSoon,
    prpsNonConforming,
  ] = await Promise.all([
    ctx.db.qualityNc.groupBy({ by: ["severity"], where: open, _count: { _all: true } }),
    ctx.db.qualityNc.groupBy({ by: ["origin"], where: open, _count: { _all: true } }),
    ctx.db.qualityAction.count({ where: { doneAt: null, dueOn: { lt: today }, nc: open } }),
    ctx.db.qualityNc.count({ where: { status: "VERIFICATION", verifyOn: { lte: today } } }),
    ctx.db.qualityNc.findMany({
      where: { status: "CLOSED", closedAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
      select: { createdAt: true, closedAt: true },
      take: 5000,
    }),
    formIds.length === 0
      ? Promise.resolve(0)
      : ctx.db.formRecord.count({
          where: { nodeId: { in: formIds }, voidedAt: null, submittedAt: { gte: since } },
        }),
    formIds.length === 0
      ? Promise.resolve(0)
      : ctx.db.formRecord.count({
          where: {
            nodeId: { in: formIds },
            voidedAt: null,
            submittedAt: { gte: since },
            NOT: { nonConforming: { isEmpty: true } },
          },
        }),
    ctx.db.qualityHold.count({ where: { status: "HELD" } }),
    ctx.db.qualitySupplierDoc.count({
      where: { archivedAt: null, validUntil: { lt: today }, supplier: { archivedAt: null } },
    }),
    ctx.db.qualitySupplierDoc.count({
      where: {
        archivedAt: null,
        validUntil: { gte: today, lte: dateOf(addDays(day, SOON_DAYS)) },
        supplier: { archivedAt: null },
      },
    }),
    ctx.db.qualitySupplier.count({ where: { archivedAt: null, nextReviewOn: { lt: today } } }),
    ctx.db.qualityComplaint.count({ where: { status: "OPEN" } }),
    ctx.db.qualityComplaint.count({ where: { status: "OPEN", respondBy: { lt: today } } }),
    ctx.db.qualityAudit.findMany({
      where: {
        status: "PLANNED",
        plannedOn: { gte: today, lte: dateOf(addDays(day, AUDIT_DAYS)) },
      },
      select: { id: true, title: true, scheme: true, plannedOn: true },
      orderBy: [{ plannedOn: "asc" }, { id: "asc" }],
      take: 10,
    }),
    auditCoverage(ctx, year),
    ctx.db.qualityPrp.count({ where: { archivedAt: null, nextDueOn: { lt: today } } }),
    ctx.db.qualityPrp.count({
      where: { archivedAt: null, nextDueOn: { gte: today, lte: dateOf(addDays(day, 7)) } },
    }),
    ctx.db.qualityPrpCheck.count({ where: { conforming: false, doneOn: { gte: sinceDay } } }),
  ]);
  const severity = { MINOR: 0, MAJOR: 0, CRITICAL: 0 };
  for (const row of bySeverity) severity[row.severity] = row._count._all;
  const closeDays = closed
    .filter((row) => row.closedAt !== null)
    .map((row) => ((row.closedAt?.getTime() ?? 0) - row.createdAt.getTime()) / 86_400_000);
  const perMillion = await yearPerMillion(ctx, year);
  return {
    ncs: {
      bySeverity: severity,
      byOrigin: byOrigin
        .map((row) => ({ origin: row.origin, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      overdueActions,
      verificationsDue,
      averageCloseDays:
        closeDays.length === 0
          ? null
          : Math.round((closeDays.reduce((sum, days) => sum + days, 0) / closeDays.length) * 10) /
            10,
    },
    haccp: { records, outOfLimits, holdsPending },
    suppliers: { docsExpired, docsExpiring, reviewsOverdue },
    complaints: { open: complaintsOpen, overdue: complaintsOverdue, perMillion, year },
    audits: {
      upcoming: upcoming.map((audit) => ({
        id: audit.id,
        title: audit.title,
        scheme: audit.scheme,
        plannedOn: dayOf(audit.plannedOn),
      })),
      coverage: coverage.map((row) => ({
        standard: row.standard,
        covered: row.chapters.filter((chapter) => chapter.audits.length > 0).length,
        chapters: row.chapters.length,
      })),
    },
    prps: { overdue: prpsOverdue, dueSoon: prpsDueSoon, nonConforming: prpsNonConforming },
  };
}

/** The year's complaints per million units, over the months with units sold loaded. */
async function yearPerMillion(ctx: AdminContext, year: number): Promise<number | null> {
  const from = dateOf(`${String(year)}-01-01`);
  const to = dateOf(`${String(year)}-12-31`);
  const units = await ctx.db.qualityMonthUnits.findMany({
    where: { month: { gte: from, lte: to } },
    select: { month: true, units: true },
  });
  const sold = units.reduce((sum, row) => sum + row.units, 0);
  if (sold === 0) return null;
  const months = units.map((row) => dayOf(row.month).slice(0, 7));
  const complaints = await ctx.db.qualityComplaint.findMany({
    where: { receivedOn: { gte: from, lte: to } },
    select: { receivedOn: true },
    take: 20_000,
  });
  const counted = complaints.filter((row) => months.includes(dayOf(row.receivedOn).slice(0, 7)));
  return Math.round((counted.length * 1_000_000 * 100) / sold) / 100;
}
