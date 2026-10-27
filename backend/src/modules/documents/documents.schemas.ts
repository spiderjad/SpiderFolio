import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);

export const DocumentNodeParamsSchema = z.object({ id: Id });

export const ConvertSchema = z.strictObject({
  /** Código del tipo (PRC, INS…). */
  docType: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9]+$/u),
  /** Departamento responsable; sin él, el del espacio (o ninguno). */
  ownerDepartmentId: Id.nullable().optional(),
});
export const OwnerDepartmentSchema = z.strictObject({ ownerDepartmentId: Id.nullable() });

export type ConvertInput = z.infer<typeof ConvertSchema>;

/** Enviar a revisión: a quiénes se pide la aprobación (uno o varios; deben aprobar todos). */
export const SubmitSchema = z.strictObject({
  approverIds: z.array(Id).min(1).max(10),
  changeNote: z.string().trim().max(500).optional(),
});
export type SubmitInput = z.infer<typeof SubmitSchema>;

export const DecisionSchema = z.strictObject({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
  comment: z.string().trim().max(1000).optional(),
});
export type DecisionInput = z.infer<typeof DecisionSchema>;

export const ApproversQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

export const MyApprovalsQuerySchema = z.object({ ...pageShape(["submittedAt"], "submittedAt") });
export type MyApprovalsQuery = z.infer<typeof MyApprovalsQuerySchema>;

/** Pedir la lectura de la versión vigente: un departamento (con o sin subáreas) o una persona. */
export const RequirementSchema = z.strictObject({
  departmentId: Id.optional(),
  membershipId: Id.optional(),
  includeSubareas: z.boolean().optional(),
  dueAt: z.coerce.date().nullable().optional(),
});
export type RequirementInput = z.infer<typeof RequirementSchema>;

/** Publicar: si hay que volver a leer la versión nueva (por defecto sí) y el motivo del cambio. */
export const PublishSchema = z.strictObject({
  requestReading: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type PublishInput = z.infer<typeof PublishSchema>;

/** A quién se refiere un aviso de acceso: un requisito, una persona o un departamento. */
export const AccessGapsQuerySchema = z.object({
  departmentId: Id.optional(),
  membershipId: Id.optional(),
  includeSubareas: z.enum(["true", "false"]).optional(),
});
export type AccessGapsQuery = z.infer<typeof AccessGapsQuerySchema>;

/** Darles acceso de lectura: a un requisito, a un sujeto, o (sin nada) a todos los requisitos. */
export const GrantReadingAccessSchema = z.strictObject({
  requirementId: Id.optional(),
  departmentId: Id.optional(),
  membershipId: Id.optional(),
  includeSubareas: z.boolean().optional(),
});
export type GrantReadingAccessInput = z.infer<typeof GrantReadingAccessSchema>;

/** Recordatorio manual: a estas personas, o a todas las que faltan si no se indica ninguna. */
export const RemindSchema = z.strictObject({
  membershipIds: z.array(Id).min(1).max(200).optional(),
});
export type RemindInput = z.infer<typeof RemindSchema>;

export const RequirementParamsSchema = z.object({ id: Id, requirementId: Id });

export const ReadingsQuerySchema = z.object({
  status: z.enum(["read", "pending", "overdue", "noAccess"]).optional(),
  ...pageShape(["name"], "name"),
});
export type ReadingsQuery = z.infer<typeof ReadingsQuerySchema>;

export const MyReadingsQuerySchema = z.object({ ...pageShape(["dueAt"], "dueAt") });
export type MyReadingsQuery = z.infer<typeof MyReadingsQuerySchema>;

export const RecentQuerySchema = z.object({
  ...pageShape(["visitedAt"], "visitedAt", { defaultPageSize: 10 }),
});
export type RecentQuery = z.infer<typeof RecentQuerySchema>;

export const NewsQuerySchema = z.object({ ...pageShape(["publishedAt"], "publishedAt") });
export type NewsQuery = z.infer<typeof NewsQuerySchema>;

/** Qué versión descargar como PDF controlado (por defecto, la vigente). */
export const PdfQuerySchema = z.object({ version: z.coerce.number().int().min(1).optional() });

/** Qué versiones comparar (números de versión); sin ellos, la última contra la vigente. */
export const CompareQuerySchema = z.object({
  /** review: lo que cambió desde la última revisión de quien consulta (en la versión en revisión). */
  since: z.enum(["review"]).optional(),
  from: z.coerce.number().int().min(1).optional(),
  to: z.coerce.number().int().min(1).optional(),
});
export type CompareQuery = z.infer<typeof CompareQuerySchema>;

export const AdminPagedQuerySchema = z.object({ ...pageShape(["code"], "code") });
export type AdminPagedQuery = z.infer<typeof AdminPagedQuerySchema>;

/** Listado de /admin/documents: búsqueda y filtros por estado, departamento y revisión. */
export const AdminDocumentsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z
    .enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "OBSOLETE", "REJECTED"])
    .optional(),
  departmentId: Id.optional(),
  /** due: con la revisión vencida o a menos de 30 días. */
  review: z.enum(["due"]).optional(),
  ...pageShape(["code"], "code"),
});
export type AdminDocumentsQuery = z.infer<typeof AdminDocumentsQuerySchema>;

const TypeFields = {
  name: z.string().trim().min(1).max(60),
  prefix: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/u, { error: () => validationMessages.uppercaseAndDigits }),
  padding: z.number().int().min(1).max(8),
  reviewMonths: z.number().int().min(1).max(60),
};

export const TypeSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/u, { error: () => validationMessages.uppercaseAndDigits }),
  name: TypeFields.name,
  prefix: TypeFields.prefix.optional(),
  padding: TypeFields.padding.optional(),
  reviewMonths: TypeFields.reviewMonths.optional(),
});
export type TypeInput = z.infer<typeof TypeSchema>;

export const TypeUpdateSchema = z.strictObject({
  name: TypeFields.name.optional(),
  prefix: TypeFields.prefix.optional(),
  padding: TypeFields.padding.optional(),
  reviewMonths: TypeFields.reviewMonths.optional(),
  nextNumber: z.number().int().min(1).max(999_999).optional(),
});
export type TypeUpdateInput = z.infer<typeof TypeUpdateSchema>;

export const TypeParamsSchema = z.object({ code: z.string().min(1).max(10) });
