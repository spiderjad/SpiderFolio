// /admin/documents/*: listado, bandeja, cumplimiento y numeración. Con las capacidades de documentos
// ve toda la empresa; un jefe o subjefe (leaderAccess), solo su área (lo acota el servicio).
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  complianceByDepartment,
  complianceByDocument,
  createType,
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

export function adminDocumentRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/documents",
      ...access,
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
      ...access,
      handler: async (req, res) => {
        res.json(
          await complianceByDepartment(adminContextOf(req), AdminPagedQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/documents/compliance",
      ...access,
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
