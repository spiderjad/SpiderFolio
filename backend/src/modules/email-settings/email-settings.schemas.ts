import { z } from "zod";
import { customEmailTexts, validationMessages } from "../../i18n/index.ts";
import { SMTP_PORTS } from "./smtp.ts";

const noLineBreaks = (value: string) => !/[\r\n]/.test(value);
const hostname =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^(\d{1,3}\.){3}\d{1,3}$/i;

export const UpdateEmailSettingsSchema = z.strictObject({
  fromName: z.string().trim().min(1).max(80).refine(noLineBreaks),
  fromEmail: z.email().max(254).toLowerCase(),
  replyTo: z.email().max(254).toLowerCase().nullable().default(null),
  smtpHost: z.string().trim().toLowerCase().regex(hostname, { error: () => validationMessages.invalidHost }),
  smtpPort: z
    .number()
    .int()
    .refine(
      (port) => (SMTP_PORTS as readonly number[]).includes(port),
      customEmailTexts.invalidPort,
    ),
  smtpSecurity: z.enum(["TLS", "STARTTLS"]),
  smtpUser: z.string().trim().min(1).max(254).refine(noLineBreaks).nullable().default(null),
  /** Ausente: se conserva la guardada. Nunca se devuelve. */
  smtpPass: z.string().min(1).max(500).optional(),
});
export type UpdateEmailSettingsInput = z.infer<typeof UpdateEmailSettingsSchema>;

export const RegisterDomainSchema = z.strictObject({
  domain: z.string().trim().toLowerCase().min(4).max(253),
  fromName: z.string().trim().min(1).max(80).refine(noLineBreaks),
  /** Lo que va antes de la @ (la parte del dominio la pone el sistema). */
  fromLocalPart: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._+-]{0,63}$/, { error: () => validationMessages.invalidLocalPart }),
  replyTo: z.email().max(254).toLowerCase().nullable().default(null),
});
