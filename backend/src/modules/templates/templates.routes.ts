// Company templates (docs/spec/plantillas.md). The services check the plugin's feature (404 without it)
// and who manages templates; using one asks to be able to create in the destination.
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  deleteTemplate,
  getTemplate,
  listTemplates,
  saveAsTemplate,
  templateCategories,
  updateTemplate,
  useTemplate,
} from "./templates.service.ts";
import type { PackDeps } from "./packs.service.ts";
import {
  SaveTemplateSchema,
  TemplateParams,
  TemplatesQuerySchema,
  UpdateTemplateSchema,
  UseTemplateSchema,
} from "./templates.schemas.ts";
import { InstallPackSchema, installPack, listPacks, PackParams } from "./packs.service.ts";

export function templateRoutes(deps: AppDeps): TenantRoute[] {
  const templateDeps: PackDeps = { storage: deps.storage, plugins: deps.plugins };
  return [
    // Before /templates/:id, so «packs» isn't read as an id.
    {
      method: "get",
      path: "/templates/packs",
      handler: async (req, res) => {
        res.json({ packs: await listPacks(adminContextOf(req), templateDeps) });
      },
    },
    {
      method: "post",
      path: "/templates/packs/:pluginId/:packId/install",
      handler: async (req, res) => {
        const { pluginId, packId } = PackParams.parse(req.params);
        const input = InstallPackSchema.parse(req.body);
        res
          .status(201)
          .json(await installPack(adminContextOf(req), templateDeps, pluginId, packId, input));
      },
    },
    {
      method: "get",
      path: "/templates",
      handler: async (req, res) => {
        res.json(
          await listTemplates(
            adminContextOf(req),
            templateDeps,
            TemplatesQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "get",
      path: "/templates/categories",
      handler: async (req, res) => {
        res.json({ categories: await templateCategories(adminContextOf(req), templateDeps) });
      },
    },
    {
      method: "get",
      path: "/templates/:id",
      handler: async (req, res) => {
        const { id } = TemplateParams.parse(req.params);
        res.json({ template: await getTemplate(adminContextOf(req), templateDeps, id) });
      },
    },
    {
      method: "patch",
      path: "/templates/:id",
      handler: async (req, res) => {
        const { id } = TemplateParams.parse(req.params);
        const input = UpdateTemplateSchema.parse(req.body);
        res.json({ template: await updateTemplate(adminContextOf(req), templateDeps, id, input) });
      },
    },
    {
      method: "delete",
      path: "/templates/:id",
      handler: async (req, res) => {
        const { id } = TemplateParams.parse(req.params);
        await deleteTemplate(adminContextOf(req), templateDeps, id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/templates/:id/use",
      handler: async (req, res) => {
        const { id } = TemplateParams.parse(req.params);
        const input = UseTemplateSchema.parse(req.body);
        res.status(201).json(await useTemplate(adminContextOf(req), templateDeps, id, input));
      },
    },
    {
      method: "post",
      path: "/nodes/:id/template",
      handler: async (req, res) => {
        const { id } = TemplateParams.parse(req.params);
        const input = SaveTemplateSchema.parse(req.body);
        res
          .status(201)
          .json({ template: await saveAsTemplate(adminContextOf(req), templateDeps, id, input) });
      },
    },
  ];
}
