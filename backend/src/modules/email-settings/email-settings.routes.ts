// /api/v1/w/:slug/admin/email (Seguridad › Email). Propietario y administradores con
// security.manage; la prueba tiene su propio rate limit.
import type { Request } from "express";
import { createSecretBox } from "../../lib/secret-box.ts";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { domainProviderFromEnv } from "./domain-provider.ts";
import { RegisterDomainSchema, UpdateEmailSettingsSchema } from "./email-settings.schemas.ts";
import {
  activateEmail,
  deactivateEmail,
  getEmailSettings,
  registerEmailDomain,
  removeEmailDomain,
  verifyEmailDomain,
  sendTestEmail,
  updateEmailSettings,
  type EmailSettingsDeps,
} from "./email-settings.service.ts";

const HOUR = 60 * 60_000;

export function emailSettingsRoutes(deps: AppDeps): TenantRoute[] {
  const settings: EmailSettingsDeps = {
    ...deps,
    domainProvider: deps.emailDomainProvider ?? domainProviderFromEnv(deps.env),
    box: deps.env.EMAIL_ENCRYPTION_KEY === undefined ? null : createSecretBox(deps.env),
  };
  const workspaceKey = (req: Request) => req.tenant?.workspaceId ?? clientIp(req);
  const personKey = (req: Request) => `${workspaceKey(req)}:${req.auth?.userId ?? clientIp(req)}`;
  // 5 pruebas por hora por persona y 20 por hora por empresa.
  const testLimits = [
    sensitiveRateLimit(deps, {
      name: "email-test-person",
      windowMs: HOUR,
      limit: 5,
      key: personKey,
    }),
    sensitiveRateLimit(deps, {
      name: "email-test-workspace",
      windowMs: HOUR,
      limit: 20,
      key: workspaceKey,
    }),
  ];

  // La verificación consulta al proveedor: 30 por hora por empresa.
  const verifyLimit = sensitiveRateLimit(deps, {
    name: "email-domain-verify",
    windowMs: HOUR,
    limit: 30,
    key: workspaceKey,
  });

  return [
    {
      method: "get",
      path: "/admin/email",
      capability: "security.manage",
      handler: async (req, res) => {
        res.json(await getEmailSettings(adminContextOf(req), settings));
      },
    },
    {
      method: "put",
      path: "/admin/email",
      capability: "security.manage",
      handler: async (req, res) => {
        const input = UpdateEmailSettingsSchema.parse(req.body);
        res.json(await updateEmailSettings(adminContextOf(req), settings, input));
      },
    },
    {
      method: "post",
      path: "/admin/email/test",
      capability: "security.manage",
      guards: testLimits,
      handler: async (req, res) => {
        // Solo al email de quien lo pide: no sirve para mandar correo a terceros.
        res.json(await sendTestEmail(adminContextOf(req), settings, req.auth?.userId ?? ""));
      },
    },
    {
      method: "put",
      path: "/admin/email/domain",
      capability: "security.manage",
      handler: async (req, res) => {
        const input = RegisterDomainSchema.parse(req.body);
        res.json(await registerEmailDomain(adminContextOf(req), settings, input));
      },
    },
    {
      method: "post",
      path: "/admin/email/domain/verify",
      capability: "security.manage",
      guards: [verifyLimit],
      handler: async (req, res) => {
        res.json(await verifyEmailDomain(adminContextOf(req), settings));
      },
    },
    {
      method: "delete",
      path: "/admin/email/domain",
      capability: "security.manage",
      handler: async (req, res) => {
        res.json(await removeEmailDomain(adminContextOf(req), settings));
      },
    },
    {
      method: "post",
      path: "/admin/email/activate",
      capability: "security.manage",
      handler: async (req, res) => {
        res.json(await activateEmail(adminContextOf(req), settings));
      },
    },
    {
      method: "post",
      path: "/admin/email/deactivate",
      capability: "security.manage",
      handler: async (req, res) => {
        res.json(await deactivateEmail(adminContextOf(req), settings));
      },
    },
  ];
}
