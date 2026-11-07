// Food quality, phase 6a (docs/spec/calidad.md, «Fase 6a»): prerequisite controls and their checks.
import { z } from "zod";
import { validationMessages } from "../../i18n/index.ts";
import { severities } from "./quality.schemas.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();

export const prpKinds = [
  "CLEANING",
  "PEST",
  "WATER",
  "CALIBRATION",
  "GLASS",
  "WASTE",
  "OTHER",
] as const;

const EveryDays = z.number().int().min(1).max(730);

export const PrpSchema = z.strictObject({
  kind: z.enum(prpKinds),
  name: Text(160),
  location: Optional(120),
  everyDays: EveryDays,
  responsibleId: Id.nullable().default(null),
  formId: Id.nullable().default(null),
  /** The first time it's due (by default, today). */
  nextDueOn: Day.optional(),
  notes: Optional(1000),
});

export const UpdatePrpSchema = z
  .strictObject({
    kind: z.enum(prpKinds).optional(),
    name: Text(160).optional(),
    location: Optional(120),
    everyDays: EveryDays.optional(),
    responsibleId: Id.nullable().optional(),
    formId: Id.nullable().optional(),
    nextDueOn: Day.optional(),
    notes: Optional(1000),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const PrpsQuerySchema = z.object({
  kind: z.enum(prpKinds).optional(),
  archived: z.enum(["1"]).optional(),
});

export const PrpCheckSchema = z.strictObject({
  doneOn: Day,
  conforming: z.boolean(),
  note: Optional(1000),
  openNc: z.boolean().default(false),
  severity: z.enum(severities).default("MAJOR"),
});

export type PrpInput = z.infer<typeof PrpSchema>;
export type UpdatePrpInput = z.infer<typeof UpdatePrpSchema>;
export type PrpCheckInput = z.infer<typeof PrpCheckSchema>;
