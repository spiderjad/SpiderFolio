// Ajustes del ingreso con PIN de un workspace (CLAUDE.md, sección 7.6): se guardan en
// Workspace.settings.pinLogin. Solo los cambia quien tiene members.pin.
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import {
  PinLoginSettingsSchema,
  readPinLoginSettings,
  type PinLoginSettings,
} from "../workspaces/settings.ts";

export async function getPinSettings(ctx: AdminContext): Promise<PinLoginSettings> {
  const workspace = await ctx.db.workspace.findFirst({
    where: {},
    select: { settings: true },
  });
  return readPinLoginSettings(workspace?.settings);
}

export async function updatePinSettings(
  ctx: AdminContext,
  changes: { [K in keyof PinLoginSettings]?: PinLoginSettings[K] | undefined },
): Promise<PinLoginSettings> {
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
  const before = readPinLoginSettings(workspace.settings);
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );
  const next = PinLoginSettingsSchema.parse({ ...before, ...defined });
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, pinLogin: next } },
  });
  await auditAdmin(ctx, {
    action: "pin.settings.update",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: { before, after: next },
  });
  return next;
}
