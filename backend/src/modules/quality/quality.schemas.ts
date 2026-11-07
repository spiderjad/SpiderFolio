// Food quality (docs/spec/calidad.md): bodies and filters of nonconformities, their actions and checks.
import { z } from "zod";
import { qualityLimits } from "@spiderfolio/limits";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();

export const ncOrigins = [
  "INTERNAL",
  "CCP",
  "AUDIT_INTERNAL",
  "AUDIT_EXTERNAL",
  "COMPLAINT",
  "SUPPLIER",
  "LAB",
  "OTHER",
] as const;
export const severities = ["MINOR", "MAJOR", "CRITICAL"] as const;
export const ncStatuses = [
  "OPEN",
  "ANALYSIS",
  "ACTIONS",
  "VERIFICATION",
  "CLOSED",
  "CANCELLED",
] as const;
export const actionKinds = ["CORRECTION", "CORRECTIVE", "PREVENTIVE"] as const;
/** The 6M of an Ishikawa diagram. */
export const ishikawaBranches = [
  "people",
  "method",
  "machine",
  "material",
  "measurement",
  "environment",
] as const;

export const UpdateQualitySchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    standards: z
      .array(z.enum(["IFS8", "BRCGS9"]))
      .max(2)
      .optional(),
    verifyDays: z
      .number()
      .int()
      .min(qualityLimits.verifyDaysMin)
      .max(qualityLimits.verifyDaysMax)
      .optional(),
    responseDays: z
      .number()
      .int()
      .min(qualityLimits.responseDaysMin)
      .max(qualityLimits.responseDaysMax)
      .optional(),
  })
  .refine(
    (value) =>
      value.enabled !== undefined ||
      value.standards !== undefined ||
      value.verifyDays !== undefined ||
      value.responseDays !== undefined,
    { error: () => validationMessages.noChanges },
  );

/** What anyone writes when reporting a nonconformity. */
export const ReportNcSchema = z.strictObject({
  title: Text(qualityLimits.titleMax),
  description: Text(qualityLimits.descriptionMax),
  detectedOn: Day,
  location: Optional(120),
  productAffected: z.boolean().default(false),
  productNote: Optional(qualityLimits.analysisMax),
  correction: Optional(qualityLimits.analysisMax),
});

/** A nonconformity created by quality.manage: also its origin, severity, owner and department. */
export const CreateNcSchema = ReportNcSchema.extend({
  origin: z.enum(ncOrigins),
  severity: z.enum(severities),
  ownerId: Id,
  departmentId: Id.nullable().default(null),
  /** With origin SUPPLIER: the supplier it's about (phase 4). */
  supplierId: Id.nullable().default(null),
});

const Whys = z.strictObject({
  whys: z.array(z.string().trim().max(qualityLimits.analysisMax)).max(qualityLimits.whysMax),
});
const Ishikawa = z.strictObject({
  branches: z.strictObject(
    Object.fromEntries(
      ishikawaBranches.map((branch) => [
        branch,
        z.string().trim().max(qualityLimits.analysisMax).default(""),
      ]),
    ) as Record<(typeof ishikawaBranches)[number], z.ZodDefault<z.ZodString>>,
  ),
});
const OtherAnalysis = z.strictObject({ text: z.string().trim().max(qualityLimits.analysisMax) });

/** The analysis checked against its method (the service calls it). */
export const analysisOf = {
  FIVE_WHYS: Whys,
  ISHIKAWA: Ishikawa,
  OTHER: OtherAnalysis,
} as const;

export const UpdateNcSchema = z
  .strictObject({
    title: Text(qualityLimits.titleMax).optional(),
    description: Text(qualityLimits.descriptionMax).optional(),
    origin: z.enum(ncOrigins).optional(),
    severity: z.enum(severities).optional(),
    detectedOn: Day.optional(),
    location: Optional(120),
    departmentId: Id.nullable().optional(),
    ownerId: Id.optional(),
    productAffected: z.boolean().optional(),
    productNote: Optional(qualityLimits.analysisMax),
    correction: Optional(qualityLimits.analysisMax),
    causeMethod: z.enum(["FIVE_WHYS", "ISHIKAWA", "OTHER"]).nullable().optional(),
    causeAnalysis: z.unknown().optional(),
    rootCause: Optional(qualityLimits.analysisMax),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const NcFiltersSchema = z.object({
  q: SearchParam,
  /** open = any status before closing; the rest, that status. */
  status: z.enum(["open", "all", ...ncStatuses]).default("open"),
  origin: z.enum(ncOrigins).optional(),
  severity: z.enum(severities).optional(),
  owner: Id.optional(),
  department: Id.optional(),
  /** Detected between these days. */
  from: Day.optional(),
  to: Day.optional(),
  /** Whoever reported it (the person's own). */
  mine: z.enum(["reported"]).optional(),
});

export const ListNcsQuerySchema = NcFiltersSchema.extend(
  pageShape(["detectedOn", "severity", "createdAt"], "createdAt"),
);

export const ReasonSchema = z.strictObject({ reason: Text(500) });

export const ActionSchema = z.strictObject({
  kind: z.enum(actionKinds),
  description: Text(qualityLimits.actionMax),
  responsibleId: Id,
  dueOn: Day,
});

export const UpdateActionSchema = z
  .strictObject({
    kind: z.enum(actionKinds).optional(),
    description: Text(qualityLimits.actionMax).optional(),
    responsibleId: Id.optional(),
    dueOn: Day.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const CompleteActionSchema = z.strictObject({ note: Optional(500) });

export const ListActionsQuerySchema = z.object({
  status: z.enum(["open", "overdue", "done", "all"]).default("open"),
  responsible: Id.optional(),
  kind: z.enum(actionKinds).optional(),
  /** Only the person's own (Mis pendientes, «Mis acciones»). */
  mine: z.enum(["1"]).optional(),
  ...pageShape(["dueOn"], "dueOn"),
});

export const VerifyOnSchema = z.strictObject({ date: Day });

export const VerificationSchema = z.strictObject({
  effective: z.boolean(),
  note: Text(qualityLimits.analysisMax),
});

export const FromRecordSchema = z.strictObject({ recordId: Id });

export type ReportNcInput = z.infer<typeof ReportNcSchema>;
export type CreateNcInput = z.infer<typeof CreateNcSchema>;
export type UpdateNcInput = z.infer<typeof UpdateNcSchema>;
export type NcFilters = z.infer<typeof NcFiltersSchema>;
export type ListNcsQuery = z.infer<typeof ListNcsQuerySchema>;
export type ActionInput = z.infer<typeof ActionSchema>;
export type UpdateActionInput = z.infer<typeof UpdateActionSchema>;
export type ListActionsQuery = z.infer<typeof ListActionsQuerySchema>;
