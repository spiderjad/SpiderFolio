// /api/v1/w/:slug/admin/positions (docs/spec/seguridad-salud.md, «Puestos»).
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreatePositionSchema,
  ListPositionsQuerySchema,
  PositionParamsSchema,
  UpdatePositionSchema,
} from "./positions.schemas.ts";
import {
  createPosition,
  deletePosition,
  listPositions,
  updatePosition,
} from "./positions.service.ts";

export function positionRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/positions",
      // Also for whoever manages people (to assign one), the department leaders (to filter) and the
      // occupational health and safety managers (positions that need each PPE).
      anyCapability: ["departments.manage", "members.view", "members.manage", "safety.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(
          await listPositions(adminContextOf(req), ListPositionsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/admin/positions",
      capability: "departments.manage",
      handler: async (req, res) => {
        const position = await createPosition(
          adminContextOf(req),
          CreatePositionSchema.parse(req.body),
        );
        res.status(201).json({ position });
      },
    },
    {
      method: "patch",
      path: "/admin/positions/:id",
      capability: "departments.manage",
      handler: async (req, res) => {
        const { id } = PositionParamsSchema.parse(req.params);
        const position = await updatePosition(
          adminContextOf(req),
          id,
          UpdatePositionSchema.parse(req.body),
        );
        res.json({ position });
      },
    },
    {
      method: "delete",
      path: "/admin/positions/:id",
      capability: "departments.manage",
      handler: async (req, res) => {
        const { id } = PositionParamsSchema.parse(req.params);
        await deletePosition(adminContextOf(req), id);
        res.status(204).end();
      },
    },
  ];
}
