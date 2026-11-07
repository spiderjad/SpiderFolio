// Turning the food quality module on or off (docs/spec/calidad.md, «Activación»). The first time it's
// turned on it creates the module's space, in the Quality area. Turning it off hides the module and
// never deletes anything.
import { withLocale, readWorkspaceLocale } from "../../i18n/locales.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { createSpace, freeSpaceName } from "../spaces/spaces.service.ts";
import { ensureHaccpType, loadMeatTemplate } from "./haccp.service.ts";
import { readQualitySettings, type QualitySettings } from "../workspaces/settings.ts";

export interface QualityView {
  enabled: boolean;
  standards: QualitySettings["standards"];
  verifyDays: number;
  responseDays: number;
  /** The module's space, while it exists. */
  space: { id: string; name: string } | null;
}

export interface UpdateQualityInput {
  enabled?: boolean | undefined;
  standards?: QualitySettings["standards"] | undefined;
  verifyDays?: number | undefined;
  responseDays?: number | undefined;
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
    where: { id: spaceId },
    select: { id: true, name: true },
  });
}

async function viewOf(ctx: AdminContext, settings: QualitySettings): Promise<QualityView> {
  return {
    enabled: settings.enabled,
    standards: settings.standards,
    verifyDays: settings.verifyDays,
    responseDays: settings.responseDays,
    space: await spaceOf(ctx, settings.spaceId),
  };
}

export async function getQualitySettings(ctx: AdminContext): Promise<QualityView> {
  return await viewOf(ctx, readQualitySettings((await workspaceOf(ctx)).settings));
}

/** The module's space, created (in the company's language) if it's gone. */
async function ensureSpace(
  ctx: AdminContext,
  settings: QualitySettings,
  companySettings: unknown,
): Promise<string> {
  const current = await spaceOf(ctx, settings.spaceId);
  if (current !== null) return current.id;
  const texts = withLocale(readWorkspaceLocale(companySettings), () => ({
    ...qualityTexts.space,
  }));
  const space = await createSpace(ctx, {
    name: await freeSpaceName(ctx, texts.name),
    icon: "✅",
    description: texts.description,
    isPrivate: false,
    isConfidential: false,
    includeSubareas: false,
  });
  // The module's space is listed in the Quality area (docs/spec/diseno.md 10.4.1).
  await ctx.db.space.update({
    where: { id: space.id },
    data: { area: "QUALITY" },
    select: { id: true },
  });
  return space.id;
}

export async function updateQualitySettings(
  ctx: AdminContext,
  input: UpdateQualityInput,
): Promise<QualityView> {
  const workspace = await workspaceOf(ctx);
  const before = readQualitySettings(workspace.settings);
  const after: QualitySettings = {
    enabled: input.enabled ?? before.enabled,
    standards: input.standards ?? before.standards,
    verifyDays: input.verifyDays ?? before.verifyDays,
    responseDays: input.responseDays ?? before.responseDays,
    ...(before.spaceId === undefined ? {} : { spaceId: before.spaceId }),
  };
  if (after.enabled) {
    after.spaceId = await ensureSpace(ctx, after, workspace.settings);
    // The HACCP plan's document type (phase 2), once.
    await ensureHaccpType(ctx);
  }
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, quality: after } },
  });
  if (after.enabled !== before.enabled) {
    await auditAdmin(ctx, {
      action: after.enabled ? "quality.enable" : "quality.disable",
      entityType: "Workspace",
      entityId: workspace.id,
    });
  } else if (
    after.verifyDays !== before.verifyDays ||
    after.responseDays !== before.responseDays ||
    after.standards.join() !== before.standards.join()
  ) {
    await auditAdmin(ctx, {
      action: "quality.settings",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: {
        before: {
          standards: before.standards,
          verifyDays: before.verifyDays,
          responseDays: before.responseDays,
        },
        after: {
          standards: after.standards,
          verifyDays: after.verifyDays,
          responseDays: after.responseDays,
        },
      },
    });
  }
  return await viewOf(ctx, after);
}

/** The meat industry HACCP template (phase 2), in the module's space. Only the owner (its route). */
export async function loadTemplate(ctx: AdminContext): Promise<{ forms: number; ccps: number }> {
  const settings = readQualitySettings((await workspaceOf(ctx)).settings);
  return await loadMeatTemplate(ctx, settings.spaceId);
}
