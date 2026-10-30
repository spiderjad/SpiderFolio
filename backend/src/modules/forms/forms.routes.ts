// /api/v1/w/:slug/spaces/:id/forms and /forms/:id (forms in the tree, docs/spec/formularios.md). No
// capabilities: access decides, in the service (VIEW reads, EDIT changes the template).
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { CursorQuerySchema, pageShape } from "../../lib/pagination.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { SpaceParamsSchema } from "../nodes/nodes.schemas.ts";
import {
  CreateFormSchema,
  FormFileParamsSchema,
  FormParamsSchema,
  FormVersionParamsSchema,
  RecordFileParamsSchema,
  RecordParamsSchema,
  SaveTemplateSchema,
  StartFileSchema,
  SubmitRecordSchema,
} from "./forms.schemas.ts";
import { createForm, getForm, getVersion, listVersions, saveTemplate } from "./forms.service.ts";
import {
  confirmFileUpload,
  getRecord,
  listRecords,
  recordFileUrl,
  startFileUpload,
  submitRecord,
} from "./records.service.ts";

const VersionsQuerySchema = z.object(pageShape(["version"], "version"));

export function formRoutes(deps: Pick<AppDeps, "storage">): TenantRoute[] {
  const fileDeps = { storage: deps.storage };
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
    // Filling it in: photos and the signature first, then the record.
    {
      method: "post",
      path: "/forms/:id/files",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        const upload = await startFileUpload(
          adminContextOf(req),
          fileDeps,
          id,
          StartFileSchema.parse(req.body),
        );
        res.status(201).json(upload);
      },
    },
    {
      method: "post",
      path: "/forms/:id/files/:fileId/confirm",
      handler: async (req, res) => {
        const { id, fileId } = FormFileParamsSchema.parse(req.params);
        res.json(await confirmFileUpload(adminContextOf(req), fileDeps, id, fileId));
      },
    },
    {
      method: "post",
      path: "/forms/:id/records",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        const record = await submitRecord(
          adminContextOf(req),
          id,
          SubmitRecordSchema.parse(req.body),
        );
        res.status(201).json({ record });
      },
    },
    {
      method: "get",
      path: "/forms/:id/records",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        res.json(await listRecords(adminContextOf(req), id, CursorQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/forms/:id/records/:recordId",
      handler: async (req, res) => {
        const { id, recordId } = RecordParamsSchema.parse(req.params);
        res.json(await getRecord(adminContextOf(req), id, recordId));
      },
    },
    {
      method: "get",
      path: "/forms/:id/records/:recordId/files/:fileId",
      handler: async (req, res) => {
        const { id, recordId, fileId } = RecordFileParamsSchema.parse(req.params);
        res.json(await recordFileUrl(adminContextOf(req), fileDeps, id, recordId, fileId));
      },
    },
  ];
}
