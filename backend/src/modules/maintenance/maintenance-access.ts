// Who sees what in the maintenance module (docs/spec/mantenimiento.md, «Activación y permisos»). With
// the module off every screen of it answers 404, as if it didn't exist.
import type { TenantDb } from "../../db/tenant.ts";
import { forbidden, notFound } from "../../lib/errors.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import {
  readMaintenanceSettings,
  readQualitySettings,
  type MaintenanceSettings,
} from "../workspaces/settings.ts";

type Ctx = Pick<AdminContext, "db" | "tenant">;

export async function maintenanceSettingsOf(db: TenantDb): Promise<MaintenanceSettings> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readMaintenanceSettings(workspace?.settings);
}

export async function requireMaintenance(ctx: Pick<AdminContext, "db">): Promise<void> {
  if (!(await maintenanceSettingsOf(ctx.db)).enabled) throw notFound();
}

const has = (ctx: Pick<AdminContext, "tenant">, capability: string) =>
  (ctx.tenant.capabilities as readonly string[]).includes(capability);

export const canManageMaintenance = (ctx: Pick<AdminContext, "tenant">): boolean =>
  has(ctx, "maintenance.manage");

/** Technicians: every work order, and working on them. */
export const canWorkMaintenance = (ctx: Pick<AdminContext, "tenant">): boolean =>
  canManageMaintenance(ctx) || has(ctx, "maintenance.work");

/** Sees every work order (manage, work or view). */
export const canViewMaintenance = (ctx: Pick<AdminContext, "tenant">): boolean =>
  canWorkMaintenance(ctx) || has(ctx, "maintenance.view");

/**
 * Reports breakdowns: any active person but guests. Readers too, and the plant's user + PIN accounts on
 * a shared tablet: reporting a breakdown is like filling in a record (docs/spec/formularios.md), not
 * editing documentation. Many people in the plant have no computer of their own.
 */
export const canReport = (ctx: Pick<AdminContext, "tenant">): boolean =>
  ctx.tenant.role.base !== "GUEST";

export async function requireManage(ctx: Ctx): Promise<void> {
  await requireMaintenance(ctx);
  if (!canManageMaintenance(ctx)) throw forbidden();
}

export async function requireWork(ctx: Ctx): Promise<void> {
  await requireMaintenance(ctx);
  if (!canWorkMaintenance(ctx)) throw forbidden();
}

/** Any of the module's people, or someone who reports (they see the equipment to choose it). */
export async function requireAny(ctx: Ctx): Promise<void> {
  await requireMaintenance(ctx);
  if (!canViewMaintenance(ctx) && !canReport(ctx)) throw forbidden();
}

/**
 * The hygiene release (IFS 4.17.4): quality, with its module on; otherwise whoever manages
 * maintenance.
 */
export async function canReleaseHygiene(ctx: Ctx): Promise<boolean> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readQualitySettings(workspace?.settings).enabled
    ? has(ctx, "quality.manage")
    : canManageMaintenance(ctx);
}

/** Whoever manages maintenance, active, the owner first. */
export async function maintenanceManagers(db: TenantDb): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { status: "ACTIVE", role: { capabilities: { has: "maintenance.manage" } } },
    select: { id: true, role: { select: { base: true } } },
    orderBy: { createdAt: "asc" },
  });
  return [
    ...rows.filter((row) => row.role.base === "OWNER"),
    ...rows.filter((row) => row.role.base !== "OWNER"),
  ].map((row) => row.id);
}

/** A «YYYY-MM-DD» day as the DATE column stores it. */
export const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);
