// Turning the environment module on or off (docs/spec/medio-ambiente.md, «Activación»). The first time
// it's turned on it creates the module's space, in the Environment area. Turning it off hides the module
// and never deletes anything.
import { environmentLimits } from "@spiderfolio/limits";
import { environmentTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { createSpace, freeSpaceName } from "../spaces/spaces.service.ts";
import { readEnvironmentSettings, type EnvironmentSettings } from "../workspaces/settings.ts";
import { requireManage } from "./environment-access.ts";

export interface EnvironmentView {
  enabled: boolean;
  /** The module's space, while it exists. */
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

/** The module's space, created (in the company's language) if it's gone. */
async function ensureSpace(
  ctx: AdminContext,
  settings: EnvironmentSettings,
  companySettings: unknown,
): Promise<string> {
  const current = await spaceOf(ctx, settings.spaceId);
  if (current !== null) return current.id;
  const texts = withLocale(readWorkspaceLocale(companySettings), () => ({
    ...environmentTexts.space,
  }));
  const space = await createSpace(ctx, {
    name: await freeSpaceName(ctx, texts.name),
    icon: "🌱",
    description: texts.description,
    isPrivate: false,
    isConfidential: false,
    includeSubareas: false,
  });
  // Listed in the Environment area (docs/spec/diseno.md 10.4.1).
  await ctx.db.space.update({
    where: { id: space.id },
    data: { area: "ENVIRONMENT" },
    select: { id: true },
  });
  return space.id;
}

/** The module's space id (created again if it was archived or deleted). */
export async function moduleSpace(ctx: AdminContext): Promise<string> {
  const workspace = await workspaceOf(ctx);
  const settings = readEnvironmentSettings(workspace.settings);
  const id = await ensureSpace(ctx, settings, workspace.settings);
  if (id !== settings.spaceId) await save(ctx, workspace, { ...settings, spaceId: id });
  return id;
}

async function save(
  ctx: AdminContext,
  workspace: { id: string; settings: unknown },
  settings: EnvironmentSettings,
): Promise<void> {
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, environment: settings } },
  });
}

export async function getEnvironmentSettings(ctx: AdminContext): Promise<EnvironmentView> {
  const settings = readEnvironmentSettings((await workspaceOf(ctx)).settings);
  return { enabled: settings.enabled, space: await spaceOf(ctx, settings.spaceId) };
}

export async function updateEnvironmentSettings(
  ctx: AdminContext,
  input: { enabled: boolean },
): Promise<EnvironmentView> {
  const workspace = await workspaceOf(ctx);
  const before = readEnvironmentSettings(workspace.settings);
  const after: EnvironmentSettings = { ...before, enabled: input.enabled };
  if (after.enabled) after.spaceId = await ensureSpace(ctx, after, workspace.settings);
  await save(ctx, workspace, after);
  if (after.enabled !== before.enabled) {
    await auditAdmin(ctx, {
      action: after.enabled ? "environment.enable" : "environment.disable",
      entityType: "Workspace",
      entityId: workspace.id,
    });
  }
  return { enabled: after.enabled, space: await spaceOf(ctx, after.spaceId) };
}

/** The maximum storage of a waste, by the law: hazardous, or by its operation (R recovers, D disposes). */
export function defaultStorageMonths(hazardous: boolean, operation: string): number {
  if (hazardous) return environmentLimits.storageMonthsHazardous;
  return operation.trim().toUpperCase().startsWith("D")
    ? environmentLimits.storageMonthsDisposal
    : environmentLimits.storageMonthsRecovery;
}

/** Loads the meat industry's usual waste; one that already exists (same name) is left as it is. */
export async function loadWasteTemplate(ctx: AdminContext): Promise<{ added: number }> {
  await requireManage(ctx);
  let added = 0;
  for (const item of environmentTexts.template) {
    const exists = await ctx.db.envWaste.findFirst({
      where: { nameKey: nameKeyOf(item.name) },
      select: { id: true },
    });
    if (exists !== null) continue;
    const hazardous = item.ler.endsWith("*");
    await ctx.db.envWaste.create({
      data: {
        name: item.name,
        nameKey: nameKeyOf(item.name),
        ler: item.ler,
        hazardous,
        sandach:
          item.sandach === "CAT1" || item.sandach === "CAT2" || item.sandach === "CAT3"
            ? item.sandach
            : null,
        operation: item.operation,
        maxStorageMonths: defaultStorageMonths(hazardous, item.operation),
      },
      select: { id: true },
    });
    added += 1;
  }
  await auditAdmin(ctx, {
    action: "environment.waste.template",
    entityType: "EnvWaste",
    entityId: "template",
    metadata: { added },
  });
  return { added };
}
