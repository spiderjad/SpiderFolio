// /spaces/:id/import-plan, /files/:id/import-zip e /imports/:id (docs/spec/adopcion.md, 9C.2).
// Sin capacidades: el acceso lo decide resolveAccess en el servicio.
import type { Request } from "express";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  FileParamsSchema,
  ImportParamsSchema,
  ImportPlanSchema,
  SpaceParamsSchema,
  StartZipImportSchema,
} from "./imports.schemas.ts";
import { getImport, planImport, startZipImport } from "./imports.service.ts";

const HOUR = 3_600_000;

export function importRoutes(deps: AppDeps): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "post",
      path: "/spaces/:id/import-plan",
      guards: [
        sensitiveRateLimit(deps, { name: "import-plan", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res
          .status(201)
          .json(
            await planImport(adminContextOf(req), id, ImportPlanSchema.parse(req.body)),
          );
      },
    },
    {
      method: "post",
      path: "/files/:id/import-zip",
      guards: [
        sensitiveRateLimit(deps, { name: "import-zip", windowMs: HOUR, limit: 30, key: byUser }),
      ],
      handler: async (req, res) => {
        const { id } = FileParamsSchema.parse(req.params);
        const job = await startZipImport(
          adminContextOf(req),
          deps.jobs,
          id,
          StartZipImportSchema.parse(req.body ?? {}),
        );
        res.status(202).json({ import: job });
      },
    },
    {
      method: "get",
      path: "/imports/:id",
      handler: async (req, res) => {
        const { id } = ImportParamsSchema.parse(req.params);
        res.json({ import: await getImport(adminContextOf(req), id) });
      },
    },
  ];
}
