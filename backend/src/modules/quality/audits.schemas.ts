// Food quality, phase 3 (docs/spec/calidad.md, «Fase 3»): audits and their findings.
import { z } from "zod";
import { validationMessages } from "../../i18n/index.ts";
import { severities } from "./quality.schemas.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().trim().max(max).nullable().optional();

export const auditSchemes = ["INTERNAL", "IFS8", "BRCGS9", "CLIENT", "OFFICIAL", "OTHER"] as const;
/** «IFS8:4», «BRCGS9:2»: a standard and its chapter number. */
const Chapter = z.string().regex(/^(IFS8|BRCGS9):[1-9]$/u);

export const AuditSchema = z.strictObject({
  scheme: z.enum(auditSchemes),
  title: Text(160),
  scope: Optional(2000),
  plannedOn: Day,
  auditor: Optional(160),
  leadId: Id.nullable().default(null),
  chapters: z.array(Chapter).max(20).default([]),
  auditRoomId: Id.nullable().default(null),
});

export const UpdateAuditSchema = z
  .strictObject({
    scheme: z.enum(auditSchemes).optional(),
    title: Text(160).optional(),
    scope: Optional(2000),
    plannedOn: Day.optional(),
    auditor: Optional(160),
    leadId: Id.nullable().optional(),
    chapters: z.array(Chapter).max(20).optional(),
    auditRoomId: Id.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: () => validationMessages.noChanges });

export const DoneSchema = z.strictObject({ doneOn: Day, result: Optional(300) });

export const AuditsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  status: z.enum(["PLANNED", "DONE", "CANCELLED", "all"]).default("all"),
});

export const CoverageQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export const FindingSchema = z.strictObject({
  clause: Text(40),
  description: Text(2000),
  severity: z.enum(severities),
  openNc: z.boolean().default(true),
  ownerId: Id.nullable().default(null),
});

export const FindingNcSchema = z.strictObject({ ownerId: Id.nullable().default(null) });

export type AuditInput = z.infer<typeof AuditSchema>;
export type UpdateAuditInput = z.infer<typeof UpdateAuditSchema>;
export type FindingInput = z.infer<typeof FindingSchema>;
