// Signed plugins uploaded from Admin › License and plugins, and the restart that loads them
// (docs/spec/plugins.md «Subir un plugin desde la app»). Only the owner, with their own two-step
// verification on and confirmed recently. Unsigned (community) plugins are never uploaded here: only
// copied into the server's folder. Every upload, rejection and restart goes to the audit log.
import { readdirSync } from "node:fs";
import {
  pluginInstallDir,
  installPackage,
  InstallError,
  isUploaded,
  uninstallPackage,
  versionOnDisk,
} from "../../plugins/install.ts";
import {
  PackageError,
  verifyPackage,
  type PackageRejection,
  type VerifiedPackage,
} from "../../plugins/package.ts";
import { scheduleRestart, readRestartPlan, type RestartPlan } from "../../plugins/restart.ts";
import type { PluginRuntime } from "../../plugins/runtime.ts";
import type { AppDeps } from "../../routes.ts";
import { pluginTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { requireRecentMfa } from "../auth/mfa.service.ts";
import type { AuthContext } from "../auth/auth.service.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { saveLicense, setActivation } from "./plugins.service.ts";

export type PackageDeps = Pick<AppDeps, "env" | "prisma" | "plugins">;

/** The announced restart still ahead (on disk, shared by every process), or null. */
function announcedRestart(installDir: string, now: Date = new Date()): RestartPlan | null {
  const plan = readRestartPlan(installDir);
  return plan !== null && new Date(plan.restartAt).getTime() > now.getTime() ? plan : null;
}

export interface PluginServerView {
  /** Uploading signed plugins from the app is allowed on this server (PLUGIN_UPLOAD_ENABLED). */
  uploadEnabled: boolean;
  /** The owner has their own two-step verification on (uploading and restarting need it). */
  ownMfa: boolean;
  /** The server hosts more than one company: an upload installs the plugin for all of them. */
  multiCompany: boolean;
  /** «Restart now» is possible (something starts the processes again: SPIDERFOLIO_SUPERVISED). */
  restartSupported: boolean;
  /** Announced restart time (ISO), or null. */
  restartAt: string | null;
  /** Plugins installed on disk that this process hasn't loaded (they load on the next restart). */
  waiting: { id: string; version: string }[];
  /** Loaded plugins that were uploaded here, so the owner can remove them. */
  removable: string[];
  /** Removed from disk, still loaded until the next restart. */
  removing: string[];
}

async function ownMfa(deps: PackageDeps, auth: AuthContext): Promise<boolean> {
  const user = await deps.prisma.user.findUnique({
    where: { id: auth.userId },
    select: { totpEnabledAt: true },
  });
  return user?.totpEnabledAt != null;
}

/** Plugins on disk in the install folder whose version this process doesn't run. */
function waitingPlugins(
  installDir: string,
  plugins: PluginRuntime,
): { id: string; version: string }[] {
  let names: string[];
  try {
    names = readdirSync(installDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names.flatMap((id) => {
    const version = versionOnDisk(installDir, id);
    if (version === null) return [];
    const loaded = plugins.installed.find((plugin) => plugin.manifest.id === id);
    return loaded?.version === version ? [] : [{ id, version }];
  });
}

export async function pluginServerView(
  deps: PackageDeps,
  auth: AuthContext,
): Promise<PluginServerView> {
  const installDir = pluginInstallDir(deps.env);
  const pending = announcedRestart(installDir);
  return {
    uploadEnabled: deps.env.PLUGIN_UPLOAD_ENABLED,
    ownMfa: await ownMfa(deps, auth),
    multiCompany: (await deps.prisma.workspace.count({ where: { deletedAt: null } })) > 1,
    restartSupported: deps.env.SPIDERFOLIO_SUPERVISED,
    restartAt: pending?.restartAt ?? null,
    waiting: waitingPlugins(installDir, deps.plugins),
    removable: deps.plugins.installed
      .filter((plugin) => isUploaded(installDir, plugin))
      .filter((plugin) => versionOnDisk(installDir, plugin.manifest.id) !== null)
      .map((plugin) => plugin.manifest.id),
    removing: deps.plugins.installed
      .filter((plugin) => isUploaded(installDir, plugin))
      .filter((plugin) => versionOnDisk(installDir, plugin.manifest.id) === null)
      .map((plugin) => plugin.manifest.id),
  };
}

/** Owner with their own 2FA, confirmed recently (MFA_RECENT_REQUIRED otherwise). */
async function requireOwnRecentMfa(deps: PackageDeps, auth: AuthContext): Promise<void> {
  if (!(await ownMfa(deps, auth))) {
    throw new AppError("FORBIDDEN", { message: pluginTexts.uploadNeedsMfa });
  }
  await requireRecentMfa(deps.prisma, auth);
}

type Rejection = PackageRejection | "downgrade" | "builtIn";

/**
 * Verifies and installs a .sfplugin for this company. Nothing is written unless the whole package
 * checks out. Its license becomes the company's if it is newer than the one loaded.
 */
export async function uploadPluginPackage(
  ctx: AdminContext,
  deps: PackageDeps,
  auth: AuthContext,
  file: Buffer,
): Promise<{ id: string; version: string; previousVersion: string | null }> {
  if (!deps.env.PLUGIN_UPLOAD_ENABLED) {
    throw new AppError("FORBIDDEN", { message: pluginTexts.uploadDisabled });
  }
  await requireOwnRecentMfa(deps, auth);
  const reject = async (reason: Rejection, detail: Record<string, string> = {}): Promise<never> => {
    await auditAdmin(ctx, {
      action: "plugin.package.rejected",
      entityType: "Plugin",
      entityId: detail.id ?? "unknown",
      metadata: { reason, ...detail },
    });
    throw new AppError("BAD_REQUEST", { message: pluginTexts.packageRejected[reason] });
  };

  let verified: VerifiedPackage;
  try {
    verified = verifyPackage(file, { workspaceId: ctx.tenant.workspaceId });
  } catch (error) {
    if (error instanceof PackageError) return reject(error.reason);
    throw error;
  }
  const { id, version } = verified.manifest;
  let result: ReturnType<typeof installPackage>;
  try {
    result = installPackage({
      installDir: pluginInstallDir(deps.env),
      pkg: verified,
      loaded: deps.plugins.installed,
    });
  } catch (error) {
    if (error instanceof InstallError) return reject(error.reason, { id, version });
    throw error;
  }

  // A commercial package brings the company's license: it replaces the loaded one only if it is
  // newer. A free one is turned on in the company of the owner who uploads it.
  let licenseUpdated = false;
  if (verified.license === null || verified.manifest.license === null) {
    await setActivation(ctx, id, true);
    deps.plugins.forget(ctx.tenant.workspaceId);
  } else {
    const current = await deps.plugins.licenseStatus(ctx.tenant.workspaceId);
    const currentIssued =
      current.state === "valid" || current.state === "expired" ? current.payload.issuedAt : null;
    licenseUpdated = currentIssued === null || verified.license.issuedAt > currentIssued;
    if (licenseUpdated) await saveLicense(ctx, deps.plugins, verified.manifest.license);
  }

  await auditAdmin(ctx, {
    action: "plugin.package.upload",
    entityType: "Plugin",
    entityId: id,
    metadata: {
      version,
      previousVersion: result.previousVersion,
      licenseId: verified.license?.id ?? null,
      licenseUpdated,
    },
  });
  return result;
}

/**
 * Removes an uploaded plugin from this server (for every company on it) and, where the server restarts
 * on its own, announces the restart that unloads it. Its data stays: uploading it again brings it back.
 */
export async function removePluginPackage(
  ctx: AdminContext,
  deps: PackageDeps,
  auth: AuthContext,
  id: string,
): Promise<{ restartAt: string | null }> {
  if (!deps.env.PLUGIN_UPLOAD_ENABLED) {
    throw new AppError("FORBIDDEN", { message: pluginTexts.uploadDisabled });
  }
  await requireOwnRecentMfa(deps, auth);
  const installDir = pluginInstallDir(deps.env);
  let removed: { version: string } | null;
  try {
    removed = uninstallPackage({ installDir, id, loaded: deps.plugins.installed });
  } catch (error) {
    if (error instanceof InstallError) {
      throw new AppError("BAD_REQUEST", { message: pluginTexts.removeBuiltIn });
    }
    throw error;
  }
  if (removed === null) {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.removeNotInstalled });
  }
  await auditAdmin(ctx, {
    action: "plugin.package.remove",
    entityType: "Plugin",
    entityId: id,
    metadata: { version: removed.version },
  });
  if (!deps.env.SPIDERFOLIO_SUPERVISED) return { restartAt: null };
  const pending = announcedRestart(installDir);
  if (pending !== null) return { restartAt: pending.restartAt };
  const plan = scheduleRestart(installDir);
  await auditAdmin(ctx, {
    action: "server.restart.request",
    entityType: "Server",
    entityId: "server",
    metadata: { restartAt: plan.restartAt, removed: id },
  });
  return { restartAt: plan.restartAt };
}

/** Announces a restart of the API and the worker (RESTART_NOTICE_MS ahead) to load the plugins. */
export async function requestRestart(
  ctx: AdminContext,
  deps: PackageDeps,
  auth: AuthContext,
): Promise<{ restartAt: string }> {
  if (!deps.env.SPIDERFOLIO_SUPERVISED) {
    throw new AppError("BAD_REQUEST", { message: pluginTexts.restartUnsupported });
  }
  await requireOwnRecentMfa(deps, auth);
  const installDir = pluginInstallDir(deps.env);
  // Already announced (by this owner or another company's): the same plan, not a later one.
  const pending = announcedRestart(installDir);
  if (pending !== null) return { restartAt: pending.restartAt };
  const plan = scheduleRestart(installDir);
  await auditAdmin(ctx, {
    action: "server.restart.request",
    entityType: "Server",
    entityId: "server",
    metadata: { restartAt: plan.restartAt, waiting: waitingPlugins(installDir, deps.plugins) },
  });
  return { restartAt: plan.restartAt };
}
