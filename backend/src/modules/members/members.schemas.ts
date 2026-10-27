import { z } from "zod";
import { normalizePersonName } from "../../lib/person-name.ts";
import { EmailSchema } from "../auth/auth.schemas.ts";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);
const IdList = z
  .array(Id)
  .max(20)
  .transform((ids) => [...new Set(ids)]);

export const sortFields = [
  "hierarchy",
  "name",
  "email",
  "role",
  "status",
  "createdAt",
  "lastSeenAt",
] as const;

/**
 * Grupos de las tarjetas y filtros: propietario, administradores, miembros y lectores (por rol y
 * plaza, excluyentes) y jefes de departamento (cargo: jefe o subjefe de alguno, sea cual sea el
 * rol). "direction" junta propietario y administradores.
 */
export const memberGroups = [
  "owner",
  "admins",
  "direction",
  "managers",
  "members",
  "readers",
] as const;
export type MemberGroup = (typeof memberGroups)[number];

/** Listado del lado del servidor: búsqueda, filtros, orden y paginación (9.3). */
export const ListMembersQuerySchema = z.object({
  q: SearchParam,
  ids: IdsParam,
  role: Id.optional(),
  /** Un departamento, o "none" para quien no pertenece a ninguno. */
  department: Id.optional(),
  group: z.enum(memberGroups).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  ...pageShape(sortFields, "hierarchy"),
});

/** Organigrama: una rama por pedido (`parent` = "root" o el id de un departamento). */
export const OrgChartQuerySchema = z.object({
  parent: z.union([z.literal("root"), Id]).default("root"),
  ...pageShape(["name"], "name", { defaultPageSize: 10 }),
  preview: z.coerce.number().int().min(1).max(25).default(5),
});

export const OrgSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });

/** Exportación: los mismos filtros y orden que el listado, sin paginación. */
export const ExportMembersQuerySchema = ListMembersQuerySchema.omit({ page: true, pageSize: true });

export const UpdateMemberSchema = z
  .strictObject({
    roleId: Id,
    seatType: z.enum(["FULL", "READER"]),
    departmentIds: IdList,
    jobTitle: z.string().trim().max(80).nullable(),
    name: z.string().trim().min(2).max(80).transform(normalizePersonName),
    email: EmailSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nada que cambiar");

export const UpdateProfileJobSchema = z.strictObject({
  jobTitle: z.string().trim().max(80).nullable(),
});

export const RemoveMemberSchema = z.strictObject({
  /** Quién se queda con lo que creó la persona (se aplica cuando haya contenido). */
  transferToMembershipId: Id.optional(),
});

export const BulkMembersSchema = z.strictObject({
  ids: z
    .array(Id)
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, "Miembros repetidos"),
  action: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("change_role"), roleId: Id }),
    z.strictObject({
      type: z.literal("change_departments"),
      mode: z.enum(["add", "remove", "set"]),
      departmentIds: IdList,
    }),
    z.strictObject({ type: z.literal("change_seat"), seatType: z.enum(["FULL", "READER"]) }),
    z.strictObject({ type: z.literal("suspend") }),
    z.strictObject({ type: z.literal("reactivate") }),
  ]),
});

/** Persona que entra con usuario + PIN (7.6): sin PIN, se genera uno. */
export const CreatePinMemberSchema = z.strictObject({
  name: z.string().trim().min(2).max(80).transform(normalizePersonName),
  loginName: z.string().max(100),
  roleId: Id,
  departmentIds: IdList.default([]),
  pin: z.string().max(12).optional(),
});

export const ResetPinSchema = z.strictObject({ pin: z.string().max(12).optional() });

/** Ajustes del ingreso con PIN del workspace (se cambian de a uno o varios). */
export const PinSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    idleMinutes: z.number().int().min(1).max(30),
    closeAfterConfirm: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nada que cambiar");

/** CSV como texto (la app lee el archivo): hasta ~200 KB. */
export const ImportCsvSchema = z.strictObject({ csv: z.string().min(1).max(200_000) });

// No estricto: req.params también trae workspaceSlug (mergeParams).
export const MemberParamsSchema = z.object({ id: Id });

export type OrgChartQuery = z.infer<typeof OrgChartQuerySchema>;
export type OrgSearchQuery = z.infer<typeof OrgSearchQuerySchema>;
export type ListMembersQuery = z.infer<typeof ListMembersQuerySchema>;
export type ExportMembersQuery = z.infer<typeof ExportMembersQuerySchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type BulkMembersInput = z.infer<typeof BulkMembersSchema>;
