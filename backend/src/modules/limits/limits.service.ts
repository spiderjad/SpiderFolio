// Límites de la empresa (docs/spec/limites.md). Sin planes: por defecto no hay ninguno y el
// administrador fija los que quiera (almacenamiento, tamaño de archivo, versiones guardadas,
// retención de la auditoría y total mensual de Bian). Se guardan en Workspace.limits.
import {
  bytesToJson,
  checkLimit,
  limitInBaseUnits,
  limitKeys,
  resolveLimits,
  type LimitKey,
  type Limits,
  type LimitUsage,
  type StoredLimits,
} from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import { AppError } from "../../lib/errors.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";

export async function workspaceLimits(db: TenantDb): Promise<Limits> {
  const workspace = await db.workspace.findUnique({
    where: { id: db.workspaceId },
    select: { limits: true },
  });
  return resolveLimits(workspace?.limits);
}

/** LIMIT_REACHED si `used + reserved + requested` supera el límite (sin límite, nunca). */
export async function assertWithinLimit(
  db: TenantDb,
  key: LimitKey,
  usage: LimitUsage,
  limits?: Limits,
): Promise<void> {
  const check = checkLimit(limits ?? (await workspaceLimits(db)), key, usage);
  if (!check.ok) {
    const { limit, used, max } = check.error;
    throw new AppError("LIMIT_REACHED", { details: { limit, used, max } });
  }
}

export interface LimitsOverview {
  limits: Limits;
  usage: {
    storageBytes: number;
    /** null si no hay límite. */
    storageMaxBytes: number | null;
    members: { FULL: number; READER: number };
    aiQueriesThisMonth: number;
  };
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function limitsOverview(
  db: TenantDb,
  now: Date = new Date(),
): Promise<LimitsOverview> {
  const [limits, workspace, members, counter] = await Promise.all([
    workspaceLimits(db),
    db.workspace.findUnique({ where: { id: db.workspaceId }, select: { storageUsedBytes: true } }),
    db.membership.groupBy({ by: ["seatType"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    db.usageCounter.findFirst({
      where: { periodStart: monthStart(now) },
      select: { aiQueries: true },
    }),
  ]);
  const count = { FULL: 0, READER: 0 };
  for (const row of members) count[row.seatType] += row._count._all;
  const storageMax = limitInBaseUnits("storageGb", limits.storageGb);
  return {
    limits,
    usage: {
      storageBytes: bytesToJson(workspace?.storageUsedBytes ?? 0n),
      storageMaxBytes: storageMax === null ? null : bytesToJson(storageMax),
      members: count,
      aiQueriesThisMonth: counter?.aiQueries ?? 0,
    },
  };
}

export async function updateLimits(ctx: AdminContext, changes: StoredLimits): Promise<Limits> {
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, limits: true },
  });
  const before = resolveLimits(workspace.limits);
  const after: Limits = { ...before };
  for (const key of limitKeys) {
    const value = changes[key];
    if (value !== undefined) after[key] = value;
  }
  // Solo se guarda lo fijado (null = sin límite, no hace falta guardarlo).
  const stored = Object.fromEntries(Object.entries(after).filter(([, value]) => value !== null));
  await ctx.db.workspace.update({ where: { id: workspace.id }, data: { limits: stored } });
  await auditAdmin(ctx, {
    action: "limits.update",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: { before: { ...before }, after: { ...after } },
  });
  return after;
}
