// /api/v1/w/:slug/plugins, /admin/license, /admin/plugins and /admin/server (docs/spec/plugins.md).
// Loading or removing the license, turning on community plugins, uploading signed plugins and
// restarting the server are the owner's only.
import express, { type Request } from "express";
import { pluginPackageLimits } from "@spiderfolio/limits";
import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
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
import {
  pluginServerView,
  removePluginPackage,
  requestRestart,
  uploadPluginPackage,
} from "./plugin-packages.service.ts";

const LicenseBodySchema = z.strictObject({ token: z.string().trim().min(10).max(8000) });
const ActivationSchema = z.strictObject({
  enabled: z.boolean(),
  /** Al activar: confirma que el plugin no está verificado y tiene acceso al servidor. */
  acceptRisk: z.boolean().optional(),
});
const PluginParamsSchema = z.object({ pluginId: PluginIdSchema });

export function pluginRoutes(deps: AppDeps): TenantRoute[] {
  const authOf = (req: Request) => {
    if (req.auth === undefined) throw new AppError("UNAUTHENTICATED");
    return req.auth;
  };
  /** License and plugins screen: the license, the installed plugins, the company id and the server. */
  const overview = async (req: Request) => {
    const ctx = adminContextOf(req);
    return {
      ...(await licenseOverview(ctx, deps.plugins)),
      workspaceId: ctx.tenant.workspaceId,
      server: await pluginServerView(deps, authOf(req)),
    };
  };
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
        res.json(await overview(req));
      },
    },
    {
      method: "put",
      path: "/admin/license",
      ownerOnly: true,
      handler: async (req, res) => {
        const { token } = LicenseBodySchema.parse(req.body);
        await saveLicense(adminContextOf(req), deps.plugins, token);
        res.json(await overview(req));
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
        await setCommunityPlugin(adminContextOf(req), deps.plugins, pluginId, change);
        res.json(await overview(req));
      },
    },
    {
      // A signed plugin (.sfplugin) as the raw body; installed for the next restart.
      method: "post",
      path: "/admin/plugins/packages",
      ownerOnly: true,
      guards: [
        express.raw({ type: "application/octet-stream", limit: pluginPackageLimits.maxBytes }),
      ],
      handler: async (req, res) => {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw new AppError("BAD_REQUEST");
        }
        const uploaded = await uploadPluginPackage(
          adminContextOf(req),
          deps,
          authOf(req),
          req.body,
        );
        res.status(201).json({ ...(await overview(req)), uploaded });
      },
    },
    {
      // Removes an uploaded plugin from the server and schedules the restart that unloads it.
      method: "delete",
      path: "/admin/plugins/:pluginId",
      ownerOnly: true,
      handler: async (req, res) => {
        const { pluginId } = PluginParamsSchema.parse(req.params);
        const removed = await removePluginPackage(adminContextOf(req), deps, authOf(req), pluginId);
        res.json({ ...(await overview(req)), ...removed });
      },
    },
    {
      method: "post",
      path: "/admin/server/restart",
      ownerOnly: true,
      handler: async (req, res) => {
        res.status(202).json(await requestRestart(adminContextOf(req), deps, authOf(req)));
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
