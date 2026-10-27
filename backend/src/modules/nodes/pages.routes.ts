// /api/v1/w/:slug/spaces/:id/pages y /pages/:id (páginas del árbol). Sin capacidades: el acceso
// lo decide resolveAccess en el servicio (VIEW lee, EDIT guarda).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreatePageSchema,
  PageImageParamsSchema,
  PageParamsSchema,
  SavePageSchema,
  SpaceParamsSchema,
  UploadImageSchema,
} from "./nodes.schemas.ts";
import { mentionDepsOf } from "../comments/mentions.service.ts";
import { confirmImageUpload, imageUrl, startImageUpload } from "./page-images.service.ts";
import { createPage, duplicatePage, getPage, savePage } from "./pages.service.ts";

export function pageRoutes(deps: AppDeps): TenantRoute[] {
  const imageDeps = { storage: deps.storage };
  return [
    {
      method: "post",
      path: "/spaces/:id/pages",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        const page = await createPage(adminContextOf(req), id, CreatePageSchema.parse(req.body));
        res.status(201).json({ page });
      },
    },
    {
      method: "get",
      path: "/pages/:id",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        res.json({ page: await getPage(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/pages/:id/duplicate",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        res.status(201).json({ page: await duplicatePage(adminContextOf(req), imageDeps, id) });
      },
    },
    {
      method: "post",
      path: "/pages/:id/images",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        res
          .status(201)
          .json(
            await startImageUpload(
              adminContextOf(req),
              imageDeps,
              id,
              UploadImageSchema.parse(req.body),
            ),
          );
      },
    },
    {
      method: "post",
      path: "/pages/:id/images/:imageId/confirm",
      handler: async (req, res) => {
        const { id, imageId } = PageImageParamsSchema.parse(req.params);
        res.json(await confirmImageUpload(adminContextOf(req), imageDeps, id, imageId));
      },
    },
    {
      method: "get",
      path: "/pages/:id/images/:imageId",
      handler: async (req, res) => {
        const { id, imageId } = PageImageParamsSchema.parse(req.params);
        res.json(await imageUrl(adminContextOf(req), imageDeps, id, imageId));
      },
    },
    {
      method: "put",
      path: "/pages/:id/content",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        res.json(
          await savePage(
            adminContextOf(req),
            mentionDepsOf(deps),
            id,
            SavePageSchema.parse(req.body),
          ),
        );
      },
    },
  ];
}
