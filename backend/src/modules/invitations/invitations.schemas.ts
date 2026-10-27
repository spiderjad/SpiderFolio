import { z } from "zod";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { EmailSchema } from "../auth/auth.schemas.ts";

const Id = z.string().min(1).max(64);

/** Invitaciones pendientes: búsqueda por email, estado, orden y página. */
export const ListInvitationsQuerySchema = z.object({
  q: SearchParam,
  status: z.enum(["pending", "expired"]).optional(),
  ...pageShape(["createdAt", "email", "expiresAt"], "createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export const CreateInvitationsSchema = z.strictObject({
  emails: z
    .array(EmailSchema)
    .min(1)
    .max(50)
    .transform((emails) => [...new Set(emails)]),
  roleId: Id,
  /** Si no se indica: lector para un invitado externo y completa para el resto. */
  seatType: z.enum(["FULL", "READER"]).optional(),
  departmentIds: z
    .array(Id)
    .max(20)
    .default([])
    .transform((ids) => [...new Set(ids)]),
});

// No estricto: req.params también trae workspaceSlug (mergeParams).
export const InvitationParamsSchema = z.object({ id: Id });

export type ListInvitationsQuery = z.infer<typeof ListInvitationsQuerySchema>;
export type CreateInvitationsInput = z.infer<typeof CreateInvitationsSchema>;
