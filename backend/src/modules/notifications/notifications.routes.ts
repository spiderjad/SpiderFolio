// /notifications: la campana de cada persona. Sin capacidades: cada una solo lee y marca las suyas.
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { NotificationParamsSchema, NotificationsQuerySchema } from "./notifications.schemas.ts";
import { listNotifications, markAllRead, markRead, unreadCount } from "./notifications.service.ts";

export function notificationRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/notifications",
      handler: async (req, res) => {
        res.json(
          await listNotifications(adminContextOf(req), NotificationsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/notifications/summary",
      handler: async (req, res) => {
        res.json(await unreadCount(adminContextOf(req)));
      },
    },
    {
      method: "post",
      path: "/notifications/read-all",
      handler: async (req, res) => {
        await markAllRead(adminContextOf(req));
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/notifications/:id/read",
      handler: async (req, res) => {
        const { id } = NotificationParamsSchema.parse(req.params);
        await markRead(adminContextOf(req), id);
        res.status(204).end();
      },
    },
  ];
}
