// The server SMTP (SMTP_* in .env): the one that sends account emails and, when a company has no
// sender of its own, every email. Its state lives in SystemEmailHealth (one global row). A permanent
// failure (credentials, sender rejected) is not retried: the email fails at once and the owner and
// administrators of the affected companies get a bell notice with the reason (a code, never the
// server text). The admin test shows the exact error, with the SMTP user and password masked.
import type { Logger } from "pino";
import type { Env } from "../../config/env.ts";
import { forTenant } from "../../db/tenant.ts";
import { renderEmail } from "../../emails/layout.ts";
import { customEmailTexts } from "../../i18n/index.ts";
import type { EmailJob } from "../../jobs/queues.ts";
import { AppError } from "../../lib/errors.ts";
import { createMailer, type Mailer } from "../../lib/mailer.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { classifySmtpError, type SmtpErrorCode } from "./smtp.ts";

const HEALTH_ID = "system";
const ALERT_INTERVAL_MS = 60 * 60_000;
/** Workspaces notified for one failed email (a person can belong to several). */
const MAX_WORKSPACES = 20;
const MAX_RESPONSE_LENGTH = 300;

/** Errors that a retry can't fix: wrong user or password, sender or recipient rejected. */
export function isPermanentSmtpError(code: SmtpErrorCode): boolean {
  return code === "AUTH" || code === "SENDER_REJECTED";
}

export interface SmtpErrorDetail {
  /** Classified reason (the same codes as the company sender). */
  code: SmtpErrorCode;
  /** Explanation of the reason, safe to show. */
  message: string;
  /** Nodemailer code (EAUTH, ECONNECTION…). */
  smtpCode: string | null;
  /** SMTP reply code (535, 553…). */
  responseCode: number | null;
  /** The server's reply, with the SMTP user and password masked. */
  response: string | null;
}

/** Everything about a failure, for the admin test. `secrets` are masked wherever they appear. */
export function smtpErrorDetail(error: unknown, secrets: readonly string[]): SmtpErrorDetail {
  const { code, message } = classifySmtpError(error);
  const raw = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
    message?: unknown;
  };
  const text =
    typeof raw.response === "string"
      ? raw.response
      : typeof raw.message === "string"
        ? raw.message
        : null;
  return {
    code,
    message,
    smtpCode: typeof raw.code === "string" ? raw.code : null,
    responseCode: typeof raw.responseCode === "number" ? raw.responseCode : null,
    response: text === null ? null : mask(text, secrets).slice(0, MAX_RESPONSE_LENGTH),
  };
}

function mask(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    // Very short values would mask ordinary words; they're not worth hiding.
    if (secret.length >= 3) out = out.split(secret).join("***");
  }
  return out;
}

export interface SystemEmailStatus {
  /** The last attempt failed (no success since). */
  failing: boolean;
  lastErrorCode: SmtpErrorCode | null;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
}

const ERROR_CODES: readonly SmtpErrorCode[] = [
  "AUTH",
  "CONNECTION",
  "TLS",
  "SENDER_REJECTED",
  "UNKNOWN",
];
const codeOf = (value: string | null): SmtpErrorCode | null =>
  value === null ? null : (ERROR_CODES.find((code) => code === value) ?? "UNKNOWN");

export async function systemEmailStatus(prisma: PrismaClient): Promise<SystemEmailStatus> {
  const row = await prisma.systemEmailHealth.findUnique({ where: { id: HEALTH_ID } });
  const lastErrorAt = row?.lastErrorAt ?? null;
  const lastSuccessAt = row?.lastSuccessAt ?? null;
  return {
    failing: lastErrorAt !== null && (lastSuccessAt === null || lastErrorAt > lastSuccessAt),
    lastErrorCode: codeOf(row?.lastErrorCode ?? null),
    lastErrorAt,
    lastSuccessAt,
  };
}

export async function recordSystemEmailSuccess(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  await prisma.systemEmailHealth.upsert({
    where: { id: HEALTH_ID },
    create: { id: HEALTH_ID, lastSuccessAt: now },
    update: { lastSuccessAt: now },
  });
}

export async function recordSystemEmailFailure(
  prisma: PrismaClient,
  code: SmtpErrorCode,
): Promise<void> {
  const now = new Date();
  await prisma.systemEmailHealth.upsert({
    where: { id: HEALTH_ID },
    create: { id: HEALTH_ID, lastErrorCode: code, lastErrorAt: now },
    update: { lastErrorCode: code, lastErrorAt: now },
  });
}

/**
 * Wraps the server mailer and keeps SystemEmailHealth up to date. A success is only written when
 * the last known state was a failure, so a healthy server doesn't write once per email.
 */
export function monitorSystemMailer(
  base: Mailer,
  deps: { prisma: PrismaClient; logger: Logger },
): Mailer {
  let failing: boolean | null = null;
  return {
    async send(message) {
      try {
        await base.send(message);
      } catch (error) {
        const { code } = classifySmtpError(error);
        failing = true;
        try {
          await recordSystemEmailFailure(deps.prisma, code);
        } catch (recordError) {
          deps.logger.warn({ err: recordError }, "No se pudo guardar el estado del SMTP");
        }
        throw error;
      }
      try {
        failing ??= (await systemEmailStatus(deps.prisma)).failing;
        if (failing) {
          await recordSystemEmailSuccess(deps.prisma);
          failing = false;
        }
      } catch (recordError) {
        deps.logger.warn({ err: recordError }, "No se pudo guardar el estado del SMTP");
      }
    },
  };
}

/** Workspaces an email belongs to: its own, or the recipient's for account emails. */
export async function workspacesOfEmailJob(prisma: PrismaClient, job: EmailJob): Promise<string[]> {
  switch (job.kind) {
    case "invitation":
      return idsOf(
        await prisma.invitation.findUnique({
          where: { id: job.invitationId },
          select: { workspaceId: true },
        }),
      );
    case "mention":
      return idsOf(
        await prisma.mention.findUnique({
          where: { id: job.mentionId },
          select: { workspaceId: true },
        }),
      );
    case "shared":
      return idsOf(
        await prisma.permission.findUnique({
          where: { id: job.permissionId },
          select: { workspaceId: true },
        }),
      );
    case "document-notice":
      return idsOf(
        await prisma.notification.findUnique({
          where: { id: job.notificationId },
          select: { workspaceId: true },
        }),
      );
    case "export-ready":
    case "export-failed":
      return idsOf(
        await prisma.zipExport.findUnique({
          where: { id: job.exportId },
          select: { workspaceId: true },
        }),
      );
    case "mfa-reset":
      return [job.workspaceId];
    default: {
      const memberships = await prisma.membership.findMany({
        where: { userId: job.userId, status: "ACTIVE" },
        select: { workspaceId: true },
        orderBy: { createdAt: "asc" },
        take: MAX_WORKSPACES,
      });
      return memberships.map((row) => row.workspaceId);
    }
  }
}

const idsOf = (row: { workspaceId: string } | null): string[] =>
  row === null ? [] : [row.workspaceId];

/**
 * Bell notice «email_failing» to the owner and administrators of each workspace, with the reason
 * code. At most one per person and hour (dedupeKey); returns how many were created.
 */
export async function notifyEmailFailing(
  prisma: PrismaClient,
  workspaceIds: readonly string[],
  code: SmtpErrorCode,
  now = new Date(),
): Promise<number> {
  const hourBucket = String(Math.floor(now.getTime() / ALERT_INTERVAL_MS));
  let created = 0;
  for (const workspaceId of new Set(workspaceIds)) {
    const db = forTenant(prisma, workspaceId);
    const admins = await db.membership.findMany({
      where: {
        status: "ACTIVE",
        role: {
          OR: [{ base: { in: ["OWNER", "ADMIN"] } }, { capabilities: { has: "security.manage" } }],
        },
      },
      select: { id: true },
      take: 50,
    });
    if (admins.length === 0) continue;
    const result = await db.notification.createMany({
      data: admins.map((admin) => ({
        membershipId: admin.id,
        kind: "email_failing",
        detail: code,
        dedupeKey: `email_failing:${hourBucket}`,
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }
  if (created > 0) {
    await prisma.systemEmailHealth.upsert({
      where: { id: HEALTH_ID },
      create: { id: HEALTH_ID, lastAlertAt: now },
      update: { lastAlertAt: now },
    });
  }
  return created;
}

/**
 * An email failed for good (permanent error, or transient ones until the retries ran out): notify
 * the administrators of its workspaces with the last recorded reason.
 */
export async function alertFailedEmail(prisma: PrismaClient, job: EmailJob): Promise<number> {
  const status = await systemEmailStatus(prisma);
  const workspaceIds = await workspacesOfEmailJob(prisma, job);
  return notifyEmailFailing(prisma, workspaceIds, status.lastErrorCode ?? "UNKNOWN");
}

export interface SystemEmailView {
  status: SystemEmailStatus;
  /** Where it sends from (SMTP_HOST, SMTP_PORT, MAIL_FROM); never the user or the password. */
  host: string;
  port: number;
  from: string;
}

export type SystemTestResult = { ok: true } | ({ ok: false } & SmtpErrorDetail);

export interface SystemEmailDeps {
  prisma: PrismaClient;
  env: Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "MAIL_FROM">;
  /** Tests only: replaces the mailer built from the environment. */
  mailer?: Mailer;
}

export async function getSystemEmail(deps: SystemEmailDeps): Promise<SystemEmailView> {
  return {
    status: await systemEmailStatus(deps.prisma),
    host: deps.env.SMTP_HOST,
    port: deps.env.SMTP_PORT,
    from: deps.env.MAIL_FROM,
  };
}

/** Sends a test with the server SMTP to whoever asks, and returns the exact error if it fails. */
export async function sendSystemTestEmail(
  ctx: AdminContext,
  deps: SystemEmailDeps,
  userId: string,
): Promise<{ result: SystemTestResult; settings: SystemEmailView }> {
  // Only to the requester's own email: it can't be used to write to third parties.
  const recipient = await deps.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  if (recipient.email === null) {
    throw new AppError("BAD_REQUEST", { message: customEmailTexts.noRecipient });
  }
  const texts = customEmailTexts.systemTest;
  const content = renderEmail({
    subject: texts.subject,
    title: texts.title,
    paragraphs: [texts.body],
  });
  const mailer = deps.mailer ?? createMailer(deps.env);
  let result: SystemTestResult;
  try {
    await mailer.send({ to: recipient.email, ...content });
    await recordSystemEmailSuccess(deps.prisma);
    result = { ok: true };
  } catch (error) {
    const secrets = [deps.env.SMTP_USER, deps.env.SMTP_PASS].filter(
      (value): value is string => value !== undefined,
    );
    const detail = smtpErrorDetail(error, secrets);
    await recordSystemEmailFailure(deps.prisma, detail.code);
    result = { ok: false, ...detail };
  }
  await auditAdmin(ctx, {
    action: "email.system_test",
    entityType: "SystemEmailHealth",
    entityId: HEALTH_ID,
    metadata: { ok: result.ok, ...(result.ok ? {} : { code: result.code }) },
  });
  return { result, settings: await getSystemEmail(deps) };
}
