// /admin/access/*: auditoría de accesos. Solo con la capacidad permissions.audit (propietario y
// administradores; un rol personalizado si la tiene). Los jefes no la ven: ellos tienen «quién
// accede y por qué» en lo que gestionan.
import type { Response } from "express";
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  FindTargetQuerySchema,
  MatrixCellQuerySchema,
  MatrixQuerySchema,
  PersonParamsSchema,
  PersonQuerySchema,
  ReportParamsSchema,
  SpacesOverviewQuerySchema,
  ReportQuerySchema,
  WhoQuerySchema,
} from "./access-audit.schemas.ts";
import {
  accessMatrix,
  accessReport,
  accessReportCsv,
  findTargets,
  matrixCell,
  whatCanSee,
  whoCanSee,
  whoCanSeeCsv,
} from "./access-audit.service.ts";
import { personItems, spacesOverview } from "./access-people-view.ts";

function sendCsv(res: Response, file: { fileName: string; csv: string }): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="access.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(file.csv);
}

export function accessAuditRoutes(): TenantRoute[] {
  const capability = "permissions.audit" as const;
  return [
    {
      method: "get",
      path: "/admin/access/matrix",
      capability,
      handler: async (req, res) => {
        res.json(await accessMatrix(adminContextOf(req), MatrixQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/admin/access/matrix/cell",
      capability,
      handler: async (req, res) => {
        res.json(await matrixCell(adminContextOf(req), MatrixCellQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/admin/access/targets",
      capability,
      handler: async (req, res) => {
        res.json(await findTargets(adminContextOf(req), FindTargetQuerySchema.parse(req.query)));
      },
    },
    {
      // Antes de /admin/access/who para que "export" no se lea como otra cosa.
      method: "get",
      path: "/admin/access/who/export",
      capability,
      handler: async (req, res) => {
        sendCsv(res, await whoCanSeeCsv(adminContextOf(req), WhoQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/admin/access/who",
      capability,
      handler: async (req, res) => {
        res.json(await whoCanSee(adminContextOf(req), WhoQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/admin/access/spaces",
      capability,
      handler: async (req, res) => {
        res.json(
          await spacesOverview(adminContextOf(req), SpacesOverviewQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/access/people/:membershipId/items",
      capability,
      handler: async (req, res) => {
        const { membershipId } = PersonParamsSchema.parse(req.params);
        res.json(
          await personItems(adminContextOf(req), membershipId, PersonQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/access/people/:membershipId",
      capability,
      handler: async (req, res) => {
        const { membershipId } = PersonParamsSchema.parse(req.params);
        res.json(
          await whatCanSee(adminContextOf(req), membershipId, PersonQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/access/reports/:kind/export",
      capability,
      handler: async (req, res) => {
        const { kind } = ReportParamsSchema.parse(req.params);
        sendCsv(
          res,
          await accessReportCsv(adminContextOf(req), kind, ReportQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/admin/access/reports/:kind",
      capability,
      handler: async (req, res) => {
        const { kind } = ReportParamsSchema.parse(req.params);
        res.json(await accessReport(adminContextOf(req), kind, ReportQuerySchema.parse(req.query)));
      },
    },
  ];
}
