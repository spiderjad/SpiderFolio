// /api/v1/w/:slug/admin/safety (docs/spec/seguridad-salud.md, «Activación y términos»): only the owner,
// next to the company's language and time zone.
import { z } from "zod";
import type { TenantRoute } from "../../routes.ts";
import { validationMessages } from "../../i18n/index.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { getSafetySettings, updateSafetySettings } from "./safety.service.ts";

const UpdateSafetySchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    terms: z.enum(["es", "latam"]).optional(),
    examples: z.boolean().optional(),
  })
  .refine((value) => value.enabled !== undefined || value.terms !== undefined, {
    error: () => validationMessages.noChanges,
  });

export function safetyRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/safety",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({ safety: await getSafetySettings(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/admin/safety",
      capability: "workspace.settings",
      ownerOnly: true,
      handler: async (req, res) => {
        const changes = UpdateSafetySchema.parse(req.body);
        res.json({ safety: await updateSafetySettings(adminContextOf(req), changes) });
      },
    },
  ];
}
