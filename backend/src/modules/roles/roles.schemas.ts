import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { isCapability } from "./capabilities.ts";
import { customRoleBases } from "./role-rules.ts";
import { validationMessages } from "../../i18n/index.ts";

const Name = z.string().trim().min(2).max(60);
const Description = z.string().trim().max(200).nullable();
/** Del núcleo o de un plugin instalado. */
const Capabilities = z
  .array(z.string().refine(isCapability, { error: () => validationMessages.unknownCapability }))
  .max(200)
  .refine((list) => new Set(list).size === list.length, "Capacidades repetidas");

/** Tabla de roles: búsqueda, tipo (de sistema o personalizado), orden por nivel, nombre o personas. */
export const ListRolesQuerySchema = z.object({
  q: SearchParam,
  kind: z.enum(["system", "custom"]).optional(),
  ...pageShape(["level", "name", "members"], "level"),
});

/** Combobox de roles: búsqueda, página y ids ya elegidos. */
export const RoleOptionsQuerySchema = z.object({
  q: SearchParam,
  ids: IdsParam,
  ...pageShape(["level", "name"], "level"),
});

export const CreateRoleSchema = z.strictObject({
  name: Name,
  description: Description.optional(),
  base: z.enum(customRoleBases),
  capabilities: Capabilities,
});

export const UpdateRoleSchema = z
  .strictObject({
    name: Name,
    description: Description,
    base: z.enum(customRoleBases),
    capabilities: Capabilities,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nada que cambiar");

// No estricto: req.params también trae workspaceSlug (mergeParams).
export const IdParamsSchema = z.object({ id: z.string().min(1).max(64) });
export type RoleOptionsQuery = z.infer<typeof RoleOptionsQuerySchema>;
export type ListRolesQuery = z.infer<typeof ListRolesQuerySchema>;
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
