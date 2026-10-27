import { z } from "zod";
import { NodeNameSchema } from "../../lib/names.ts";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);

export const SpaceParamsSchema = z.object({ id: Id });

export const ListSpacesQuerySchema = z.object({
  q: SearchParam,
  /** "true" lista los archivados (solo quien los gestiona los ve). */
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Filtros rápidos: todos, los de mis departamentos, favoritos o privados. */
  filter: z.enum(["all", "mine", "favorites", "private"]).default("all"),
  /** "department" agrupa por área: primero los de la empresa y luego cada departamento por nombre. */
  ...pageShape(["name", "department", "createdAt", "favorite"], "name"),
});

export const FavoriteSpaceSchema = z.strictObject({ favorite: z.boolean() });

/** Nuevo orden de los favoritos visibles (ids de espacios); el resto queda detrás, en su orden. */
export const FavoriteOrderSchema = z.strictObject({
  ids: z.array(Id).min(1).max(100),
});

/** Nivel de los miembros del departamento en su espacio. */
export const DepartmentLevelSchema = z.enum(["EDIT", "VIEW"]);

const Icon = z.string().trim().min(1).max(40);
/** #rrggbb; se guarda en minúsculas. */
const Color = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, { error: () => validationMessages.colorFormat });

export const CreateSpaceSchema = z.strictObject({
  name: NodeNameSchema,
  icon: Icon.optional(),
  color: Color.optional(),
  description: z.string().trim().max(300).optional(),
  isPrivate: z.boolean().default(false),
  /** Confidencial (implica privado): los administradores no entran solos. */
  isConfidential: z.boolean().default(false),
  /** Espacio de un departamento (sus jefes lo gestionan; sus miembros entran con departmentLevel). */
  departmentId: Id.nullable().optional(),
  departmentLevel: DepartmentLevelSchema.optional(),
  /** Extiende el acceso de miembros a los subdepartamentos (solo en espacios de departamento). */
  includeSubareas: z.boolean().default(false),
});

export const UpdateSpaceSchema = z.strictObject({
  name: NodeNameSchema.optional(),
  icon: Icon.nullable().optional(),
  color: Color.nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  isPrivate: z.boolean().optional(),
  isConfidential: z.boolean().optional(),
  departmentId: Id.nullable().optional(),
  departmentLevel: DepartmentLevelSchema.optional(),
  includeSubareas: z.boolean().optional(),
});

export const AccessLevelSchema = z.enum(["MANAGE", "EDIT", "COMMENT", "VIEW"]);

export const ListSpaceMembersQuerySchema = z.object({
  q: SearchParam,
  ...pageShape(["name"], "name"),
});

/** Departamentos para elegir a quién dar acceso al espacio (paginado, con búsqueda). */
export const DepartmentOptionsQuerySchema = z.object({
  q: SearchParam,
  ...pageShape(["name"], "name"),
});

export type ListSpacesQuery = z.infer<typeof ListSpacesQuerySchema>;
export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof UpdateSpaceSchema>;
export type ListSpaceMembersQuery = z.infer<typeof ListSpaceMembersQuerySchema>;
