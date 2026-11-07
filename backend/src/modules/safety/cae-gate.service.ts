// The CAE gatehouse (docs/spec/cae.md, «Portería»): whether a contractor's worker can come in, looked up
// by name, the last characters of their ID or their company, or by their QR. It answers only the name,
// company, task, authorized and the readable reasons (no documents, the ID cut to its last 3
// characters). Only `cae.check` (cae.manage includes it). Only negative answers are audited. With the
// company's access log on, the gate also records entries and exits (CaeAccess).
import QRCode from "qrcode";
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { dayIn, endOfDayIn, startOfDayIn, zoneOf } from "../../lib/time-zone.ts";
import { caeTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { workerStatuses } from "./cae-status.ts";
import type { AccessInput, ListAccessesQuery, CheckQuery } from "./cae.schemas.ts";
import { accessOf, loadWorker, maskedId } from "./cae.service.ts";
import { canCheckCae, requireCae } from "./safety-access.ts";

export interface GateResult {
  id: string;
  name: string;
  idNumber: string | null;
  task: string | null;
  company: { id: string; name: string };
  authorized: boolean;
  reasons: string[];
  /** The company records entries and exits: the gate offers to record them. */
  accessLog: boolean;
  /** The last one recorded today, if the log is on. */
  lastAccess: { direction: "IN" | "OUT"; at: Date } | null;
}

const gateSelect = {
  id: true,
  companyId: true,
  name: true,
  idNumber: true,
  task: true,
  blockedAt: true,
  blockedReason: true,
  archivedAt: true,
  company: { select: { id: true, name: true } },
} as const;

type GateWorker = Prisma.CaeWorkerGetPayload<{ select: typeof gateSelect }>;

/** CAE on and the person checks it; returns whether the access log is on. */
async function requireChecker(ctx: AdminContext): Promise<{ accessLog: boolean }> {
  const settings = await requireCae(ctx);
  if (!canCheckCae(ctx)) throw forbidden();
  return { accessLog: settings.cae.accessLog };
}

async function todayRange(ctx: AdminContext, day?: string) {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const zone = zoneOf(workspace?.settings);
  const which = day ?? dayIn(new Date(), zone);
  return { day: which, from: startOfDayIn(which, zone), to: endOfDayIn(which, zone) };
}

async function results(
  ctx: AdminContext,
  rows: GateWorker[],
  accessLog: boolean,
): Promise<GateResult[]> {
  const statuses = await workerStatuses(ctx, rows);
  const range = accessLog ? await todayRange(ctx) : null;
  const last =
    range === null || rows.length === 0
      ? []
      : await ctx.db.caeAccess.findMany({
          where: { workerId: { in: rows.map((row) => row.id) }, at: { gte: range.from } },
          select: { workerId: true, direction: true, at: true },
          orderBy: [{ at: "desc" }, { id: "desc" }],
        });
  const lastOf = new Map<string, { direction: "IN" | "OUT"; at: Date }>();
  for (const access of last) {
    if (!lastOf.has(access.workerId)) {
      lastOf.set(access.workerId, { direction: access.direction, at: access.at });
    }
  }
  return rows.map((row) => {
    const status = statuses.get(row.id);
    return {
      id: row.id,
      name: row.name,
      idNumber: row.idNumber === null ? null : maskedId(row.idNumber),
      task: row.task,
      company: row.company,
      authorized: status?.authorized ?? false,
      reasons: status?.reasons ?? [],
      accessLog,
      lastAccess: lastOf.get(row.id) ?? null,
    };
  });
}

/** The gate's search: active workers by name, the end of their ID or their company's name. */
export async function searchGate(ctx: AdminContext, query: CheckQuery): Promise<Page<GateResult>> {
  const { accessLog } = await requireChecker(ctx);
  const q = query.q;
  const where: Prisma.CaeWorkerWhereInput = {
    archivedAt: null,
    company: { is: { archivedAt: null } },
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { idNumber: { endsWith: q, mode: "insensitive" } },
      { company: { is: { name: { contains: q, mode: "insensitive" } } } },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.caeWorker.findMany({
      where,
      select: gateSelect,
      orderBy: stableOrder({ name: "asc" as const }),
      ...offsetArgs(query),
    }),
    ctx.db.caeWorker.count({ where }),
  ]);
  return pageOf(await results(ctx, rows, accessLog), total, query);
}

/** One worker at the gate (from the search or their QR). A negative answer is audited. */
export async function checkWorker(ctx: AdminContext, workerId: string): Promise<GateResult> {
  const { accessLog } = await requireChecker(ctx);
  const row = await ctx.db.caeWorker.findFirst({ where: { id: workerId }, select: gateSelect });
  if (row === null) throw notFound();
  const [result] = await results(ctx, [row], accessLog);
  if (result === undefined) throw notFound();
  if (!result.authorized) {
    await auditAdmin(ctx, {
      action: "cae.check.denied",
      entityType: "CaeWorker",
      entityId: row.id,
      metadata: { name: row.name, companyId: row.companyId, reasons: result.reasons },
    });
  }
  return result;
}

// ─── Access log ──────────────────────────────────────────────────────────────────────────

export interface AccessView {
  id: string;
  at: Date;
  direction: "IN" | "OUT";
  authorized: boolean;
  reasons: string[];
  worker: { id: string; name: string };
  company: { id: string; name: string };
  by: { id: string; name: string };
}

const accessSelect = {
  id: true,
  at: true,
  direction: true,
  authorized: true,
  reasons: true,
  createdById: true,
  worker: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
} as const;

type AccessRecord = Prisma.CaeAccessGetPayload<{ select: typeof accessSelect }>;

async function accessViews(ctx: AdminContext, rows: AccessRecord[]): Promise<AccessView[]> {
  const ids = [...new Set(rows.map((row) => row.createdById))];
  const members =
    ids.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { id: { in: ids } },
          select: { id: true, user: { select: { name: true } } },
        });
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    direction: row.direction,
    authorized: row.authorized,
    reasons: row.reasons,
    worker: row.worker,
    company: row.company,
    by: { id: row.createdById, name: nameOf.get(row.createdById) ?? "" },
  }));
}

/** Records an entry or an exit. Someone not authorized can't be let in (an exit always records). */
export async function recordAccess(ctx: AdminContext, input: AccessInput): Promise<GateResult> {
  const { accessLog } = await requireChecker(ctx);
  if (!accessLog) throw new AppError("BAD_REQUEST", { message: caeTexts.messages.accessLogOff });
  const row = await ctx.db.caeWorker.findFirst({
    where: { id: input.workerId },
    select: gateSelect,
  });
  if (row === null) throw notFound();
  const [result] = await results(ctx, [row], accessLog);
  if (result === undefined) throw notFound();
  if (input.direction === "IN" && !result.authorized) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.deniedIn });
  }
  await ctx.db.caeAccess.create({
    data: {
      workerId: row.id,
      companyId: row.companyId,
      direction: input.direction,
      authorized: result.authorized,
      reasons: result.reasons,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  const [after] = await results(ctx, [row], accessLog);
  return after ?? result;
}

/** A day's entries and exits (today by default), newest first; optionally one company's. */
export async function listAccesses(
  ctx: AdminContext,
  query: ListAccessesQuery,
): Promise<Page<AccessView> & { day: string }> {
  await requireChecker(ctx);
  const range = await todayRange(ctx, query.day);
  const where: Prisma.CaeAccessWhereInput = {
    at: { gte: range.from, lte: range.to },
    ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.caeAccess.findMany({
      where,
      select: accessSelect,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      ...offsetArgs(query),
    }),
    ctx.db.caeAccess.count({ where }),
  ]);
  return { ...pageOf(await accessViews(ctx, rows), total, query), day: range.day };
}

// ─── Worker's QR ─────────────────────────────────────────────────────────────────────────

/**
 * The worker's QR: the app's gate with them chosen. Opening it needs to be signed in with cae.check;
 * the code itself carries no data about them.
 */
export async function workerQr(
  ctx: AdminContext,
  appUrl: string,
  workerId: string,
): Promise<{ url: string; qr: string }> {
  await requireCae(ctx);
  const access = await accessOf(ctx);
  const worker = await loadWorker(ctx, access, workerId);
  const url = `${appUrl.replace(/\/$/u, "")}/app/${ctx.tenant.workspaceSlug}/seguridad/cae/porteria?trabajador=${encodeURIComponent(worker.id)}`;
  return {
    url,
    qr: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 320 }),
  };
}
