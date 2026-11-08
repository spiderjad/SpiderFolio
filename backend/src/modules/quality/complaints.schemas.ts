// Food quality, phase 5 (docs/spec/calidad.md, «Fase 5»): complaints, units sold and the crisis team.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";
import { severities } from "./quality.schemas.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();

export const complaintSources = ["CUSTOMER", "CONSUMER", "AUTHORITY"] as const;
export const complaintCategories = [
  "FOREIGN_BODY",
  "ALLERGEN",
  "MICROBIOLOGICAL",
  "QUALITY",
  "LABELLING",
  "PACKAGING",
  "OTHER",
] as const;

export const ComplaintSchema = z.strictObject({
  source: z.enum(complaintSources),
  from: Text(160),
  contact: Optional(300),
  product: Text(160),
  lot: Optional(120),
  /** The traced lot, if picked from the lots (docs/spec/calidad.md, «Fase 7»). */
  lotId: z.string().min(1).max(64).nullable().default(null),
  category: z.enum(complaintCategories),
  description: Text(4000),
  receivedOn: Day,
  /** Only quality.manage chooses it; otherwise the company's first quality.manage (or the owner). */
  ownerId: Id.nullable().default(null),
});

export const UpdateComplaintSchema = z
  .strictObject({
    source: z.enum(complaintSources).optional(),
    from: Text(160).optional(),
    contact: Optional(300),
    product: Text(160).optional(),
    lot: Optional(120),
    lotId: z.string().min(1).max(64).nullable().optional(),
    category: z.enum(complaintCategories).optional(),
    description: Text(4000).optional(),
    respondBy: Day.optional(),
    ownerId: Id.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const AnswerSchema = z.strictObject({
  response: Text(4000),
  justified: z.boolean(),
  respondedOn: Day,
});

export const ComplaintNcSchema = z.strictObject({
  severity: z.enum(severities),
  ownerId: Id.nullable().default(null),
});

export const ComplaintsQuerySchema = z.object({
  status: z.enum(["OPEN", "ANSWERED", "CLOSED", "overdue", "all"]).default("all"),
  category: z.enum(complaintCategories).optional(),
  source: z.enum(complaintSources).optional(),
  from: Day.optional(),
  to: Day.optional(),
  ...pageShape(["receivedOn"], "receivedOn"),
});

export const YearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export const UnitsSchema = z.strictObject({
  /** The month's first day. */
  month: z.string().regex(/^\d{4}-\d{2}-01$/u),
  units: z.number().int().min(0).max(2_000_000_000),
});

export const CrisisMemberSchema = z.strictObject({ membershipId: Id, role: Text(120) });

export const crisisContactKinds = [
  "AUTHORITY",
  "CUSTOMER",
  "INSURER",
  "LAB",
  "SUPPLIER",
  "OTHER",
] as const;

export const CrisisContactSchema = z.strictObject({
  kind: z.enum(crisisContactKinds),
  name: Text(160),
  organization: Optional(160),
  phone: Optional(40),
  email: z.email().max(254).nullable().optional(),
  notes: Optional(500),
});

export const UpdateCrisisContactSchema = z
  .strictObject({
    kind: z.enum(crisisContactKinds).optional(),
    name: Text(160).optional(),
    organization: Optional(160),
    phone: Optional(40),
    email: z.email().max(254).nullable().optional(),
    notes: Optional(500),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const RecallTestSchema = z.strictObject({
  kind: z.enum(["DRILL", "REAL"]),
  date: Day,
  product: Text(160),
  lot: Text(120),
  /** The traced lot, if picked from the lots (docs/spec/calidad.md, «Fase 7»). */
  lotId: z.string().min(1).max(64).nullable().default(null),
  direction: z.enum(["BACKWARD", "FORWARD", "BOTH"]),
  minutes: z.number().int().min(0).max(100_000),
  recoveredPercent: z.number().int().min(0).max(100).nullable().default(null),
  result: Text(2000),
});

export type ComplaintInput = z.infer<typeof ComplaintSchema>;
export type UpdateComplaintInput = z.infer<typeof UpdateComplaintSchema>;
export type ComplaintsQuery = z.infer<typeof ComplaintsQuerySchema>;
export type CrisisContactInput = z.infer<typeof CrisisContactSchema>;
export type UpdateCrisisContactInput = z.infer<typeof UpdateCrisisContactSchema>;
export type RecallTestInput = z.infer<typeof RecallTestSchema>;
