// /api/v1/w/:slug/spaces/:id/forms and /forms/:id (forms in the tree, docs/spec/formularios.md). No
// capabilities: access decides, in the service (VIEW reads, EDIT changes the template).
import { z } from "zod";
import type { TenantRoute } from "../../routes.ts";
import { pageShape } from "../../lib/pagination.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { SpaceParamsSchema } from "../nodes/nodes.schemas.ts";
import {
  CreateFormSchema,
  FormParamsSchema,
  FormVersionParamsSchema,
  SaveTemplateSchema,
} from "./forms.schemas.ts";
import { createForm, getForm, getVersion, listVersions, saveTemplate } from "./forms.service.ts";

const VersionsQuerySchema = z.object(pageShape(["version"], "version"));

export function formRoutes(): TenantRoute[] {
  return [
    {
      method: "post",
      path: "/spaces/:id/forms",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        const form = await createForm(adminContextOf(req), id, CreateFormSchema.parse(req.body));
        res.status(201).json({ form });
      },
    },
    {
      method: "get",
      path: "/forms/:id",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        res.json({ form: await getForm(adminContextOf(req), id) });
      },
    },
    {
      method: "put",
      path: "/forms/:id/template",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        const form = await saveTemplate(
          adminContextOf(req),
          id,
          SaveTemplateSchema.parse(req.body),
        );
        res.json({ form });
      },
    },
    {
      method: "get",
      path: "/forms/:id/versions",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        const query = VersionsQuerySchema.parse(req.query);
        res.json(await listVersions(adminContextOf(req), id, query));
      },
    },
    {
      method: "get",
      path: "/forms/:id/versions/:version",
      handler: async (req, res) => {
        const { id, version } = FormVersionParamsSchema.parse(req.params);
        res.json({ version: await getVersion(adminContextOf(req), id, version) });
      },
    },
  ];
}
