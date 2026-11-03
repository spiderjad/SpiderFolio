// Expiries of files and pages (docs/spec/vencimientos.md). The service checks who sees and sets what.
import type { Request } from "express";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  ExpiryFiltersSchema,
  ListExpiriesQuerySchema,
  NodeParamsSchema,
  OptionsQuerySchema,
  SetNodeExpirySchema,
} from "./node-expiries.schemas.ts";
import {
  exportExpiries,
  getNodeExpiry,
  listExpiries,
  myExpiries,
  removeNodeExpiry,
  responsibleOptions,
  setNodeExpiry,
  spaceExpiries,
} from "./node-expiries.service.ts";

const HOUR = 3_600_000;

export function nodeExpiryRoutes(deps: Pick<AppDeps, "prisma" | "env">): TenantRoute[] {
  const byUser = (req: Request) => req.auth?.userId ?? "";
  return [
    {
      method: "get",
      path: "/nodes/:id/expiry",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json(await getNodeExpiry(adminContextOf(req), id));
      },
    },
    {
      method: "put",
      path: "/nodes/:id/expiry",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json(await setNodeExpiry(adminContextOf(req), id, SetNodeExpirySchema.parse(req.body)));
      },
    },
    {
      method: "delete",
      path: "/nodes/:id/expiry",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        await removeNodeExpiry(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/nodes/:id/expiry/responsible-options",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        const { q } = OptionsQuerySchema.parse(req.query);
        res.json(await responsibleOptions(adminContextOf(req), id, q));
      },
    },
    {
      method: "get",
      path: "/expiries",
      handler: async (req, res) => {
        res.json(await listExpiries(adminContextOf(req), ListExpiriesQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/expiries/export",
      guards: [
        sensitiveRateLimit(deps, { name: "expiries-export", windowMs: HOUR, limit: 30, key: byUser }),
      ],
      handler: async (req, res) => {
        const file = await exportExpiries(adminContextOf(req), ExpiryFiltersSchema.parse(req.query));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="vencimientos.csv"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.body);
      },
    },
    {
      method: "get",
      path: "/expiries/mine",
      handler: async (req, res) => {
        res.json(await myExpiries(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/expiries/mine/count",
      handler: async (req, res) => {
        res.json({ count: (await myExpiries(adminContextOf(req))).total });
      },
    },
    {
      method: "get",
      path: "/expiries/space/:id",
      handler: async (req, res) => {
        const { id } = NodeParamsSchema.parse(req.params);
        res.json({ items: await spaceExpiries(adminContextOf(req), id) });
      },
    },
  ];
}
