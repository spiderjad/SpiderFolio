// /api/v1/w/:slug/plugins, /admin/license y /admin/plugins (docs/spec/plugins.md). Cargar o quitar la
// licencia y activar plugins community es solo del propietario.
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { tenantOf } from "../../middleware/tenant.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { PluginIdSchema } from "@spiderfolio/plugin-sdk";
import {
  activePlugins,
  licenseOverview,
  removeLicense,
  saveLicense,
  setCommunityPlugin,
} from "./plugins.service.ts";

const LicenseBodySchema = z.strictObject({ token: z.string().trim().min(10).max(8000) });
const ActivationSchema = z.strictObject({
  enabled: z.boolean(),
  /** Al activar: confirma que el plugin no está verificado y tiene acceso al servidor. */
  acceptRisk: z.boolean().optional(),
});
const PluginParamsSchema = z.object({ pluginId: PluginIdSchema });

export function pluginRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/plugins",
      handler: async (req, res) => {
        res.json({ plugins: await activePlugins(deps.plugins, tenantOf(req).tenant.workspaceId) });
      },
    },
    {
      method: "get",
      path: "/admin/license",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json(await licenseOverview(adminContextOf(req), deps.plugins));
      },
    },
    {
      method: "put",
      path: "/admin/license",
      ownerOnly: true,
      handler: async (req, res) => {
        const { token } = LicenseBodySchema.parse(req.body);
        const ctx = adminContextOf(req);
        await saveLicense(ctx, deps.plugins, token);
        res.json(await licenseOverview(ctx, deps.plugins));
      },
    },
    {
      // Plugins community (sin licencia): los activa o desactiva el propietario.
      method: "put",
      path: "/admin/plugins/:pluginId/activation",
      ownerOnly: true,
      handler: async (req, res) => {
        const { pluginId } = PluginParamsSchema.parse(req.params);
        const change = ActivationSchema.parse(req.body);
        const ctx = adminContextOf(req);
        await setCommunityPlugin(ctx, deps.plugins, pluginId, change);
        res.json(await licenseOverview(ctx, deps.plugins));
      },
    },
    {
      method: "delete",
      path: "/admin/license",
      ownerOnly: true,
      handler: async (req, res) => {
        await removeLicense(adminContextOf(req), deps.plugins);
        res.status(204).end();
      },
    },
  ];
}
