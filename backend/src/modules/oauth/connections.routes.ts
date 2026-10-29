// /api/v1/w/:slug — connected apps (docs/spec/conector-mcp.md): the person's own (Mi perfil) and, for
// the owner, the company's and the connector on/off (Administración › Seguridad).
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  companyConnections,
  ConnectionsQuerySchema,
  ConnectorSchema,
  disconnectAny,
  disconnectMine,
  myConnections,
  setConnector,
} from "./connections.service.ts";

const ParamsSchema = z.object({ id: z.string().min(1).max(64) });

export function connectionsRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/me/connections",
      handler: async (req, res) => {
        res.json(
          await myConnections(adminContextOf(req), deps, ConnectionsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "delete",
      path: "/me/connections/:id",
      handler: async (req, res) => {
        await disconnectMine(adminContextOf(req), deps, ParamsSchema.parse(req.params).id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/admin/connections",
      capability: "security.manage",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json(
          await companyConnections(
            adminContextOf(req),
            deps,
            ConnectionsQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "delete",
      path: "/admin/connections/:id",
      capability: "security.manage",
      ownerOnly: true,
      handler: async (req, res) => {
        await disconnectAny(adminContextOf(req), deps, ParamsSchema.parse(req.params).id);
        res.status(204).end();
      },
    },
    {
      method: "put",
      path: "/admin/connector",
      capability: "security.manage",
      ownerOnly: true,
      handler: async (req, res) => {
        const { enabled } = ConnectorSchema.parse(req.body);
        res.json({ connector: await setConnector(adminContextOf(req), deps, enabled) });
      },
    },
  ];
}
