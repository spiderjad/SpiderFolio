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

const Priority = z.enum(["LOW", "MEDIUM", "HIGH"]);
/** In cents of the company's currency (up to 100 million). */
const Cost = z.number().int().min(0).max(10_000_000_000).nullable();

/** A measure of an accident or incident (from its case). */
export const ActionSchema = z.strictObject({
  description: z.string().trim().min(3).max(500),
  responsibleId: Id,
  dueOn: Day,
  priority: Priority.default("MEDIUM"),
  estimatedCost: Cost.optional(),
});

/**
 * A planned measure (docs/spec/seguridad-salud.md, «Planificación»): from a risk assessment (its EVR
 * document), an inspection (a non-conforming record) or anything else. Accidents' come from their case.
 */
export const PlannedActionSchema = z.discriminatedUnion("origin", [
  z.strictObject({ origin: z.literal("RISK_ASSESSMENT"), nodeId: Id, ...ActionSchema.shape }),
  z.strictObject({ origin: z.literal("INSPECTION"), recordId: Id, ...ActionSchema.shape }),
  z.strictObject({ origin: z.literal("OTHER"), ...ActionSchema.shape }),
]);

export const UpdateActionSchema = z
  .strictObject({
    description: ActionSchema.shape.description,
    responsibleId: Id,
    dueOn: Day,
    priority: Priority,
    estimatedCost: Cost,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    error: () => validationMessages.noChanges,
  });

export const actionOrigins = ["INCIDENT", "RISK_ASSESSMENT", "INSPECTION", "OTHER"] as const;

/** The planning's filters (in the address). */
export const ActionFiltersSchema = z.object({
  origin: z.enum(actionOrigins).optional(),
  /** open (not done, any day), overdue (open and past its day), done, all. */
  status: z.enum(["open", "overdue", "done", "all"]).default("open"),
  responsible: Id.optional(),
  priority: Priority.optional(),
  /** Due between these days. */
  from: Day.optional(),
  to: Day.optional(),
});

export const ListActionsQuerySchema = ActionFiltersSchema.extend(pageShape(["dueOn"], "dueOn"));

export const CompleteActionSchema = z.strictObject({
  note: z.string().trim().max(500).nullable().optional(),
});

export type IncidentFilters = z.infer<typeof IncidentFiltersSchema>;
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;
export type ActionInput = z.infer<typeof ActionSchema>;
export type PlannedActionInput = z.infer<typeof PlannedActionSchema>;
export type ActionFilters = z.infer<typeof ActionFiltersSchema>;
export type ListActionsQuery = z.infer<typeof ListActionsQuerySchema>;
export type UpdateActionInput = z.infer<typeof UpdateActionSchema>;
