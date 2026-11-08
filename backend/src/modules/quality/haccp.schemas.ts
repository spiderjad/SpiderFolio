// Food quality, phase 2 (docs/spec/calidad.md): bodies of the HACCP table and of product holds.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Text = (max: number) => z.string().trim().min(1).max(max);

export const hazardTypes = ["BIOLOGICAL", "CHEMICAL", "PHYSICAL", "ALLERGEN"] as const;
export const holdStatuses = ["HELD", "RELEASED", "REWORKED", "DIVERTED", "DESTROYED"] as const;

export const CcpSchema = z.strictObject({
  code: Text(20),
  name: Text(120),
  step: Text(120),
  hazard: Text(500),
  hazardType: z.enum(hazardTypes),
  criticalLimit: Text(300),
  formId: Id.nullable().default(null),
  frequency: Text(120),
  responsibleId: Id.nullable().default(null),
  correctiveAction: Text(1000),
  verification: Text(1000),
});

export const UpdateCcpSchema = z
  .strictObject({
    code: Text(20).optional(),
    name: Text(120).optional(),
    step: Text(120).optional(),
    hazard: Text(500).optional(),
    hazardType: z.enum(hazardTypes).optional(),
    criticalLimit: Text(300).optional(),
    formId: Id.nullable().optional(),
    frequency: Text(120).optional(),
    responsibleId: Id.nullable().optional(),
    correctiveAction: Text(1000).optional(),
    verification: Text(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const ArchiveSchema = z.strictObject({ archived: z.boolean() });

export const OrderSchema = z.strictObject({ ids: z.array(Id).min(1).max(200) });

export const HaccpQuerySchema = z.object({ archived: z.enum(["1"]).optional() });

export const HoldSchema = z.strictObject({
  ncId: Id.nullable().default(null),
  product: Text(160),
  lot: z.string().trim().max(120).nullable().default(null),
  /** The traced lot, if picked from the lots (docs/spec/calidad.md, «Fase 7»). */
  lotId: z.string().min(1).max(64).nullable().default(null),
  quantity: z.string().trim().max(60).nullable().default(null),
  location: z.string().trim().max(120).nullable().default(null),
  reason: Text(1000),
});

/** A PNG as a data URL: the signature of whoever decides (up to ~300 KB). */
const Signature = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u);

export const DecisionSchema = z.strictObject({
  status: z.enum(["RELEASED", "REWORKED", "DIVERTED", "DESTROYED"]),
  note: Text(1000),
  signature: Signature,
});

export const ListHoldsQuerySchema = z.object({
  status: z.enum(["held", "decided", "all"]).default("held"),
  ...pageShape(["createdAt"], "createdAt"),
});

export type CcpInput = z.infer<typeof CcpSchema>;
export type UpdateCcpInput = z.infer<typeof UpdateCcpSchema>;
export type HoldInput = z.infer<typeof HoldSchema>;
export type DecisionInput = z.infer<typeof DecisionSchema>;
export type ListHoldsQuery = z.infer<typeof ListHoldsQuerySchema>;
