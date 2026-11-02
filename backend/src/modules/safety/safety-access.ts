// Who sees what in the occupational health and safety module (docs/spec/seguridad-salud.md, «Permisos»).
// With the module off every screen of it answers 404, as if it didn't exist.
import { notFound } from "../../lib/errors.ts";
import type { TenantDb } from "../../db/tenant.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { ledDepartmentIds } from "../departments/departments.scope.ts";
import { readSafetySettings, type SafetySettings } from "../workspaces/settings.ts";

export async function safetySettingsOf(db: TenantDb): Promise<SafetySettings> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readSafetySettings(workspace?.settings);
}

/** The module is on; otherwise 404. Returns its settings. */
export async function requireSafety(ctx: Pick<AdminContext, "db">): Promise<SafetySettings> {
  const settings = await safetySettingsOf(ctx.db);
  if (!settings.enabled) throw notFound();
  return settings;
}

export const canManageSafety = (ctx: Pick<AdminContext, "tenant">): boolean =>
  ctx.tenant.capabilities.includes("safety.manage");

/**
 * Whose PPE and training the person sees: everyone with `safety.manage`; the heads and deputies, the
 * people of the departments they lead (and sub-areas) and themselves; the rest, only themselves.
 * null = everyone.
 */
export async function visiblePeople(ctx: AdminContext): Promise<string[] | null> {
  if (canManageSafety(ctx)) return null;
  const led = await ledDepartmentIds(ctx, ctx.tenant.membershipId);
  if (led.length === 0) return [ctx.tenant.membershipId];
  const members = await ctx.db.departmentMember.findMany({
    where: { departmentId: { in: led } },
    select: { membershipId: true },
  });
  return [...new Set([ctx.tenant.membershipId, ...members.map((m) => m.membershipId)])];
}

/** The person is someone this one sees (otherwise 404, so nothing is learned about them). */
export async function assertSeesPerson(ctx: AdminContext, membershipId: string): Promise<void> {
  const visible = await visiblePeople(ctx);
  if (visible !== null && !visible.includes(membershipId)) throw notFound();
  const exists = await ctx.db.membership.count({ where: { id: membershipId } });
  if (exists === 0) throw notFound();
}
