// /admin/documents/*: listado, bandeja, cumplimiento y numeración. Con las capacidades de documentos
// ve toda la empresa; un jefe o subjefe (leaderAccess), solo su área (lo acota el servicio).
import type { Request } from "express";
import { z } from "zod";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  complianceByDepartment,
  complianceByDocument,
  createType,
  exportMasterList,
  listDocuments,
  listTypes,
  pendingApprovals,
  updateType,
} from "./admin-documents.service.ts";
import {
  AdminDocumentsQuerySchema,
  AdminPagedQuerySchema,
  TypeParamsSchema,
  TypeSchema,
  TypeUpdateSchema,
} from "./documents.schemas.ts";

const access = {
  anyCapability: ["documents.approve", "documents.require_reading"],
  leaderAccess: true,
} as const;

/** The list and the readings' compliance: also for the health and safety managers (courses). */
const withSafety = {
  anyCapability: ["documents.approve", "documents.require_reading", "safety.manage"],
  leaderAccess: true,
} as const;

const HOUR = 3_600_000;
const ExportParams = z.object({ format: z.enum(["csv", "pdf"]) });

export function adminDocumentRoutes(deps: AppDeps): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    // The master list: the list's filters, as CSV or PDF (recorded in the audit log).
    {
      method: "get",
      path: "/admin/documents/export/:format",
      ...withSafety,
      guards: [
        sensitiveRateLimit(deps, { name: "master-list", windowMs: HOUR, limit: 30, key: byUser }),
      ],
      handler: async (req, res) => {
        const { format } = ExportParams.parse(req.params);
        const { q, status, departmentId, review } = AdminDocumentsQuerySchema.parse(req.query);
        const file = await exportMasterList(
          adminContextOf(req),
          { gotenbergUrl: deps.env.GOTENBERG_URL },
          { q, status, departmentId, review },
          format,
        );
        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(typeof file.body === "string" ? file.body : Buffer.from(file.body));
      },
    },
    {
      method: "get",
      path: "/admin/documents",
      ...withSafety,
      handler: async (req, res) => {
        res.json(
          await listDocuments(adminContextOf(req), AdminDocumentsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/documents/approvals",
      ...access,
      handler: async (req, res) => {
        res.json(
          await pendingApprovals(adminContextOf(req), AdminPagedQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/documents/compliance/departments",
      ...withSafety,
      handler: async (req, res) => {
        res.json(
          await complianceByDepartment(adminContextOf(req), AdminPagedQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/documents/compliance",
      ...withSafety,
      handler: async (req, res) => {
        res.json(
          await complianceByDocument(adminContextOf(req), AdminPagedQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/documents/types",
      ...access,
      handler: async (req, res) => {
        res.json({ items: await listTypes(adminContextOf(req)) });
      },
    },
    {
      method: "post",
      path: "/admin/documents/types",
      capability: "workspace.settings",
      handler: async (req, res) => {
        res
          .status(201)
          .json({ items: await createType(adminContextOf(req), TypeSchema.parse(req.body)) });
      },
    },
    {
      method: "patch",
      path: "/admin/documents/types/:code",
      capability: "workspace.settings",
      handler: async (req, res) => {
        const { code } = TypeParamsSchema.parse(req.params);
        res.json({
          items: await updateType(adminContextOf(req), code, TypeUpdateSchema.parse(req.body)),
        });
      },
    },
  ];
}
