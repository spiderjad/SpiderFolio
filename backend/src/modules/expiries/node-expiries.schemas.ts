// Expiries of files and pages (docs/spec/vencimientos.md): bodies and the list's filters.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const SetNodeExpirySchema = z.strictObject({
  dueOn: Day,
  responsible: z
    .strictObject({ type: z.enum(["person", "department"]), id: Id })
    .nullable()
    .default(null),
  noticeDays: z.array(z.number().int().min(0).max(365)).max(5).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const ExpiryFiltersSchema = z.object({
  space: Id.optional(),
  department: Id.optional(),
  responsible: Id.optional(),
  status: z.enum(["all", "valid", "due_soon", "expired"]).default("all"),
  from: Day.optional(),
  to: Day.optional(),
});

export const ListExpiriesQuerySchema = ExpiryFiltersSchema.extend(pageShape(["dueOn"], "dueOn"));

export const OptionsQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

export const NodeParamsSchema = z.object({ id: Id });

export type SetNodeExpiryInput = z.infer<typeof SetNodeExpirySchema>;
export type ExpiryFilters = Partial<z.infer<typeof ExpiryFiltersSchema>>;
