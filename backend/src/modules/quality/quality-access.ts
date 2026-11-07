// Who sees what in the food quality module (docs/spec/calidad.md, «Permisos»). With the module off every
// screen of it answers 404, as if it didn't exist.
import { notFound } from "../../lib/errors.ts";
import type { TenantDb } from "../../db/tenant.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { readQualitySettings, type QualitySettings } from "../workspaces/settings.ts";

export async function qualitySettingsOf(db: TenantDb): Promise<QualitySettings> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readQualitySettings(workspace?.settings);
}

/** The module is on; otherwise 404. Returns its settings. */
export async function requireQuality(ctx: Pick<AdminContext, "db">): Promise<QualitySettings> {
  const settings = await qualitySettingsOf(ctx.db);
  if (!settings.enabled) throw notFound();
  return settings;
}

/** Every nonconformity, its CAPA, the effectiveness check and the module's settings. */
export const canManageQuality = (ctx: Pick<AdminContext, "tenant">): boolean =>
  ctx.tenant.capabilities.includes("quality.manage");

/** Reads every nonconformity and action; quality.manage includes it. */
export const canViewQuality = (ctx: Pick<AdminContext, "tenant">): boolean =>
  canManageQuality(ctx) || ctx.tenant.capabilities.includes("quality.view");
