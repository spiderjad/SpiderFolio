// Workspace.settings (CLAUDE.md, secciones 9.3 y 12A.2): zona horaria e idioma del workspace;
// las políticas de seguridad se agregan con su módulo.
import { z } from "zod";
import { caeLimits, qualityLimits } from "@spiderfolio/limits";
import { LOCALES } from "../../i18n/locales.ts";
import { validationMessages } from "../../i18n/index.ts";
import { isTimeZone } from "../../lib/time-zone.ts";

/** Ingreso con usuario + PIN para tablets compartidas (7.6). Apagado hasta que el admin lo active. */
export const PinLoginSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Minutos sin uso antes de cerrar la sesión. */
  idleMinutes: z.number().int().min(1).max(30).default(5),
  /** Cerrar la sesión después de confirmar una lectura. */
  closeAfterConfirm: z.boolean().default(true),
});

export type PinLoginSettings = z.infer<typeof PinLoginSettingsSchema>;

/** Ajustes de PIN de un workspace; con datos ausentes o inválidos, los valores por defecto. */
export function readPinLoginSettings(settings: unknown): PinLoginSettings {
  const raw = (settings as { pinLogin?: unknown } | null | undefined)?.pinLogin;
  const parsed = PinLoginSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : PinLoginSettingsSchema.parse({});
}

/**
 * Quién ve a quién en el directorio de personas (solo lectura): toda la empresa (por defecto) o
 * solo los de su departamento. Propietario y administradores siempre ven toda la empresa.
 */
export const memberVisibilities = ["company", "department"] as const;
export const MemberVisibilitySchema = z.enum(memberVisibilities);
export type MemberVisibility = z.infer<typeof MemberVisibilitySchema>;

export function readMemberVisibility(settings: unknown): MemberVisibility {
  const raw = (settings as { memberVisibility?: unknown } | null | undefined)?.memberVisibility;
  const parsed = MemberVisibilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : "company";
}

/** Los jefes y subjefes pueden invitar a su área (por defecto sí). */
export function readLeadersCanInvite(settings: unknown): boolean {
  const raw = (settings as { leadersCanInvite?: unknown } | null | undefined)?.leadersCanInvite;
  return typeof raw === "boolean" ? raw : true;
}

/** El autor puede aprobar sus propios documentos (por defecto, no). */
export function readAllowSelfApproval(settings: unknown): boolean {
  const raw = (settings as { allowSelfApproval?: unknown } | null | undefined)?.allowSelfApproval;
  return raw === true;
}

/** Bian, el asistente IA, está activo en la empresa (por defecto sí). */
export function readBianEnabled(settings: unknown): boolean {
  const raw = (settings as { bianEnabled?: unknown } | null | undefined)?.bianEnabled;
  return typeof raw === "boolean" ? raw : true;
}

/** Los invitados externos pueden usar a Bian (por defecto, no). */
export function readBianGuests(settings: unknown): boolean {
  const raw = (settings as { bianGuests?: unknown } | null | undefined)?.bianGuests;
  return raw === true;
}

/**
 * Coordination of business activities (docs/spec/cae.md), inside the module: on or off and the
 * «Contratas» folder in the module's space once it's created.
 */
export const CaeSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  folderId: z.string().min(1).max(64).optional(),
  /** The gatehouse records each entry and exit (CaeAccess). */
  accessLog: z.boolean().default(false),
  /** The controlled documents handed to every contractor (RD 171/2004, arts. 7 to 9). */
  infoNodeIds: z.array(z.string().min(1).max(64)).max(caeLimits.infoMaxDocuments).default([]),
  /** Whether a contractor needs the current version of each of them to be authorized. */
  infoRequired: z.boolean().default(true),
});

export type CaeSettings = z.infer<typeof CaeSettingsSchema>;

/**
 * The occupational health and safety module (docs/spec/seguridad-salud.md): on or off, the country's
 * terms (es: PRL and EPI in Spain; latam: SST and EPP) and the module's space once it's created.
 */
export const SafetySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  terms: z.enum(["es", "latam"]).default("es"),
  spaceId: z.string().min(1).max(64).optional(),
  /** The base form «Accidente o incidente», once it's created. */
  incidentFormId: z.string().min(1).max(64).optional(),
  /** Settings saved before CAE existed parse with it off. */
  cae: CaeSettingsSchema.default({
    enabled: false,
    accessLog: false,
    infoNodeIds: [],
    infoRequired: true,
  }),
});

export type SafetySettings = z.infer<typeof SafetySettingsSchema>;

/** The module's settings; off with data missing or not valid. */
export function readSafetySettings(settings: unknown): SafetySettings {
  const raw = (settings as { safety?: unknown } | null | undefined)?.safety;
  const parsed = SafetySettingsSchema.safeParse(raw ?? {});
  return parsed.success
    ? parsed.data
    : {
        enabled: false,
        terms: "es",
        cae: { enabled: false, accessLog: false, infoNodeIds: [], infoRequired: true },
      };
}

/** CAE is on only while the module is on too. */
export const caeEnabled = (settings: SafetySettings): boolean =>
  settings.enabled && settings.cae.enabled;

/**
 * The food quality module (docs/spec/calidad.md): on or off, its space once it's created, the standards
 * the company is audited against and the days to the effectiveness check of a nonconformity.
 */
export const QualitySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  spaceId: z.string().min(1).max(64).optional(),
  standards: z.array(z.enum(["IFS8", "BRCGS9"])).max(2).default([]),
  verifyDays: z
    .number()
    .int()
    .min(qualityLimits.verifyDaysMin)
    .max(qualityLimits.verifyDaysMax)
    .default(qualityLimits.verifyDaysDefault),
});

export type QualitySettings = z.infer<typeof QualitySettingsSchema>;

/** The module's settings; off with data missing or not valid. */
export function readQualitySettings(settings: unknown): QualitySettings {
  const raw = (settings as { quality?: unknown } | null | undefined)?.quality;
  const parsed = QualitySettingsSchema.safeParse(raw ?? {});
  return parsed.success
    ? parsed.data
    : { enabled: false, standards: [], verifyDays: qualityLimits.verifyDaysDefault };
}

export const WorkspaceSettingsSchema = z.object({
  timezone: z.string().refine(isTimeZone, { error: () => validationMessages.invalidTimeZone }),
  locale: z.enum(LOCALES),
  pinLogin: PinLoginSettingsSchema.optional(),
  memberVisibility: MemberVisibilitySchema.optional(),
  leadersCanInvite: z.boolean().optional(),
  allowSelfApproval: z.boolean().optional(),
  bianEnabled: z.boolean().optional(),
  bianGuests: z.boolean().optional(),
  safety: SafetySettingsSchema.optional(),
  quality: QualitySettingsSchema.optional(),
});

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

/**
 * «Directory only» (docs/spec/plugins.md «Directorio de la empresa»): the plugin whose directory
 * everyone but the owners has to sign in with, or null.
 */
/** Whether an identity provider's MFA replaces SpiderFolio's own code at sign-in (on by default). */
export function readTrustProviderMfa(settings: unknown): boolean {
  const raw = (settings as { directoryTrustMfa?: unknown } | null | undefined)?.directoryTrustMfa;
  return raw !== false;
}

export function readDirectoryOnly(settings: unknown): string | null {
  const raw = (settings as { directoryOnly?: unknown } | null | undefined)?.directoryOnly;
  return typeof raw === "string" && raw !== "" ? raw : null;
}
