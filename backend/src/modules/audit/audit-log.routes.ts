// /api/v1/w/:slug/admin/audit: Administración › Registro de auditoría. Ver pide audit.view; exportar,
// audit.export.
import type { Request } from "express";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  AuditFiltersSchema,
  AuditListQuerySchema,
  auditCsv,
  listAudit,
} from "./audit-log.service.ts";

const HOUR = 3_600_000;

export function auditLogRoutes(deps: AppDeps): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "get",
      path: "/admin/audit",
      capability: "audit.view",
      handler: async (req, res) => {
        res.json(
          await listAudit(adminContextOf(req), deps, AuditListQuerySchema.parse(req.query)),
        );
      },
    },
    {
      // Antes de cualquier ruta con id para que «export» no se lea como un id.
      method: "get",
      path: "/admin/audit/export",
      capability: "audit.export",
      guards: [
        sensitiveRateLimit(deps, { name: "audit-export", windowMs: HOUR, limit: 20, key: byUser }),
      ],
      handler: async (req, res) => {
        const file = await auditCsv(
          adminContextOf(req),
          deps,
          AuditFiltersSchema.parse(req.query),
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="auditoria.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.csv);
      },
    },
  ];
}
