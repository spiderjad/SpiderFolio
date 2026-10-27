// /api/v1/w/:slug/spaces/:id/nodes y /nodes/:id (docs/spec/modelo-de-datos.md). Sin capacidades:
// el acceso lo decide resolveAccess en el servicio (sin acceso, 404).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreateFolderSchema,
  DownloadZipSchema,
  ListNodesQuerySchema,
  MoveNodeSchema,
  NodeParamsSchema,
  SpaceParamsSchema,
  UpdateNodeSchema,
} from "./nodes.schemas.ts";
import { requestZipDownload } from "../downloads/downloads.service.ts";
import { createFolder, getNode, listChildren, moveNode, updateNode } from "./nodes.service.ts";

export function nodeRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/spaces/:id/nodes",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json(
          await listChildren(adminContextOf(req), id, ListNodesQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/spaces/:id/folders",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        const node = await createFolder(
          adminContextOf(req),
          id,
          CreateFolderSchema.parse(req.body),
        );
        res.status(201).json({ node });
      },
    },
    {
      // Pide la descarga de la selección como ZIP: devuelve un token de un solo uso para la descarga
      // directa (hasta 500 MB) o encola la generación en segundo plano (ver modules/downloads).
      method: "post",
      path: "/spaces/:id/download-zip",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        const { nodeIds } = DownloadZipSchema.parse(req.body);
        res.json(await requestZipDownload(adminContextOf(req), deps, id, nodeIds));
      },
    },
    {
      method: "get",
      path: "/nodes/:id",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json(await getNode(adminContextOf(req), id));
      },
    },
    {
      method: "patch",
      path: "/nodes/:id",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json({
          node: await updateNode(adminContextOf(req), id, UpdateNodeSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/nodes/:id/move",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json({ node: await moveNode(adminContextOf(req), id, MoveNodeSchema.parse(req.body)) });
      },
    },
  ];
}
