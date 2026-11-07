// Food quality, phase 4 (docs/spec/calidad.md, «Fase 4»): suppliers, their documents and reviews.
import { z } from "zod";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();

export const supplierCategories = [
  "RAW_MATERIAL",
  "INGREDIENT",
  "PACKAGING",
  "SERVICE",
  "OTHER",
] as const;
export const risks = ["LOW", "MEDIUM", "HIGH"] as const;
export const supplierStatuses = ["PENDING", "APPROVED", "CONDITIONAL", "BLOCKED"] as const;
export const supplierDocKinds = [
  "CERT_IFS",
  "CERT_BRCGS",
  "CERT_OTHER",
  "SPEC_SHEET",
  "QUESTIONNAIRE",
  "ANALYSIS",
  "OTHER",
] as const;

export const SupplierSchema = z.strictObject({
  name: Text(160),
  taxId: Optional(20),
  category: z.enum(supplierCategories),
  supplies: Text(500),
  risk: z.enum(risks),
  fraudRisk: z.enum(risks).default("LOW"),
  fraudNote: Optional(1000),
  contact: Optional(300),
  ownerId: Id.nullable().default(null),
});

export const UpdateSupplierSchema = z
  .strictObject({
    name: Text(160).optional(),
    taxId: Optional(20),
    category: z.enum(supplierCategories).optional(),
    supplies: Text(500).optional(),
    risk: z.enum(risks).optional(),
    fraudRisk: z.enum(risks).optional(),
    fraudNote: Optional(1000),
    contact: Optional(300),
    ownerId: Id.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const SuppliersQuerySchema = z.object({
  q: SearchParam,
  status: z.enum([...supplierStatuses, "archived"]).optional(),
  category: z.enum(supplierCategories).optional(),
  risk: z.enum(risks).optional(),
  ...pageShape(["name"], "name"),
});

export const SupplierDocSchema = z.strictObject({
  kind: z.enum(supplierDocKinds),
  name: Text(160),
  nodeId: Id.nullable().default(null),
  validUntil: Day.nullable().default(null),
});

const Score = z.number().int().min(1).max(5);

export const ReviewSchema = z.strictObject({
  reviewedOn: Day,
  scores: z.strictObject({ quality: Score, service: Score, documents: Score, incidents: Score }),
  result: z.enum(["APPROVED", "CONDITIONAL", "BLOCKED"]),
  note: Text(1000),
});

export type SupplierInput = z.infer<typeof SupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
export type SuppliersQuery = z.infer<typeof SuppliersQuerySchema>;
export type SupplierDocInput = z.infer<typeof SupplierDocSchema>;
export type ReviewInput = z.infer<typeof ReviewSchema>;
