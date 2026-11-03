// /api/v1/w/:slug/admin/audit-rooms — whoever builds audit rooms (docs/spec/salas-de-auditoria.md): needs
// audit.share; the service limits each one to the rooms they created (the owner sees all).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreateRoomSchema,
  RoomItemParamsSchema,
  RoomItemSchema,
  RoomParamsSchema,
  RoomsQuerySchema,
} from "./rooms.schemas.ts";
import {
  addRoomItem,
  createRoom,
  getRoom,
  listRooms,
  removeRoomItem,
  resendInvite,
  revokeRoom,
} from "./rooms.service.ts";

export function auditRoomRoutes(deps: Pick<AppDeps, "jobs">): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/audit-rooms",
      capability: "audit.share",
      handler: async (req, res) => {
        res.json(await listRooms(adminContextOf(req), RoomsQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/admin/audit-rooms",
      capability: "audit.share",
      handler: async (req, res) => {
        res.status(201).json({
          room: await createRoom(adminContextOf(req), deps.jobs, CreateRoomSchema.parse(req.body)),
        });
      },
    },
    {
      method: "get",
      path: "/admin/audit-rooms/:id",
      capability: "audit.share",
      handler: async (req, res) => {
        const { id } = RoomParamsSchema.parse(req.params);
        res.json({ room: await getRoom(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/admin/audit-rooms/:id/items",
      capability: "audit.share",
      handler: async (req, res) => {
        const { id } = RoomParamsSchema.parse(req.params);
        res.json({
          room: await addRoomItem(adminContextOf(req), id, RoomItemSchema.parse(req.body)),
        });
      },
    },
    {
      method: "delete",
      path: "/admin/audit-rooms/:id/items/:itemId",
      capability: "audit.share",
      handler: async (req, res) => {
        const { id, itemId } = RoomItemParamsSchema.parse(req.params);
        res.json({ room: await removeRoomItem(adminContextOf(req), id, itemId) });
      },
    },
    {
      method: "post",
      path: "/admin/audit-rooms/:id/revoke",
      capability: "audit.share",
      handler: async (req, res) => {
        const { id } = RoomParamsSchema.parse(req.params);
        res.json({ room: await revokeRoom(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/admin/audit-rooms/:id/resend",
      capability: "audit.share",
      handler: async (req, res) => {
        const { id } = RoomParamsSchema.parse(req.params);
        await resendInvite(adminContextOf(req), deps.jobs, id);
        res.status(204).end();
      },
    },
  ];
}
