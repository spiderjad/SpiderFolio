// Food quality, phase 6c (docs/spec/calidad.md, «Fase 6c»): the food safety culture plan, its anonymous
// surveys and change management.
import { z } from "zod";
import { qualityLimits } from "@spiderfolio/limits";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();
const noChanges = (value: object) => Object.keys(value).length > 0;
const Year = z.coerce.number().int().min(2000).max(2100);

export const cultureKinds = ["TRAINING", "COMMUNICATION", "SURVEY", "MEETING", "OTHER"] as const;

export const CultureYearQuerySchema = z.object({ year: Year.optional() });

export const CulturePlanSchema = z.strictObject({
  objectives: z.string().trim().max(qualityLimits.objectivesMax),
});

export const CultureActivitySchema = z.strictObject({
  year: Year,
  title: Text(160),
  kind: z.enum(cultureKinds),
  plannedOn: Day,
  responsibleId: Id.nullable().default(null),
  note: Optional(1000),
});

export const UpdateCultureActivitySchema = z
  .strictObject({
    title: Text(160).optional(),
    kind: z.enum(cultureKinds).optional(),
    plannedOn: Day.optional(),
    responsibleId: Id.nullable().optional(),
    note: Optional(1000),
  })
  .refine(noChanges, { error: () => validationMessages.noChanges });

export const CultureDoneSchema = z.strictObject({ doneOn: Day.nullable() });

const Questions = z
  .array(Text(qualityLimits.surveyQuestionMax))
  .min(1)
  .max(qualityLimits.surveyQuestionsMax);

export const SurveySchema = z.strictObject({
  title: Text(160),
  /** By default, the ten statements in the company's language. */
  questions: Questions.optional(),
  opensOn: Day,
  closesOn: Day,
});

export const UpdateSurveySchema = z
  .strictObject({
    title: Text(160).optional(),
    questions: Questions.optional(),
    opensOn: Day.optional(),
    closesOn: Day.optional(),
  })
  .refine(noChanges, { error: () => validationMessages.noChanges });

export const SurveyAnswerSchema = z.strictObject({
  scores: z.array(z.number().int().min(1).max(5)).min(1).max(qualityLimits.surveyQuestionsMax),
  comment: Optional(1000),
});

export const changeKinds = [
  "RECIPE",
  "PRODUCT",
  "LINE",
  "EQUIPMENT",
  "SUPPLIER",
  "PROCESS",
  "OTHER",
] as const;
export const changeStatuses = [
  "PROPOSED",
  "APPROVED",
  "REJECTED",
  "IMPLEMENTED",
  "CANCELLED",
] as const;
export const changeImpacts = ["NONE", "LOW", "HIGH"] as const;
/** What a change is reviewed for, before it's approved. */
export const reviewPoints = ["haccp", "allergens", "label", "training", "validation"] as const;
export const reviewStates = ["pending", "not_applicable", "done"] as const;

export const ChangeSchema = z.strictObject({
  title: Text(160),
  kind: z.enum(changeKinds),
  description: z.string().trim().max(4000).default(""),
  productId: Id.nullable().default(null),
  plannedOn: Day.nullable().default(null),
});

const ReviewPoint = z.strictObject({
  state: z.enum(reviewStates),
  note: z.string().trim().max(1000).default(""),
});

/** quality.manage completes the review and the rest while it isn't closed. */
export const UpdateChangeSchema = z
  .strictObject({
    title: Text(160).optional(),
    kind: z.enum(changeKinds).optional(),
    description: z.string().trim().max(4000).optional(),
    productId: Id.nullable().optional(),
    plannedOn: Day.nullable().optional(),
    ownerId: Id.nullable().optional(),
    impact: z.enum(changeImpacts).nullable().optional(),
    review: z.strictObject(Object.fromEntries(reviewPoints.map((point) => [point, ReviewPoint]))).optional(),
  })
  .refine(noChanges, { error: () => validationMessages.noChanges });

export const ChangeDecisionSchema = z.strictObject({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: Optional(1000),
});

export const ChangeImplementedSchema = z.strictObject({ implementedOn: Day });

export const ChangesQuerySchema = z.object({
  q: SearchParam,
  status: z.enum(changeStatuses).optional(),
  kind: z.enum(changeKinds).optional(),
  ...pageShape(["createdAt"], "createdAt"),
});

export type CulturePlanInput = z.infer<typeof CulturePlanSchema>;
export type CultureActivityInput = z.infer<typeof CultureActivitySchema>;
export type UpdateCultureActivityInput = z.infer<typeof UpdateCultureActivitySchema>;
export type SurveyInput = z.infer<typeof SurveySchema>;
export type UpdateSurveyInput = z.infer<typeof UpdateSurveySchema>;
export type SurveyAnswerInput = z.infer<typeof SurveyAnswerSchema>;
export type ChangeInput = z.infer<typeof ChangeSchema>;
export type UpdateChangeInput = z.infer<typeof UpdateChangeSchema>;
export type ChangeDecisionInput = z.infer<typeof ChangeDecisionSchema>;
export type ChangesQuery = z.infer<typeof ChangesQuerySchema>;
export type ReviewPointName = (typeof reviewPoints)[number];
export type ReviewState = (typeof reviewStates)[number];
