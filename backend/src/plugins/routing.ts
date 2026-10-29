// Rutas de los plugins como rutas de tenant (docs/spec/plugins.md): /api/v1/w/:slug/plugins/<id>/…,
// detrás de la misma cadena que las del núcleo (sesión, tenant, 2FA obligatoria, capacidades). Si el
// plugin no está activo en el workspace, responde 404: para esa empresa la ruta no existe.
import type { PluginRequestContext } from "@spiderfolio/plugin-sdk/backend";
import type { Request, RequestHandler } from "express";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError, notFound } from "../lib/errors.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import { auditInfo, tenantOf } from "../middleware/tenant.ts";
import { audit } from "../modules/audit/audit.service.ts";
import { requireRecentMfa } from "../modules/auth/mfa.service.ts";
import { isCapability, type Capability } from "../modules/roles/capabilities.ts";
import type { TenantRoute } from "../routes.ts";
import type { PluginRuntime } from "./runtime.ts";

function capabilityList(value: string | readonly string[] | undefined): Capability[] {
  const list = value === undefined ? [] : typeof value === "string" ? [value] : [...value];
  for (const capability of list) {
    if (!isCapability(capability)) throw new Error(`Capacidad desconocida: ${capability}`);
  }
  return list as Capability[];
}

/** 404 si el plugin no está activo en el workspace del pedido. */
export function requirePluginActive(plugins: PluginRuntime, pluginId: string): RequestHandler {
  return async (req, _res, next) => {
    if (!(await plugins.isActive(tenantOf(req).tenant.workspaceId, pluginId))) throw notFound();
    next();
  };
}

function requestContext(
  deps: { prisma: PrismaClient; plugins: PluginRuntime },
  pluginId: string,
  req: Request,
): PluginRequestContext {
  const { tenant, db } = tenantOf(req);
  const auth = req.auth;
  if (auth === undefined) throw new AppError("UNAUTHENTICATED");
  return {
    ...deps.plugins.contextFor(tenant.workspaceId, pluginId, auditInfo(req)),
    userId: auth.userId,
    membershipId: tenant.membershipId,
    roleBase: tenant.role.base,
    capabilities: tenant.capabilities,
    async audit(entry) {
      await audit(db, {
        ...auditInfo(req),
        action: `plugin.${pluginId}.${entry.action}`,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ...(entry.metadata === undefined
          ? {}
          : { metadata: entry.metadata as Prisma.InputJsonObject }),
      });
    },
    requireRecentMfa: () => requireRecentMfa(deps.prisma, auth),
    async hasOwnMfa() {
      const user = await deps.prisma.user.findUnique({
        where: { id: auth.userId },
        select: { totpEnabledAt: true },
      });
      return user?.totpEnabledAt != null;
    },
  };
}

export function pluginTenantRoutes(deps: {
  prisma: PrismaClient;
  plugins: PluginRuntime;
}): TenantRoute[] {
  return deps.plugins.installed.flatMap((plugin) =>
    (plugin.backend?.routes ?? []).map((route): TenantRoute => {
      const pluginId = plugin.manifest.id;
      const required = capabilityList(route.capability);
      const any = capabilityList(route.anyCapability);
      return {
        method: route.method,
        path: `/plugins/${pluginId}${route.path === "/" ? "" : route.path}`,
        ...(required.length === 0 ? {} : { capability: required }),
        ...(any.length === 0 ? {} : { anyCapability: any }),
        ...(route.ownerOnly === true ? { ownerOnly: true } : {}),
        guards: [requirePluginActive(deps.plugins, pluginId)],
        handler: async (req, res) => {
          await route.handler(req, res, requestContext(deps, pluginId, req));
        },
      };
    }),
  );
}
