// /api/v1/w/:slug/spaces/:id/forms and /forms/:id (forms in the tree, docs/spec/formularios.md). No
// capabilities: access decides, in the service (VIEW reads, EDIT changes the template).
import type { Request } from "express";
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { pageShape } from "../../lib/pagination.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { SpaceParamsSchema } from "../nodes/nodes.schemas.ts";
import {
  CreateFormSchema,
  ExportParamsSchema,
  FormFileParamsSchema,
  FormParamsSchema,
  FormVersionParamsSchema,
  RecordFileParamsSchema,
  RecordFiltersSchema,
  RecordListQuerySchema,
  RecordParamsSchema,
  SaveTemplateSchema,
  SettingsSchema,
  StartFileSchema,
  SubmitRecordSchema,
  VoidRecordSchema,
} from "./forms.schemas.ts";
import { exportRecords } from "./records-export.ts";
import { createForm, getForm, getVersion, listVersions, saveTemplate } from "./forms.service.ts";
import { pendingForMe, saveSettings } from "./settings.service.ts";
import {
  confirmFileUpload,
  getRecord,
  listRecords,
  recordFileUrl,
  startFileUpload,
  submitRecord,
  voidRecord,
} from "./records.service.ts";

const VersionsQuerySchema = z.object(pageShape(["version"], "version"));

const HOUR = 3_600_000;

export function formRoutes(
  deps: Pick<AppDeps, "storage" | "jobs" | "prisma" | "env">,
): TenantRoute[] {
  const fileDeps = { storage: deps.storage };
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    // Before /forms/:id: the periodic forms the person has to fill in now.
    {
      method: "get",
      path: "/forms/pending",
      handler: async (req, res) => {
        res.json({ items: await pendingForMe(adminContextOf(req)) });
      },
    },
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
      method: "put",
      path: "/forms/:id/settings",
      handler: async (req, res) => {
        const { id } = FormParamsSchema.parse(req.params);
        res.json({
          settings: await saveSettings(adminContextOf(req), id, SettingsSchema.parse(req.body)),
        });
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
          { jobs: deps.jobs },
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
        res.json(
          await listRecords(adminContextOf(req), id, RecordListQuerySchema.parse(req.query)),
        );
      },
    },
    {
      // The records the person sees, with the list's filters, as a CSV or a PDF.
      method: "get",
      path: "/forms/:id/export/:format",
      guards: [
        sensitiveRateLimit(deps, { name: "form-export", windowMs: HOUR, limit: 30, key: byUser }),
      ],
      handler: async (req, res) => {
        const { id, format } = ExportParamsSchema.parse(req.params);
        const file = await exportRecords(
          adminContextOf(req),
          { gotenbergUrl: deps.env.GOTENBERG_URL },
          id,
          format,
          RecordFiltersSchema.parse(req.query),
        );
        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="registros.${format}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(typeof file.body === "string" ? file.body : Buffer.from(file.body));
      },
    },
    {
      method: "post",
      path: "/forms/:id/records/:recordId/void",
      handler: async (req, res) => {
        const { id, recordId } = RecordParamsSchema.parse(req.params);
        const record = await voidRecord(
          adminContextOf(req),
          id,
          recordId,
          VoidRecordSchema.parse(req.body),
        );
        res.json({ record });
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
