// Validación de los formularios de auth: las mismas reglas que el backend (sección 7.3), con
// mensajes en español. El backend vuelve a validar siempre.
import { z } from "zod";
import { texts } from "@/i18n";

const t = texts.errors;

const email = z.string().trim().min(1, t.required).max(254).pipe(z.email(t.email));
const newPassword = z.string().min(10, t.passwordMin).max(200, t.passwordMax);
const name = z.string().trim().min(2, t.nameLength).max(80, t.nameLength);

export const LoginSchema = z.object({
  email,
  password: z.string().min(1, t.required).max(200, t.passwordMax),
});

/** Casilla obligatoria de Términos y Privacidad (el backend la vuelve a exigir). */
const acceptTerms = z.boolean().refine((value) => value, texts.terms.required);

export const RegisterSchema = z.object({
  name,
  email,
  password: newPassword,
  companyName: name,
  acceptTerms,
  marketingOptIn: z.boolean(),
});

export const AcceptInviteSchema = z.object({
  name,
  password: newPassword,
  acceptTerms,
  marketingOptIn: z.boolean(),
});

export const AcceptTermsSchema = z.object({ acceptTerms });

export const ForgotSchema = z.object({ email });
export const ResetSchema = z.object({ password: newPassword });

export type LoginValues = z.infer<typeof LoginSchema>;
export type RegisterValues = z.infer<typeof RegisterSchema>;
export type AcceptInviteValues = z.infer<typeof AcceptInviteSchema>;
export type AcceptTermsValues = z.infer<typeof AcceptTermsSchema>;
export type ForgotValues = z.infer<typeof ForgotSchema>;
export type ResetValues = z.infer<typeof ResetSchema>;
