// Envío de los correos del workspace con el remitente propio de la empresa (si lo tiene activo y
// el plan lo incluye). Una conexión por empresa en un caché con tope y vencimiento; la clave lleva
// el updatedAt de la configuración, así un cambio la renueva y nunca se comparte entre empresas.
// Si el envío propio falla, el mismo correo sale por SpiderFolio y se avisa a los administradores.
import type { Transporter } from "nodemailer";
import type { Logger } from "pino";
import type { Env } from "../../config/env.ts";
import { renderEmail } from "../../emails/layout.ts";
import { forTenant } from "../../db/tenant.ts";
import type { WorkspaceEmail } from "../../generated/prisma/client.ts";
import { customEmailTexts } from "../../i18n/index.ts";
import type { Mailer, MailMessage } from "../../lib/mailer.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { SecretBox } from "../../lib/secret-box.ts";
import { audit } from "../audit/audit.service.ts";
import type { EmailDomainProvider } from "./domain-provider.ts";
import { connectionOf } from "./email-settings.service.ts";
import { classifySmtpError, createSmtpTransport, resolveSmtpHost } from "./smtp.ts";

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 100;
/** Fallos seguidos que desactivan el remitente propio. */
export const MAX_CONSECUTIVE_FAILURES = 3;
const ALERT_INTERVAL_MS = 60 * 60_000;

export interface WorkspaceMailerDeps {
  /** Remitente de SpiderFolio: correos de cuenta y respaldo. */
  base: Mailer;
  prisma: PrismaClient;
  /** null: sin clave de cifrado, todo sale por SpiderFolio. */
  box: SecretBox | null;
  /** Proveedor de dominios verificados (modo Dominio); null si no hay. */
  domainProvider: EmailDomainProvider | null;
  env: Pick<Env, "EMAIL_ALLOW_PRIVATE_HOSTS" | "APP_URL">;
  logger: Logger;
}

interface CachedTransport {
  transport: Transporter;
  expiresAt: number;
}

export function createWorkspaceMailer(deps: WorkspaceMailerDeps): Mailer {
  const cache = new Map<string, CachedTransport>();

  const dropWorkspace = (workspaceId: string) => {
    for (const [key, entry] of cache) {
      if (key.startsWith(`${workspaceId}:`)) {
        entry.transport.close();
        cache.delete(key);
      }
    }
  };

  async function transportFor(box: SecretBox, row: WorkspaceEmail): Promise<Transporter> {
    const now = Date.now();
    const key = `${row.workspaceId}:${String(row.updatedAt.getTime())}`;
    const hit = cache.get(key);
    if (hit !== undefined && hit.expiresAt > now) return hit.transport;
    dropWorkspace(row.workspaceId);
    const connection = connectionOf(box, row);
    if (connection === null) throw new Error("Configuración incompleta");
    const allowPrivate = deps.env.EMAIL_ALLOW_PRIVATE_HOSTS;
    const ip = await resolveSmtpHost(connection.host, allowPrivate);
    const transport = createSmtpTransport(connection, ip, allowPrivate);
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.get(oldest)?.transport.close();
        cache.delete(oldest);
      }
    }
    cache.set(key, { transport, expiresAt: now + CACHE_TTL_MS });
    return transport;
  }

  /** La configuración propia, si hoy puede usarse; null = enviar por SpiderFolio. */
  async function activeConfig(workspaceId: string): Promise<WorkspaceEmail | null> {
    if (deps.box === null) return null;
    const db = forTenant(deps.prisma, workspaceId);
    const row = await db.workspaceEmail.findFirst({ where: {} });
    if (row === null || row.status !== "ACTIVE") return null;
    if (
      row.mode === "DOMAIN" &&
      (deps.domainProvider === null || row.domainStatus !== "VERIFIED")
    ) {
      return null;
    }
    if (row.fromEmail === null || row.fromName === null) return null;
    return row;
  }

  async function recordSuccess(row: WorkspaceEmail): Promise<void> {
    if (row.consecutiveFailures === 0) return;
    await forTenant(deps.prisma, row.workspaceId).workspaceEmail.update({
      where: { id: row.id },
      data: { consecutiveFailures: 0 },
    });
  }

  async function recordFailure(row: WorkspaceEmail, error: unknown): Promise<void> {
    const { code, message } = classifySmtpError(error);
    const db = forTenant(deps.prisma, row.workspaceId);
    const now = new Date();
    const updated = await db.workspaceEmail.update({
      where: { id: row.id },
      data: { lastError: message, lastErrorAt: now, consecutiveFailures: { increment: 1 } },
    });
    const disabled = updated.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
    const alertDue =
      updated.lastFallbackAlertAt === null ||
      now.getTime() - updated.lastFallbackAlertAt.getTime() >= ALERT_INTERVAL_MS;
    if (disabled || alertDue) {
      await db.workspaceEmail.update({
        where: { id: row.id },
        data: {
          ...(disabled ? { status: "DISABLED" as const } : {}),
          ...(alertDue ? { lastFallbackAlertAt: now } : {}),
        },
      });
    }
    await audit(db, {
      action: "email.fallback",
      entityType: "WorkspaceEmail",
      entityId: row.id,
      metadata: { code, consecutiveFailures: updated.consecutiveFailures, disabled },
    });
    deps.logger.warn(
      { workspaceId: row.workspaceId, code },
      "SMTP propio falló: respaldo por SpiderFolio",
    );
    if (alertDue) await alertAdmins(row.workspaceId, disabled);
  }

  /** Campana y email de SpiderFolio a quienes administran la seguridad (máximo uno por hora). */
  async function alertAdmins(workspaceId: string, disabled: boolean): Promise<void> {
    const db = forTenant(deps.prisma, workspaceId);
    const admins = await db.membership.findMany({
      where: {
        status: "ACTIVE",
        role: { OR: [{ base: "OWNER" }, { capabilities: { has: "security.manage" } }] },
      },
      select: { id: true, user: { select: { email: true } } },
      take: 50,
    });
    if (admins.length === 0) return;
    const hourBucket = String(Math.floor(Date.now() / ALERT_INTERVAL_MS));
    await db.notification.createMany({
      data: admins.map((admin) => ({
        membershipId: admin.id,
        kind: "email_fallback",
        dedupeKey: `email_fallback:${hourBucket}`,
      })),
      skipDuplicates: true,
    });
    const { slug } = await db.workspace.findFirstOrThrow({ where: {}, select: { slug: true } });
    const texts = customEmailTexts.alert;
    const content = renderEmail({
      subject: texts.subject,
      title: texts.title,
      paragraphs: disabled ? [texts.body, texts.disabled] : [texts.body],
      action: {
        label: texts.action,
        url: new URL(`/app/${slug}/admin/security`, deps.env.APP_URL).toString(),
      },
    });
    for (const admin of admins) {
      if (admin.user.email === null) continue;
      try {
        await deps.base.send({ to: admin.user.email, ...content });
      } catch (error) {
        deps.logger.warn({ err: error }, "No se pudo avisar del respaldo a un administrador");
      }
    }
  }

  async function send(message: MailMessage): Promise<void> {
    const { workspaceId, ...rest } = message;
    if (workspaceId === undefined) return deps.base.send(rest);
    const row = await activeConfig(workspaceId);
    if (row === null || deps.box === null || row.fromEmail === null || row.fromName === null) {
      return deps.base.send(rest);
    }
    try {
      const own = {
        from: { name: row.fromName, address: row.fromEmail },
        ...(row.replyTo === null ? {} : { replyTo: row.replyTo }),
        to: rest.to,
        subject: rest.subject,
        html: rest.html,
        text: rest.text,
      };
      if (row.mode === "DOMAIN") {
        if (deps.domainProvider === null || row.domainProviderRef === null) {
          throw new Error("Dominio sin proveedor");
        }
        await deps.domainProvider.send(row.domainProviderRef, own);
      } else {
        const transport = await transportFor(deps.box, row);
        await transport.sendMail(own);
      }
      await recordSuccess(row);
      return;
    } catch (error) {
      await recordFailure(row, error);
    }
    // Respaldo inmediato: el mismo correo, con el nombre de la empresa y su Reply-To.
    const workspace = await forTenant(deps.prisma, workspaceId).workspace.findFirstOrThrow({
      where: {},
      select: { name: true },
    });
    await deps.base.send({
      ...rest,
      fromName: customEmailTexts.fallbackFromName(workspace.name),
      replyTo: row.replyTo ?? row.fromEmail,
    });
  }

  return { send };
}
