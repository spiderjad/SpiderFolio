import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Name = z.string().trim().min(2).max(60);
const Description = z.string().trim().max(200).nullable();
/** #rrggbb; se guarda en minúsculas. */
const Color = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, { error: () => validationMessages.colorFormat })
  .nullable();
const Id = z.string().min(1).max(64);

export const CreateDepartmentSchema = z.strictObject({
  name: Name,
  description: Description.optional(),
  color: Color.optional(),
  parentId: Id.nullable().optional(),
  /** Jefe del departamento: entra a la pertenencia con cargo HEAD. */
  headId: Id.nullable().optional(),
  /** Crear también el espacio del departamento (sus jefes lo gestionan, sus miembros editan). */
  createSpace: z.boolean().default(false),
});

export const UpdateDepartmentSchema = z
  .strictObject({
    name: Name,
    description: Description,
    color: Color,
    parentId: Id.nullable(),
    headId: Id.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nada que cambiar");

/** Tabla de departamentos: búsqueda, filtro por departamento padre ("root" = sin padre), orden y página. */
export const ListDepartmentsQuerySchema = z.object({
  q: SearchParam,
  parent: z.union([z.literal("root"), Id]).optional(),
  /** Solo los que lidera quien consulta (quien tiene capacidades con alcance propio). */
  led: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ...pageShape(["name", "members"], "name"),
});

/**
 * Selectores (combobox con búsqueda en el servidor): búsqueda, página y, para mostrar lo ya
 * elegido, los ids pedidos (hasta 50).
 */
export const DepartmentOptionsQuerySchema = z.object({
  q: SearchParam,
  ids: IdsParam,
  ...pageShape(["name"], "name"),
});

/**
 * Personas de un departamento, paginadas. `positions`: "leaders" (jefe y subjefes), "members"
 * (solo miembros, sin cargo) o "all" (por defecto).
 */
export const DepartmentMembersQuerySchema = z.object({
  q: SearchParam,
  positions: z.enum(["all", "leaders", "members"]).default("all"),
  ...pageShape(["name"], "name"),
});

export const SetPositionSchema = z.strictObject({
  position: z.enum(["HEAD", "DEPUTY", "MEMBER"]),
});

export const MoveDepartmentMemberSchema = z.strictObject({ toDepartmentId: Id });

export const AddDepartmentMembersSchema = z.strictObject({
  membershipIds: z
    .array(Id)
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, "Miembros repetidos"),
});

// No estrictos: req.params también trae workspaceSlug (mergeParams).
export const DepartmentParamsSchema = z.object({ id: Id });
export const DepartmentMemberParamsSchema = z.object({ id: Id, membershipId: Id });

export type DepartmentOptionsQuery = z.infer<typeof DepartmentOptionsQuerySchema>;
export type ListDepartmentsQuery = z.infer<typeof ListDepartmentsQuerySchema>;
export type DepartmentMembersQuery = z.infer<typeof DepartmentMembersQuerySchema>;
export type CreateDepartmentInput = z.infer<typeof CreateDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentSchema>;
