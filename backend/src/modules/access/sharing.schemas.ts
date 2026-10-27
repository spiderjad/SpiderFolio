import { z } from "zod";

const Id = z.string().min(1).max(64);

export const SharingParamsSchema = z.object({ id: Id });

/** Una persona, un departamento o toda la empresa (solo uno), con su nivel y un vencimiento opcional. */
export const SetPermissionSchema = z.strictObject({
  membershipId: Id.optional(),
  departmentId: Id.optional(),
  /** Toda la empresa: todos los miembros activos (sin invitados externos). */
  everyone: z.boolean().optional(),
  level: z.enum(["VIEW", "COMMENT", "EDIT", "MANAGE"]),
  expiresAt: z.coerce.date().nullable().optional(),
  /** Solo con un departamento: el acceso llega también a sus subdepartamentos (por defecto, no). */
  includeSubareas: z.boolean().optional(),
});

export const InheritanceSchema = z.strictObject({ inheritAccess: z.boolean() });

export type SetPermissionInput = z.infer<typeof SetPermissionSchema>;
export type InheritanceInput = z.infer<typeof InheritanceSchema>;
