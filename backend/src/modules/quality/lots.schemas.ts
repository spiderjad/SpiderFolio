// Food quality, phase 7 (docs/spec/calidad.md, «Fase 7»): lots, what went into each one, what went out to
// customers, the trace both ways and the CSV import.
import { z } from "zod";
import { qualityLimits } from "@spiderfolio/limits";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();
const Quantity = z.number().min(0).max(100_000_000_000).nullable().optional();
const noChanges = (value: object) => Object.keys(value).length > 0;

export const lotKinds = ["RAW", "INTERMEDIATE", "FINISHED"] as const;
export type LotKind = (typeof lotKinds)[number];
export const traceDirections = ["backward", "forward"] as const;
export type TraceDirection = (typeof traceDirections)[number];

const lotFields = {
  kind: z.enum(lotKinds),
  code: Text(80),
  productId: Id.nullable().optional(),
  material: Optional(160),
  supplierId: Id.nullable().optional(),
  supplierLot: Optional(80),
  origin: Optional(200),
  quantity: Quantity,
  unit: Optional(20),
  date: Day,
  expiresOn: Day.nullable().optional(),
};

export const LotSchema = z.strictObject(lotFields);

export const UpdateLotSchema = z
  .strictObject({
    code: lotFields.code.optional(),
    productId: lotFields.productId,
    material: lotFields.material,
    supplierId: lotFields.supplierId,
    supplierLot: lotFields.supplierLot,
    origin: lotFields.origin,
    quantity: lotFields.quantity,
    unit: lotFields.unit,
    date: Day.optional(),
    expiresOn: lotFields.expiresOn,
  })
  .refine(noChanges, { error: () => validationMessages.noChanges });

export const LotsQuerySchema = z.object({
  q: SearchParam,
  ids: IdsParam,
  kind: z.enum(lotKinds).optional(),
  from: Day.optional(),
  to: Day.optional(),
  ...pageShape(["date", "code"], "date"),
});

export const LinkSchema = z.strictObject({
  inputId: Id,
  quantity: Quantity,
  unit: Optional(20),
});

export const ShipmentSchema = z.strictObject({
  customer: Text(160),
  document: Optional(80),
  shippedOn: Day,
  quantity: Quantity,
  unit: Optional(20),
});

export const TraceQuerySchema = z.object({ direction: z.enum(traceDirections) });

export const TraceExportParams = z.object({
  id: Id,
  format: z.enum(["csv", "pdf"]),
});

export const importKinds = ["lots", "links", "shipments"] as const;
export type ImportKind = (typeof importKinds)[number];

export const ImportSchema = z.strictObject({
  kind: z.enum(importKinds),
  csv: z.string().min(1).max(qualityLimits.traceImportChars),
  /** Only check: nothing is written. */
  dryRun: z.boolean().default(true),
});

export const TemplateParams = z.object({ kind: z.enum(importKinds) });

export type LotInput = z.infer<typeof LotSchema>;
export type UpdateLotInput = z.infer<typeof UpdateLotSchema>;
export type LotsQuery = z.infer<typeof LotsQuerySchema>;
export type LinkInput = z.infer<typeof LinkSchema>;
export type ShipmentInput = z.infer<typeof ShipmentSchema>;
export type ImportInput = z.infer<typeof ImportSchema>;
