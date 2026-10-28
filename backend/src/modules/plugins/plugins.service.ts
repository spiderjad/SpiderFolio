// Licencia y plugins del workspace (docs/spec/plugins.md): qué hay instalado, qué activa la licencia
// cargada y cargarla o quitarla. El token se guarda tal cual; en la auditoría van solo sus datos (id,
// empresa, plugins, vencimiento), nunca el token.
import { manifestText, type LicenseStatus } from "@spiderfolio/plugin-sdk";
import { currentLocale } from "../../i18n/locales.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { readCommunityActivations } from "../../plugins/community.ts";
import { pluginTexts } from "../../i18n/index.ts";
import type { PluginRuntime } from "../../plugins/runtime.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";

export interface LicenseView {
  state: LicenseStatus["state"];
  reason?: "format" | "signature" | "payload" | "workspace";
  id?: string;
  customer?: string;
  plugins?: string[];
  issuedAt?: string;
  expiresAt?: string | null;
}

export interface InstalledPluginView {
  id: string;
  name: string;
  description: string;
  version: string;
  /** «commercial»: se activa con la licencia. «community»: de terceros, sin verificar. */
  distribution: "commercial" | "community";
  /** La licencia lo incluye (vigente o vencida). Siempre false en los community. */
  licensed: boolean;
  active: boolean;
}

function viewOf(status: LicenseStatus): LicenseView {
  switch (status.state) {
    case "none":
      return { state: "none" };
    case "invalid":
      return { state: "invalid", reason: status.reason };
    case "expired":
    case "valid":
      return { state: status.state, ...status.payload };
  }
}

export interface ActivePluginView {
  id: string;
  name: string;
  version: string;
  /** Built app to load at runtime (same origin); null if the app part is compiled in, or none. */
  bundle: { script: string; styles: string | null } | null;
}

/** What anyone in the workspace needs: the active plugins (the app shows only those). */
export async function activePlugins(
  plugins: PluginRuntime,
  workspaceId: string,
): Promise<ActivePluginView[]> {
  const active = await plugins.activeIds(workspaceId);
  return plugins.installed
    .filter((plugin) => active.has(plugin.manifest.id))
    .map((plugin) => {
      const { frontendBundle: bundle } = plugin;
      const url = (file: string) =>
        `/plugin-assets/${plugin.manifest.id}/${file}?v=${encodeURIComponent(plugin.version)}`;
      return {
        id: plugin.manifest.id,
        name: manifestText(plugin.manifest, currentLocale()).name,
        version: plugin.version,
        bundle:
          bundle === null
            ? null
            : {
                script: url(bundle.script),
                styles: bundle.styles === null ? null : url(bundle.styles),
              },
      };
    });
}

export async function licenseOverview(
  ctx: AdminContext,
  plugins: PluginRuntime,
): Promise<{ license: LicenseView; installed: InstalledPluginView[] }> {
  const status = await plugins.licenseStatus(ctx.tenant.workspaceId);
  const listed = new Set(
    status.state === "valid" || status.state === "expired" ? status.payload.plugins : [],
  );
  const active = await plugins.activeIds(ctx.tenant.workspaceId);
  return {
    license: viewOf(status),
    installed: plugins.installed.map((plugin) => ({
      id: plugin.manifest.id,
      ...manifestText(plugin.manifest, currentLocale()),
      version: plugin.version,
      distribution: plugin.manifest.distribution,
      licensed: plugin.manifest.distribution === "commercial" && listed.has(plugin.manifest.id),
      active: active.has(plugin.manifest.id),
    })),
  };
}

export async function saveLicense(
  ctx: AdminContext,
  plugins: PluginRuntime,
  token: string,
): Promise<void> {
  const status = plugins.verify(token, ctx.tenant.workspaceId);
  if (status.state === "invalid" && status.reason === "workspace") {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.licenseOtherCompany });
  }
  if (status.state === "invalid" || status.state === "none") {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.licenseInvalid });
  }
  if (status.state === "expired") {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.licenseExpired });
  }
  const existing = await ctx.db.workspaceLicense.findFirst({ select: { id: true } });
  const data = { token: token.trim(), uploadedById: ctx.tenant.membershipId };
  if (existing === null) await ctx.db.workspaceLicense.create({ data });
  else await ctx.db.workspaceLicense.update({ where: { id: existing.id }, data });
  plugins.forget(ctx.tenant.workspaceId);
  const { id, customer, plugins: licensed, expiresAt } = status.payload;
  await auditAdmin(ctx, {
    action: "license.update",
    entityType: "WorkspaceLicense",
    entityId: id,
    metadata: { customer, plugins: licensed, expiresAt },
  });
}

export async function removeLicense(ctx: AdminContext, plugins: PluginRuntime): Promise<void> {
  const existing = await ctx.db.workspaceLicense.findFirst({ select: { id: true, token: true } });
  if (existing === null) return;
  await ctx.db.workspaceLicense.delete({ where: { id: existing.id } });
  plugins.forget(ctx.tenant.workspaceId);
  const status = plugins.verify(existing.token, ctx.tenant.workspaceId);
  await auditAdmin(ctx, {
    action: "license.remove",
    entityType: "WorkspaceLicense",
    entityId:
      status.state === "valid" || status.state === "expired" ? status.payload.id : existing.id,
  });
}

/**
 * Activa o desactiva un plugin community en la empresa. Solo el propietario (lo hace cumplir la ruta)
 * y, al activar, con la confirmación explícita de que el plugin no está verificado y tiene acceso al
 * servidor. Los comerciales no se activan así: solo con la licencia.
 */
export async function setCommunityPlugin(
  ctx: AdminContext,
  plugins: PluginRuntime,
  pluginId: string,
  change: { enabled: boolean; acceptRisk?: boolean | undefined },
): Promise<void> {
  const plugin = plugins.installed.find((candidate) => candidate.manifest.id === pluginId);
  if (plugin === undefined) throw notFound();
  if (plugin.manifest.distribution !== "community") {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.notCommunity });
  }
  if (change.enabled && change.acceptRisk !== true) {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.acceptRiskRequired });
  }
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  const before = readCommunityActivations(workspace.settings);
  if (change.enabled === pluginId in before) return;
  const activations = change.enabled
    ? {
        ...before,
        [pluginId]: { enabledAt: new Date().toISOString(), enabledBy: ctx.tenant.membershipId },
      }
    : Object.fromEntries(Object.entries(before).filter(([id]) => id !== pluginId));
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, communityPlugins: activations } },
  });
  plugins.forget(ctx.tenant.workspaceId);
  await auditAdmin(ctx, {
    action: change.enabled ? "plugin.community.enable" : "plugin.community.disable",
    entityType: "Plugin",
    entityId: pluginId,
    metadata: { version: plugin.version, verified: false },
  });
}
