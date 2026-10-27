// /api/v1/w/:slug/admin/limits (docs/spec/limites.md): ver el uso y fijar los límites de la empresa.
import { limitMinimums, limitKeys, LimitValueSchema } from "@spiderfolio/limits";
import { z } from "zod";
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { limitsOverview, updateLimits } from "./limits.service.ts";
import { validationMessages } from "../../i18n/index.ts";

const UpdateLimitsSchema = z
  .strictObject(
    Object.fromEntries(
      limitKeys.map((key) => [
        key,
        LimitValueSchema.refine(
          (value) => value === null || value >= (limitMinimums[key] ?? 0),
          { error: () => validationMessages.minimum(limitMinimums[key] ?? 0) },
        ).optional(),
      ]),
    ),
  )
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export function limitsRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/limits",
      anyCapability: ["workspace.settings", "storage.view"],
      handler: async (req, res) => {
        res.json(await limitsOverview(adminContextOf(req).db));
      },
    },
    {
      method: "patch",
      path: "/admin/limits",
      capability: "workspace.settings",
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await updateLimits(ctx, UpdateLimitsSchema.parse(req.body));
        res.json(await limitsOverview(ctx.db));
      },
    },
  ];
}
