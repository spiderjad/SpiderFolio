// Contenido de cada tipo de email. Los enlaces con token llevan el token en el fragmento
// (#token=…): el navegador no lo envía al servidor, así no queda en logs ni en el Referer; la
// app lo lee y lo manda por POST (CLAUDE.md, sección 7.3).
import { formatDateTimeIn } from "../lib/time-zone.ts";
import {
  emailChangeTexts,
  emailTexts,
  exportEmailTexts,
  invitationEmailTexts,
  documentNoticeTexts,
  mentionEmailTexts,
  sharedEmailTexts,
} from "../i18n/index.ts";
import type { EmailJob } from "../jobs/queues.ts";
import { renderEmail, type EmailContent } from "./layout.ts";
import { currentLocale } from "../i18n/locales.ts";

export interface EmailContext {
  recipientName: string;
  appUrl: string;
  /** Token recién creado por el worker (verify-email, reset-password). */
  token?: string;
  /** Datos de la invitación (invitation). */
  invitation?: { workspaceName: string; inviterName: string | null; roleName: string };
  /** Datos del inicio de sesión (new-login). */
  login?: { userAgent: string | null; at: Date };
  /** The recipient's company zone: dates and times are written in it (UTC if unknown). */
  timeZone?: string;
  /** Cambio de email: el nuevo (para el aviso al anterior). */
  newEmail?: string;
  /** Datos de la mención (mention). */
  mention?: { who: string; page: string; inComment: boolean; url: string };
  /** Datos de un aviso de documento controlado (document-notice). */
  documentNotice?: {
    kind:
      | "approval_pending"
      | "approval_approved"
      | "approval_rejected"
      | "approval_changes"
      | "reading_required"
      | "reading_reminder"
      | "reading_overdue_leader";
    who: string;
    /** Plazo o vencimiento ya escrito en español (null: sin plazo). */
    due: string | null;
    what: string;
    code: string;
    version: number;
    url: string;
  };
  /** Datos del acceso compartido (shared). */
  shared?: { who: string; what: string; level: keyof typeof sharedEmailTexts.levels; url: string };
  /** Workspace del administrador que reinició la 2FA (mfa-reset). */
  workspaceName?: string;
  /** Datos del ZIP (export-ready, export-failed). */
  zip?: { fileName: string; sizeLabel: string; url: string; retentionDays: number; reason: string };
}

export function tokenLink(appUrl: string, path: string, token: string): string {
  const url = new URL(path, appUrl);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function requireToken(context: EmailContext): string {
  if (context.token === undefined) throw new Error("Falta el token del email");
  return context.token;
}

/** Date and time in the company's zone, naming it: an account email may reach someone elsewhere. */
function formatWhen(date: Date, timeZone: string): string {
  return `${formatDateTimeIn(date, timeZone, currentLocale())} (${timeZone})`;
}

/** Resumen del user agent: navegador y sistema, sin versiones. */
export function describeDevice(userAgent: string | null): string {
  if (userAgent === null || userAgent === "") return emailTexts.newLogin.unknownDevice;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  const parts = [browser, os].filter((part): part is string => part !== null);
  return parts.length === 0 ? emailTexts.newLogin.unknownDevice : parts.join(emailTexts.deviceJoin);
}

export function buildEmail(job: EmailJob, context: EmailContext): EmailContent {
  const name = context.recipientName;
  switch (job.kind) {
    case "verify-email": {
      const t = emailTexts.verifyEmail;
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body],
        action: {
          label: t.action,
          url: tokenLink(context.appUrl, "/verify-email", requireToken(context)),
        },
        footnotes: [t.expiry],
      });
    }
    case "reset-password": {
      const t = emailTexts.resetPassword;
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body],
        action: {
          label: t.action,
          url: tokenLink(context.appUrl, "/reset-password", requireToken(context)),
        },
        footnotes: [t.expiry],
      });
    }
    case "invitation": {
      const t = invitationEmailTexts;
      const invitation = context.invitation;
      if (invitation === undefined) throw new Error("Faltan los datos de la invitación");
      return renderEmail({
        subject: t.subject(invitation.workspaceName),
        title: t.title(invitation.workspaceName),
        paragraphs: [
          t.greeting,
          t.body(
            invitation.inviterName ?? t.someone,
            invitation.workspaceName,
            invitation.roleName,
          ),
        ],
        action: {
          label: t.action,
          url: tokenLink(context.appUrl, "/accept-invite", requireToken(context)),
        },
        footnotes: [t.expiry],
      });
    }
    case "mfa-enabled":
    case "mfa-disabled": {
      const t = job.kind === "mfa-enabled" ? emailTexts.mfaEnabled : emailTexts.mfaDisabled;
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body, t.warning],
      });
    }
    case "mfa-reset": {
      const t = emailTexts.mfaReset;
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [
          t.greeting(name),
          t.body(context.workspaceName ?? emailTexts.yourCompany),
          t.warning,
        ],
      });
    }
    case "password-changed": {
      const t = emailTexts.passwordChanged;
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body, t.warning],
      });
    }
    case "email-change": {
      const t = emailChangeTexts.confirm;
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body],
        action: {
          label: t.action,
          url: tokenLink(context.appUrl, "/verify-email", requireToken(context)),
        },
        footnotes: [t.expiry],
      });
    }
    case "mention": {
      const t = mentionEmailTexts;
      const mention = context.mention;
      if (mention === undefined) throw new Error("Faltan los datos de la mención");
      return renderEmail({
        subject: t.subject(mention.who),
        title: t.title(mention.who),
        paragraphs: [
          t.greeting(name),
          mention.inComment
            ? t.inComment(mention.who, mention.page)
            : t.inPage(mention.who, mention.page),
        ],
        action: { label: t.action, url: mention.url },
        footnotes: [t.footnote],
      });
    }
    case "document-notice": {
      const t = documentNoticeTexts;
      const notice = context.documentNotice;
      if (notice === undefined) throw new Error("Faltan los datos del aviso del documento");
      const text = t[notice.kind];
      return renderEmail({
        subject: text.subject(notice.what),
        title: text.title,
        paragraphs: [
          t.greeting(name),
          notice.kind === "approval_pending"
            ? t.approval_pending.body(notice.who, notice.what, notice.code, notice.version)
            : notice.kind === "approval_approved"
              ? t.approval_approved.body(notice.what, notice.code, notice.version)
              : notice.kind === "approval_rejected"
                ? t.approval_rejected.body(notice.what, notice.code, notice.version)
                : notice.kind === "approval_changes"
                  ? t.approval_changes.body(notice.who, notice.what, notice.code, notice.version)
                  : t[notice.kind].body(
                      notice.who,
                      notice.what,
                      notice.code,
                      notice.version,
                      notice.due,
                    ),
        ],
        action: { label: text.action, url: notice.url },
        footnotes: [t.footnote],
      });
    }
    case "shared": {
      const t = sharedEmailTexts;
      const shared = context.shared;
      if (shared === undefined) throw new Error("Faltan los datos del acceso compartido");
      return renderEmail({
        subject: t.subject(shared.who, shared.what),
        title: t.title(shared.who),
        paragraphs: [t.greeting(name), t.body(shared.who, shared.what, t.levels[shared.level])],
        action: { label: t.action, url: shared.url },
        footnotes: [t.footnote],
      });
    }
    case "export-ready": {
      const t = exportEmailTexts.ready;
      const zip = context.zip;
      if (zip === undefined) throw new Error("Faltan los datos del ZIP");
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body(zip.fileName, zip.sizeLabel)],
        action: { label: t.action, url: zip.url },
        footnotes: [t.expiry(zip.retentionDays)],
      });
    }
    case "export-failed": {
      const t = exportEmailTexts.failed;
      const zip = context.zip;
      if (zip === undefined) throw new Error("Faltan los datos del ZIP");
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(name), t.body(zip.fileName, zip.reason), t.retry],
      });
    }
    case "new-login": {
      const t = emailTexts.newLogin;
      const login = context.login ?? { userAgent: null, at: new Date() };
      return renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [
          t.greeting(name),
          t.body(describeDevice(login.userAgent), formatWhen(login.at, context.timeZone ?? "UTC")),
          t.warning,
        ],
      });
    }
  }
}
