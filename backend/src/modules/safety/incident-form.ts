// The module's base form «Accidente o incidente» (docs/spec/seguridad-salud.md, «Accidentes e
// incidentes»): a form of the forms engine with fixed fields (reserved ids) the company can't remove nor
// change the type or options of; it can rename them and add its own. Its records are health data: only
// `safety.health` sees them all (whoever reported one sees theirs).
import type { TenantDb } from "../../db/tenant.ts";
import { AppError } from "../../lib/errors.ts";
import { safetyTexts } from "../../i18n/index.ts";
import type { FormField } from "../forms/forms.schemas.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const INCIDENT_FIELDS = {
  date: "sst_fecha",
  time: "sst_hora",
  place: "sst_lugar",
  person: "sst_persona",
  type: "sst_tipo",
  severity: "sst_gravedad",
  what: "sst_que",
  causes: "sst_causas",
  photos: "sst_fotos",
  witnesses: "sst_testigos",
} as const;

/** The type and severity options (ids kept in every language) and what they're stored as. */
export const INCIDENT_TYPES = {
  baja: "leave",
  sin_baja: "no_leave",
  incidente: "incident",
  casi: "near_miss",
} as const;
export const INCIDENT_SEVERITIES = {
  leve: "minor",
  grave: "serious",
  muy_grave: "very_serious",
  mortal: "fatal",
} as const;

/** The base template, in the active language. */
export function incidentTemplate(): FormField[] {
  const t = safetyTexts.incidentForm;
  const f = INCIDENT_FIELDS;
  return [
    { id: f.date, type: "date", label: t.date, required: true },
    { id: f.time, type: "text", label: t.time, required: false, multiline: false },
    { id: f.place, type: "text", label: t.place, required: true, multiline: false },
    { id: f.person, type: "person", label: t.person, help: t.personHelp, required: false },
    {
      id: f.type,
      type: "choice",
      label: t.type,
      required: true,
      options: Object.keys(INCIDENT_TYPES).map((id) => ({
        id,
        label: t.types[id as keyof typeof INCIDENT_TYPES],
      })),
      nonConforming: [],
    },
    {
      id: f.severity,
      type: "choice",
      label: t.severity,
      help: t.severityHelp,
      required: false,
      options: Object.keys(INCIDENT_SEVERITIES).map((id) => ({
        id,
        label: t.severities[id as keyof typeof INCIDENT_SEVERITIES],
      })),
      nonConforming: [],
    },
    { id: f.what, type: "text", label: t.what, help: t.whatHelp, required: true, multiline: true },
    { id: f.causes, type: "text", label: t.causes, required: false, multiline: true },
    { id: f.photos, type: "photo", label: t.photos, required: false, max: 5 },
    { id: f.witnesses, type: "text", label: t.witnesses, required: false, multiline: false },
  ];
}

/** Whether the form is the module's incident form (on or off: its records stay health data). */
export async function isIncidentForm(db: TenantDb, nodeId: string): Promise<boolean> {
  return (await safetySettingsOf(db)).incidentFormId === nodeId;
}

const optionIds = (field: FormField): string =>
  field.type === "choice"
    ? field.options
        .map((option) => option.id)
        .sort()
        .join()
    : "";

/**
 * The fixed fields of the incident form must stay: same id, type and options (their text can change).
 * Returns the fixed field ids of the form ([] for any other form).
 */
export async function assertLockedFields(
  db: TenantDb,
  nodeId: string,
  fields: readonly FormField[],
): Promise<void> {
  if (!(await isIncidentForm(db, nodeId))) return;
  const reference = incidentTemplate();
  for (const locked of reference) {
    const field = fields.find((candidate) => candidate.id === locked.id);
    if (
      field === undefined ||
      field.type !== locked.type ||
      optionIds(field) !== optionIds(locked)
    ) {
      throw new AppError("BAD_REQUEST", {
        message: safetyTexts.lockedField(field?.label ?? locked.label),
      });
    }
  }
}

export async function lockedFieldIds(db: TenantDb, nodeId: string): Promise<string[]> {
  return (await isIncidentForm(db, nodeId)) ? Object.values(INCIDENT_FIELDS) : [];
}
