// Envío de emails por SMTP (Mailpit en desarrollo; proveedor transaccional en producción).
// Solo lo usa el worker: la API encola.
import nodemailer from "nodemailer";
import type { Env } from "../config/env.ts";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Correo del workspace (invitaciones, avisos, compartidos): sale con el remitente propio de la
   * empresa si lo tiene activo. Sin este campo es un correo de cuenta y sale siempre de SpiderFolio.
   */
  workspaceId?: string;
  /** Nombre del remitente (solo en el respaldo: el de la empresa sobre la dirección de SpiderFolio). */
  fromName?: string;
  replyTo?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function createMailer(
  env: Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "MAIL_FROM">,
): Mailer {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER === undefined
      ? {}
      : { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } }),
  });
  const fromAddress = /<([^<>]+)>\s*$/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM;
  return {
    async send(message) {
      await transport.sendMail({
        from:
          message.fromName === undefined
            ? env.MAIL_FROM
            : { name: message.fromName, address: fromAddress },
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      });
    },
  };
}
