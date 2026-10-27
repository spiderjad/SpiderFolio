// /api/v1/w/:slug/spaces/:id/uploads, /uploads/:id y /files/:id/download (docs/spec/archivos.md).
// Sin capacidades: el acceso lo decide resolveAccess en el servicio. Las subidas están limitadas
// por persona (en Postgres, compartido entre instancias).
import type { Request } from "express";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  DownloadQuerySchema,
  FileParamsSchema,
  ListVersionsQuerySchema,
  PartUrlsSchema,
  SpaceParamsSchema,
  StartUploadSchema,
  UploadParamsSchema,
  VersionParamsSchema,
} from "./files.schemas.ts";
import {
  abortUpload,
  completeUpload,
  downloadFile,
  listVersions,
  partUrls,
  restoreVersion,
  startUpload,
  uploadStatus,
} from "./files.service.ts";

const HOUR = 3_600_000;

export function fileRoutes(deps: AppDeps): TenantRoute[] {
  const fileDeps = {
    storage: deps.storage,
    jobs: deps.jobs,
    ...deps.uploads,
  };
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "post",
      path: "/spaces/:id/uploads",
      guards: [
        sensitiveRateLimit(deps, {
          name: "upload-start",
          windowMs: HOUR,
          limit: 3000,
          key: byUser,
        }),
      ],
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        const upload = await startUpload(
          adminContextOf(req),
          fileDeps,
          id,
          StartUploadSchema.parse(req.body),
        );
        res.status(201).json({ upload });
      },
    },
    {
      method: "get",
      path: "/uploads/:id",
      handler: async (req, res) => {
        const { id } = UploadParamsSchema.parse(req.params);
        res.json(await uploadStatus(adminContextOf(req), fileDeps, id));
      },
    },
    {
      method: "post",
      path: "/uploads/:id/parts",
      handler: async (req, res) => {
        const { id } = UploadParamsSchema.parse(req.params);
        const { partNumbers } = PartUrlsSchema.parse(req.body);
        res.json({ parts: await partUrls(adminContextOf(req), fileDeps, id, partNumbers) });
      },
    },
    {
      method: "post",
      path: "/uploads/:id/complete",
      handler: async (req, res) => {
        const { id } = UploadParamsSchema.parse(req.params);
        res.json(await completeUpload(adminContextOf(req), fileDeps, id));
      },
    },
    {
      method: "delete",
      path: "/uploads/:id",
      handler: async (req, res) => {
        const { id } = UploadParamsSchema.parse(req.params);
        await abortUpload(adminContextOf(req), fileDeps, id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/files/:id/versions",
      handler: async (req, res) => {
        const { id } = FileParamsSchema.parse(req.params);
        res.json(
          await listVersions(adminContextOf(req), id, ListVersionsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/files/:id/versions/:version/restore",
      handler: async (req, res) => {
        const { id, version } = VersionParamsSchema.parse(req.params);
        res.json({ node: await restoreVersion(adminContextOf(req), id, version) });
      },
    },
    {
      method: "get",
      path: "/files/:id/download",
      handler: async (req, res) => {
        const { id } = FileParamsSchema.parse(req.params);
        res.json(
          await downloadFile(
            adminContextOf(req),
            fileDeps,
            id,
            DownloadQuerySchema.parse(req.query),
          ),
        );
      },
    },
  ];
}
