// Papelera: /spaces/:id/trash, /nodes/:id (borrar), /nodes/:id/restore y /nodes/:id/purge. Sin
// capacidades: borrar y restaurar piden MANAGE sobre el nodo (resolveAccess, en el servicio).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { ListTrashQuerySchema, NodeParamsSchema, SpaceParamsSchema } from "./trash.schemas.ts";
import { listTrash, purgeNode, restoreNode, trashNode } from "./trash.service.ts";

export function trashRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/spaces/:id/trash",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json(await listTrash(adminContextOf(req), id, ListTrashQuerySchema.parse(req.query)));
      },
    },
    {
      method: "delete",
      path: "/nodes/:id",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        await trashNode(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/nodes/:id/restore",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json({ node: await restoreNode(adminContextOf(req), id) });
      },
    },
    {
      method: "delete",
      path: "/nodes/:id/purge",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        await purgeNode(adminContextOf(req), deps.jobs, id);
        res.status(204).end();
      },
    },
  ];
}
