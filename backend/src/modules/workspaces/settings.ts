// Workspace.settings (CLAUDE.md, secciones 9.3 y 12A.2): zona horaria e idioma del workspace;
// las políticas de seguridad se agregan con su módulo.
import { z } from "zod";
import { LOCALES } from "../../i18n/locales.ts";
import { validationMessages } from "../../i18n/index.ts";

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("es", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

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

export const WorkspaceSettingsSchema = z.object({
  timezone: z.string().refine(isTimeZone, { error: () => validationMessages.invalidTimeZone }),
  locale: z.enum(LOCALES),
  pinLogin: PinLoginSettingsSchema.optional(),
  memberVisibility: MemberVisibilitySchema.optional(),
  leadersCanInvite: z.boolean().optional(),
  allowSelfApproval: z.boolean().optional(),
  bianEnabled: z.boolean().optional(),
  bianGuests: z.boolean().optional(),
});

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;
