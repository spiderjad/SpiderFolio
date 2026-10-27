import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

export const NotificationsQuerySchema = z.object({
  ...pageShape(["createdAt"], "createdAt"),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;

export const NotificationParamsSchema = z.object({ id: z.string().min(1).max(64) });
