// GET /search/nodes y POST /nodes/resolve: enlaces internos y archivos incrustados en las páginas.
// Sin capacidades: lo que se ve lo decide resolveAccess en el servicio.
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { ResolveNodesSchema, SearchNodesQuerySchema } from "./links.schemas.ts";
import { SharedQuerySchema } from "./shared.schemas.ts";
import { listSharedByMe } from "./shared-by-me.service.ts";
import { countUnseenShared, listSharedWithMe, markSharedSeen } from "./shared.service.ts";
import { NodeParamsSchema } from "./nodes.schemas.ts";
import { resolveNodes, searchNodes } from "./links.service.ts";

export function linkRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/search/nodes",
      handler: async (req, res) => {
        res.json(await searchNodes(adminContextOf(req), SearchNodesQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/shared-with-me",
      handler: async (req, res) => {
        res.json(await listSharedWithMe(adminContextOf(req), SharedQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/shared-by-me",
      handler: async (req, res) => {
        res.json(await listSharedByMe(adminContextOf(req), SharedQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/shared-with-me/summary",
      handler: async (req, res) => {
        res.json(await countUnseenShared(adminContextOf(req)));
      },
    },
    {
      method: "post",
      path: "/nodes/:id/seen",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        await markSharedSeen(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/nodes/resolve",
      handler: async (req, res) => {
        res.json(await resolveNodes(adminContextOf(req), ResolveNodesSchema.parse(req.body)));
      },
    },
  ];
}
