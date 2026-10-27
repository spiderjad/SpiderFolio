// /api/v1/w/:slug/admin/security (CLAUDE.md, sección 9.4).
import { z } from "zod";
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { MemberVisibilitySchema } from "../workspaces/settings.ts";
import { LOCALES } from "../../i18n/locales.ts";
import { getSecuritySettings, updateSecuritySettings } from "./security.service.ts";
import { validationMessages } from "../../i18n/index.ts";

const UpdateSecuritySchema = z
  .strictObject({
    memberVisibility: MemberVisibilitySchema.optional(),
    leadersCanInvite: z.boolean().optional(),
    allowSelfApproval: z.boolean().optional(),
    bianEnabled: z.boolean().optional(),
    bianGuests: z.boolean().optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export function securityRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/security",
      capability: "security.manage",
      // Seguridad es solo del propietario (docs/spec/personas.md).
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({ settings: await getSecuritySettings(adminContextOf(req)) });
      },
    },
    {
      method: "patch",
      path: "/admin/security",
      capability: "security.manage",
      // Seguridad es solo del propietario (docs/spec/personas.md).
      ownerOnly: true,
      handler: async (req, res) => {
        const changes = UpdateSecuritySchema.parse(req.body);
        res.json({ settings: await updateSecuritySettings(adminContextOf(req), changes) });
      },
    },
  ];
}
