// Food quality, phase 6b (docs/spec/calidad.md, «Fase 6b»): products and their sheet, shelf life studies,
// labels and the sampling plan.
import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";
import { severities } from "./quality.schemas.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();
const noChanges = (value: object) => Object.keys(value).length > 0;

export const allergens = [
  "GLUTEN",
  "CRUSTACEANS",
  "EGGS",
  "FISH",
  "PEANUTS",
  "SOY",
  "MILK",
  "NUTS",
  "CELERY",
  "MUSTARD",
  "SESAME",
  "SULPHITES",
  "LUPIN",
  "MOLLUSCS",
] as const;

export const nutritionFields = [
  "energyKj",
  "energyKcal",
  "fat",
  "saturates",
  "carbs",
  "sugars",
  "protein",
  "salt",
] as const;

const Amount = z.number().min(0).max(100_000);
const Nutrition = z
  .strictObject(Object.fromEntries(nutritionFields.map((field) => [field, Amount])))
  .nullable();
const Allergens = z
  .array(z.enum(allergens))
  .max(allergens.length)
  .transform((list) => [...new Set(list)]);
const ShelfLife = z.number().int().min(1).max(3650);

const productFields = {
  code: Optional(40),
  name: Text(160),
  family: Optional(80),
  ingredients: z.string().trim().max(4000),
  allergens: Allergens,
  mayContain: Allergens,
  nutrition: Nutrition.optional(),
  shelfLifeDays: ShelfLife.nullable().optional(),
  storage: Optional(200),
  readyToEat: z.boolean(),
  specNodeId: Id.nullable().optional(),
  notes: Optional(1000),
};

export const ProductSchema = z.strictObject({
  ...productFields,
  allergens: Allergens.default([]),
  mayContain: Allergens.default([]),
  readyToEat: z.boolean().default(false),
});

export const UpdateProductSchema = z
  .strictObject({
    code: productFields.code,
    name: productFields.name.optional(),
    family: productFields.family,
    ingredients: productFields.ingredients.optional(),
    allergens: Allergens.optional(),
    mayContain: Allergens.optional(),
    nutrition: productFields.nutrition,
    shelfLifeDays: productFields.shelfLifeDays,
    storage: productFields.storage,
    readyToEat: z.boolean().optional(),
    specNodeId: productFields.specNodeId,
    notes: productFields.notes,
  })
  .refine(noChanges, { error: () => validationMessages.noChanges });

export const ProductsQuerySchema = z.object({
  q: SearchParam,
  ids: IdsParam,
  archived: z.enum(["1"]).optional(),
  ...pageShape(["name"], "name"),
});

export const StudySchema = z.strictObject({
  startedOn: Day,
  targetDays: ShelfLife,
  listeria: z.boolean().default(false),
});

export const StudyResultSchema = z.strictObject({
  result: z.enum(["PASSED", "FAILED"]),
  resultOn: Day,
  conclusion: Optional(1000),
  reportNodeId: Id.nullable().default(null),
  openNc: z.boolean().default(false),
  severity: z.enum(severities).default("MAJOR"),
});

/** Article 9 of Regulation 1169/2011: what a label is checked for. */
export const labelChecks = [
  "name",
  "ingredients",
  "allergens",
  "netQuantity",
  "date",
  "storage",
  "operator",
  "lot",
  "origin",
  "nutrition",
] as const;

/** These two may not apply (origin only when required; nutrition has exemptions). */
export const optionalChecks: readonly (typeof labelChecks)[number][] = ["origin", "nutrition"];

export const LabelSchema = z.strictObject({
  nodeId: Id.nullable().default(null),
  note: Optional(1000),
});

export const LabelReviewSchema = z.strictObject({
  decision: z.enum(["APPROVE", "REJECT"]),
  checks: z.strictObject(
    Object.fromEntries(labelChecks.map((check) => [check, z.enum(["ok", "missing", "na"])])),
  ),
  reviewNote: Optional(1000),
});

export const samplingKinds = ["PRODUCT", "SURFACE", "ENVIRONMENT", "WATER"] as const;

const EveryDays = z.number().int().min(1).max(730);
const Limit = z.number().min(-1_000_000_000).max(1_000_000_000);

export const SamplingPointSchema = z.strictObject({
  kind: z.enum(samplingKinds),
  name: Text(160),
  productId: Id.nullable().default(null),
  zone: Optional(120),
  parameter: Text(120),
  criterion: Optional(200),
  maxValue: Limit.nullable().default(null),
  unit: Optional(20),
  everyDays: EveryDays,
  laboratory: Optional(120),
  responsibleId: Id.nullable().default(null),
  /** The first time it's due (by default, today). */
  nextDueOn: Day.optional(),
});

export const UpdateSamplingPointSchema = z
  .strictObject({
    kind: z.enum(samplingKinds).optional(),
    name: Text(160).optional(),
    productId: Id.nullable().optional(),
    zone: Optional(120),
    parameter: Text(120).optional(),
    criterion: Optional(200),
    maxValue: Limit.nullable().optional(),
    unit: Optional(20),
    everyDays: EveryDays.optional(),
    laboratory: Optional(120),
    responsibleId: Id.nullable().optional(),
    nextDueOn: Day.optional(),
  })
  .refine(noChanges, { error: () => validationMessages.noChanges });

export const SamplingQuerySchema = z.object({
  kind: z.enum(samplingKinds).optional(),
  archived: z.enum(["1"]).optional(),
});

export const LabResultSchema = z.strictObject({
  sampledOn: Day,
  value: Limit.nullable().default(null),
  detected: z.boolean().nullable().default(null),
  conforming: z.boolean(),
  reportNodeId: Id.nullable().default(null),
  note: Optional(1000),
  openNc: z.boolean().default(false),
  severity: z.enum(severities).default("MAJOR"),
});

export type ProductInput = z.infer<typeof ProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
export type ProductsQuery = z.infer<typeof ProductsQuerySchema>;
export type StudyInput = z.infer<typeof StudySchema>;
export type StudyResultInput = z.infer<typeof StudyResultSchema>;
export type LabelInput = z.infer<typeof LabelSchema>;
export type LabelReviewInput = z.infer<typeof LabelReviewSchema>;
export type SamplingPointInput = z.infer<typeof SamplingPointSchema>;
export type UpdateSamplingPointInput = z.infer<typeof UpdateSamplingPointSchema>;
export type LabResultInput = z.infer<typeof LabResultSchema>;
