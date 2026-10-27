// Validación de los endpoints de auth (CLAUDE.md, sección 7.3).
import { z } from "zod";
import { normalizePersonName } from "../../lib/person-name.ts";
import { isPinFormat, normalizeLoginName } from "../pin/pin-rules.ts";
import { WorkspaceSettingsSchema } from "../workspaces/settings.ts";
import { LOCALES } from "../../i18n/locales.ts";
import { validationMessages } from "../../i18n/index.ts";

/** Email normalizado: sin espacios, NFKC y en minúsculas. Es la forma que se guarda. */
export const EmailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.normalize("NFKC").toLowerCase())
  .pipe(z.email());

/** Mínimo 10 (7.3). El máximo evita trabajo de argon2 desproporcionado. */
export const PasswordSchema = z.string().min(10).max(200);

const Name = z.string().trim().min(2).max(80);
/** Nombre de una persona (no de una empresa): se normaliza al validar. */
const PersonName = Name.transform(normalizePersonName);
const Token = z.string().min(20).max(200);

/** Casilla obligatoria de Términos y Privacidad: sin `true` el registro se rechaza. */
const AcceptTerms = z.literal(true, {
  error: () => validationMessages.termsRequired,
});

export const RegisterSchema = z.strictObject({
  name: PersonName,
  email: EmailSchema,
  password: PasswordSchema,
  companyName: Name,
  /** Zona horaria del navegador (IANA). */
  timezone: WorkspaceSettingsSchema.shape.timezone.default("Europe/Madrid"),
  acceptTerms: AcceptTerms,
  /** Casilla aparte y opcional: novedades de SpiderFolio por email. */
  marketingOptIn: z.boolean().default(false),
});

/** Aceptar la versión vigente de los términos (al iniciar sesión tras un cambio). */
export const AcceptTermsSchema = z.strictObject({ acceptTerms: AcceptTerms });

export const LoginSchema = z.strictObject({
  email: EmailSchema,
  // En el login no se valida la longitud mínima: se responde con el error único.
  password: z.string().min(1).max(200),
});

/** Ingreso con usuario + PIN (7.6). El formato del usuario no se valida: se responde con el error único. */
export const PinLoginSchema = z.strictObject({
  workspaceSlug: z.string().trim().toLowerCase().min(1).max(63),
  loginName: z.string().max(200).transform(normalizeLoginName).pipe(z.string().min(1).max(64)),
  pin: z.string().refine(isPinFormat, { error: () => validationMessages.pinFormat }),
});

export const TokenSchema = z.strictObject({ token: Token });
export const EmailOnlySchema = z.strictObject({ email: EmailSchema });

export const ResetPasswordSchema = z.strictObject({ token: Token, password: PasswordSchema });

export const ChangePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: PasswordSchema,
});

export const UpdateProfileSchema = z
  .strictObject({
    name: PersonName.optional(),
    /** null: el idioma de la empresa. */
    locale: z.enum(LOCALES).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.locale !== undefined, { error: () => validationMessages.noChanges });

export const ChangeEmailSchema = z.strictObject({
  email: EmailSchema,
  currentPassword: z.string().min(1).max(200),
});

export const SessionIdSchema = z.strictObject({ id: z.string().min(1).max(64) });

export const InvitationTokenParamsSchema = z.object({ token: Token });

/** Con cuenta existente no se manda cuerpo; sin cuenta, nombre y contraseña. */
export const AcceptInvitationSchema = z.strictObject({
  name: PersonName.optional(),
  password: PasswordSchema.optional(),
  /** Obligatoria al crear la cuenta (con nombre y contraseña); la valida el servicio. */
  acceptTerms: z.boolean().optional(),
  marketingOptIn: z.boolean().optional(),
});

/** Código de la app (6 dígitos) o de recuperación (XXXXX-XXXXX); se normaliza al comprobarlo. */
const MfaCode = z.string().trim().min(6).max(20);

export const MfaCodeSchema = z.strictObject({ code: MfaCode });

export const MfaDisableSchema = z.strictObject({
  password: z.string().min(1).max(200),
  code: MfaCode,
});

export const MfaVerifySchema = z.strictObject({
  challenge: z.string().min(20).max(200),
  code: MfaCode,
  remember: z.boolean().default(false),
});
