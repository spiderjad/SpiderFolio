// Turning the maintenance module on or off (docs/spec/mantenimiento.md, «Activación»). The first time it's
// turned on it creates the module's space, in the Maintenance area. Turning it off hides the module and
// never deletes anything.
import { maintenanceTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { createSpace, freeSpaceName } from "../spaces/spaces.service.ts";
import { readMaintenanceSettings, type MaintenanceSettings } from "../workspaces/settings.ts";

export interface MaintenanceView {
  enabled: boolean;
  space: { id: string; name: string } | null;
}

async function workspaceOf(ctx: AdminContext) {
  return await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
}

async function spaceOf(ctx: Pick<AdminContext, "db">, spaceId: string | undefined) {
  if (spaceId === undefined) return null;
  return await ctx.db.space.findFirst({
    where: { id: spaceId, archivedAt: null },
    select: { id: true, name: true },
  });
}

async function ensureSpace(
  ctx: AdminContext,
  settings: MaintenanceSettings,
  companySettings: unknown,
): Promise<string> {
  const current = await spaceOf(ctx, settings.spaceId);
  if (current !== null) return current.id;
  const texts = withLocale(readWorkspaceLocale(companySettings), () => ({
    ...maintenanceTexts.space,
  }));
  const space = await createSpace(ctx, {
    name: await freeSpaceName(ctx, texts.name),
    icon: "🔧",
    description: texts.description,
    isPrivate: false,
    isConfidential: false,
    includeSubareas: false,
  });
  await ctx.db.space.update({
    where: { id: space.id },
    data: { area: "MAINTENANCE" },
    select: { id: true },
  });
  return space.id;
}

async function save(
  ctx: AdminContext,
  workspace: { id: string; settings: unknown },
  settings: MaintenanceSettings,
): Promise<void> {
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, maintenance: settings } },
  });
}

/** The module's space id (created again if it was archived or deleted). */
export async function moduleSpace(ctx: AdminContext): Promise<string> {
  const workspace = await workspaceOf(ctx);
  const settings = readMaintenanceSettings(workspace.settings);
  const id = await ensureSpace(ctx, settings, workspace.settings);
  if (id !== settings.spaceId) await save(ctx, workspace, { ...settings, spaceId: id });
  return id;
}

export async function getMaintenanceSettings(ctx: AdminContext): Promise<MaintenanceView> {
  const settings = readMaintenanceSettings((await workspaceOf(ctx)).settings);
  return { enabled: settings.enabled, space: await spaceOf(ctx, settings.spaceId) };
}

export async function updateMaintenanceSettings(
  ctx: AdminContext,
  input: { enabled: boolean },
): Promise<MaintenanceView> {
  const workspace = await workspaceOf(ctx);
  const before = readMaintenanceSettings(workspace.settings);
  const after: MaintenanceSettings = { ...before, enabled: input.enabled };
  if (after.enabled) after.spaceId = await ensureSpace(ctx, after, workspace.settings);
  await save(ctx, workspace, after);
  if (after.enabled !== before.enabled) {
    await auditAdmin(ctx, {
      action: after.enabled ? "maintenance.enable" : "maintenance.disable",
      entityType: "Workspace",
      entityId: workspace.id,
    });
  }
  return { enabled: after.enabled, space: await spaceOf(ctx, after.spaceId) };
}
