// Audit rooms (docs/spec/salas-de-auditoria.md): bodies of whoever builds a room and of the auditor.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const MAX_ROOM_DAYS = 30;

export const CreateRoomSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  auditorEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  /** The company day it closes (end of that day). */
  expiresOn: Day,
  allowDownload: z.boolean().default(false),
});

const Range = { from: Day, to: Day };

/** What can go in a room. Never accidents nor fitness (health data): there's no kind for them. */
export const RoomItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("node"), nodeId: Id }),
  z.strictObject({ kind: z.literal("space"), spaceId: Id }),
  z.strictObject({ kind: z.literal("readings"), nodeId: Id }),
  z.strictObject({ kind: z.literal("approvals"), nodeId: Id }),
  z.strictObject({ kind: z.literal("form-records"), formId: Id, ...Range }),
  z.strictObject({ kind: z.literal("training"), courseId: Id }),
  z.strictObject({ kind: z.literal("ppe"), ...Range }),
  z.strictObject({
    kind: z.literal("audit-log"),
    ...Range,
    action: z.string().trim().min(1).max(80).optional(),
  }),
]);

export const RoomsQuerySchema = z.object({ ...pageShape(["createdAt"], "createdAt") });

export const RoomParamsSchema = z.object({ id: Id });
export const RoomItemParamsSchema = z.object({ id: Id, itemId: Id });

// ─── The auditor ─────────────────────────────────────────────────────────────────────────

export const AuditorRoomParamsSchema = z.object({ roomId: Id });
export const AuditorItemParamsSchema = z.object({ roomId: Id, itemId: Id });
export const AuditorCodeSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/u) });
export const AuditorPdfQuerySchema = z.object({
  /** Inside a shared folder or space: which document. */
  node: Id.optional(),
  download: z.enum(["1"]).optional(),
});

export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;
export type RoomItemInput = z.infer<typeof RoomItemSchema>;
