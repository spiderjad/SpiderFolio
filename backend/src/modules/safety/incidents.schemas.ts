// Accidents and incidents (docs/spec/seguridad-salud.md): list filters and the measures' bodies.
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const IncidentFiltersSchema = z.object({
  from: Day.optional(),
  to: Day.optional(),
  type: z.enum(["leave", "no_leave", "incident", "near_miss"]).optional(),
  severity: z.enum(["minor", "serious", "very_serious", "fatal"]).optional(),
  person: Id.optional(),
  department: Id.optional(),
  status: z.enum(["all", "open", "investigating", "closed"]).default("all"),
});

export const ListIncidentsQuerySchema = IncidentFiltersSchema.extend(
  pageShape(["occurredOn"], "occurredOn"),
);

export const ActionSchema = z.strictObject({
  description: z.string().trim().min(3).max(500),
  responsibleId: Id,
  dueOn: Day,
});

export const UpdateActionSchema = ActionSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { error: () => validationMessages.noChanges },
);

export const CompleteActionSchema = z.strictObject({
  note: z.string().trim().max(500).nullable().optional(),
});

export type IncidentFilters = z.infer<typeof IncidentFiltersSchema>;
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;
export type ActionInput = z.infer<typeof ActionSchema>;
export type UpdateActionInput = z.infer<typeof UpdateActionSchema>;
