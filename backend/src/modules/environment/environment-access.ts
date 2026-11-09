// Who sees what in the environment module (docs/spec/medio-ambiente.md, «Permisos»). With the module
// off every screen of it answers 404, as if it didn't exist.
import type { TenantDb } from "../../db/tenant.ts";
import { forbidden, notFound } from "../../lib/errors.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { readEnvironmentSettings, type EnvironmentSettings } from "../workspaces/settings.ts";

export async function environmentSettingsOf(db: TenantDb): Promise<EnvironmentSettings> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readEnvironmentSettings(workspace?.settings);
}

/** The module is on; otherwise 404. */
export async function requireEnvironment(
  ctx: Pick<AdminContext, "db">,
): Promise<EnvironmentSettings> {
  const settings = await environmentSettingsOf(ctx.db);
  if (!settings.enabled) throw notFound();
  return settings;
}

type Ctx = Pick<AdminContext, "tenant">;

export const canManageEnvironment = (ctx: Ctx): boolean =>
  ctx.tenant.capabilities.includes("environment.manage");

export const canViewEnvironment = (ctx: Ctx): boolean =>
  canManageEnvironment(ctx) || ctx.tenant.capabilities.includes("environment.view");

/** Records waste collections: environment.record, or whoever manages the module. */
export const canRecordEnvironment = (ctx: Ctx): boolean =>
  canManageEnvironment(ctx) || ctx.tenant.capabilities.includes("environment.record");

/** Reading the catalogs (waste, contractors): anyone who views or records. */
export const canReadCatalog = (ctx: Ctx): boolean =>
  canViewEnvironment(ctx) || canRecordEnvironment(ctx);

export async function requireManage(ctx: Pick<AdminContext, "db" | "tenant">): Promise<void> {
  await requireEnvironment(ctx);
  if (!canManageEnvironment(ctx)) throw forbidden();
}

export async function requireView(ctx: Pick<AdminContext, "db" | "tenant">): Promise<void> {
  await requireEnvironment(ctx);
  if (!canViewEnvironment(ctx)) throw forbidden();
}

export async function requireCatalog(ctx: Pick<AdminContext, "db" | "tenant">): Promise<void> {
  await requireEnvironment(ctx);
  if (!canReadCatalog(ctx)) throw forbidden();
}

export async function requireRecord(ctx: Pick<AdminContext, "db" | "tenant">): Promise<void> {
  await requireEnvironment(ctx);
  if (!canRecordEnvironment(ctx)) throw forbidden();
}

/** Whoever has environment.manage, active, the owner first: they get the notices nobody else owns. */
export async function environmentManagers(db: TenantDb): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { status: "ACTIVE", role: { capabilities: { has: "environment.manage" } } },
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

/** «YYYY-MM-DD» plus whole months (the last day of a shorter month when it doesn't exist). */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}
