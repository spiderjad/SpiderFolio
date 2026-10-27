import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import type { PluginRuntime } from "../plugins/runtime.ts";
import { tenantOf } from "./tenant.ts";

/**
 * 2FA obligatoria: si un plugin activo (ej. Políticas de seguridad avanzadas) se la exige a la persona y
 * todavía no la configuró, el workspace le responde MFA_SETUP_REQUIRED hasta que la active (lo de /auth
 * sigue disponible: ahí está el alta). Las cuentas de PIN quedan siempre fuera. Va después de
 * tenantMiddleware.
 */
export function mfaSetupGuard(prisma: PrismaClient, plugins: PluginRuntime): RequestHandler {
  return async (req, _res, next) => {
    if (req.auth === undefined || plugins.installed.length === 0) {
      next();
      return;
    }
    const { tenant } = tenantOf(req);
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { kind: true, totpEnabledAt: true },
    });
    if (
      user !== null &&
      user.kind === "STANDARD" &&
      user.totpEnabledAt === null &&
      (await plugins.mfaRequired(tenant.workspaceId, {
        userKind: user.kind,
        roleBase: tenant.role.base,
        capabilities: tenant.capabilities,
      }))
    ) {
      throw new AppError("MFA_SETUP_REQUIRED");
    }
    next();
  };
}
