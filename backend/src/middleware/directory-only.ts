import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import { readDirectoryOnly } from "../modules/workspaces/settings.ts";
import type { PluginRuntime } from "../plugins/runtime.ts";
import { tenantOf } from "./tenant.ts";

/**
 * «Directory only» (docs/spec/plugins.md «Directorio de la empresa»): in a company that turned it on,
 * whoever isn't an owner only gets in with a session that signed in through that plugin's directory.
 * Owners keep their own password, PIN sessions (shared tablets) aren't affected, and it stops applying
 * when the plugin can no longer sign anyone in (license expired after the grace period). Goes after
 * tenantMiddleware; without plugins that sign people in it does nothing.
 */
export function directoryOnlyGuard(prisma: PrismaClient, plugins: PluginRuntime): RequestHandler {
  const signsIn = plugins.installed.some(
    (plugin) => (plugin.backend?.authProviders ?? []).length > 0,
  );
  return async (req, _res, next) => {
    if (!signsIn || req.auth === undefined) {
      next();
      return;
    }
    const { tenant } = tenantOf(req);
    if (tenant.role.base === "OWNER") {
      next();
      return;
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: tenant.workspaceId },
      select: { settings: true },
    });
    const holder = readDirectoryOnly(workspace?.settings);
    if (holder === null) {
      next();
      return;
    }
    const session = await prisma.session.findUnique({
      where: { id: req.auth.sessionId },
      select: { authWorkspaceId: true, authProvider: true, idleSeconds: true },
    });
    const throughDirectory =
      session !== null &&
      (session.idleSeconds !== null ||
        (session.authWorkspaceId === tenant.workspaceId &&
          session.authProvider?.startsWith(`${holder}/`) === true));
    if (
      !throughDirectory &&
      (await plugins.signInProviders(tenant.workspaceId)).some((p) => p.pluginId === holder)
    ) {
      throw new AppError("DIRECTORY_SIGN_IN_REQUIRED");
    }
    next();
  };
}
