// Handlers del worker. Reciben sus dependencias por parámetro para poder probarlos.
import { maintenanceLimits } from "@spiderfolio/limits";
import { generateDue } from "../modules/maintenance/plans.service.ts";
import { companyToday } from "../modules/quality/prps.service.ts";
import { dayIn, formatDayIn, zoneOf } from "../lib/time-zone.ts";
import * as Sentry from "@sentry/node";
import type { Logger } from "pino";
import { renderEmail } from "../emails/layout.ts";
import { loadTenantContext } from "../middleware/tenant.ts";
import { accessActorOf, loadAccess } from "../modules/access/access.ts";
import { buildEmail, type EmailContext } from "../emails/templates.ts";
import { emailChangeTexts, emailTexts, expiryNoticeTexts, formNoticeTexts } from "../i18n/index.ts";
import { dayOf, expiryKindOf } from "../modules/expiries/expiries.service.ts";
import { daysUntil } from "../modules/expiries/expiry-rules.ts";
import "../modules/expiries/kinds.ts";
import { withLocale } from "../i18n/locales.ts";
import { emailLocale } from "./email-locale.ts";
import { alertFailedEmail } from "../modules/email-settings/system-email.ts";
import { randomInt } from "node:crypto";
import { AUDIT_CODE_MINUTES, auditCodeHash } from "../modules/audit-rooms/codes.ts";
import { randomToken, sha256 } from "../lib/crypto.ts";
import { issueAuthToken } from "../modules/auth/auth-tokens.ts";
import type { Mailer } from "../lib/mailer.ts";
import type { Storage } from "../lib/storage.ts";
import { EXPORT_RETENTION_DAYS } from "../modules/downloads/downloads.service.ts";
import { expireExports } from "../modules/downloads/zip-export.ts";
import { formatBytes } from "../lib/bytes.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import { forTenant } from "../db/tenant.ts";
import { purgeTrashRoot, TRASH_RETENTION_DAYS } from "../modules/trash/trash.service.ts";
import type { Jobs } from "./boss.ts";
import {
  EmailJobSchema,
  MaintenanceJobSchema,
  ObjectsDeleteJobSchema,
  type EmailJob,
} from "./queues.ts";
import { currentLocale } from "../i18n/locales.ts";

export interface WorkerDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  logger: Logger;
  /** APP_URL, base de los enlaces de los emails. */
  appUrl: string;
  storage: Storage;
  /** Bucket de sistema (ZIP en segundo plano). */
  systemStorage: Storage;
  /** Gotenberg (HTML → PDF) para el PDF controlado. */
  gotenbergUrl?: string;
  /** Bian habilitado: el worker indexa los fragmentos (BIAN_ENABLED). */
  bianEnabled?: boolean;
}

/**
 * Invitación: el token se crea acá, al enviar, y reemplaza al anterior (solo sirve el último
 * enlace). Si la invitación ya no está pendiente no se envía nada.
 */
async function sendInvitationEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "invitation" }>,
): Promise<void> {
  const invitation = await deps.prisma.invitation.findUnique({
    where: { id: job.invitationId },
    select: {
      email: true,
      workspaceId: true,
      invitedById: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      role: { select: { name: true } },
      workspace: { select: { name: true } },
    },
  });
  if (
    invitation === null ||
    invitation.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    invitation.expiresAt <= new Date()
  ) {
    deps.logger.warn({ kind: job.kind }, "Email omitido: la invitación ya no está pendiente");
    return;
  }
  const inviter = await deps.prisma.user.findUnique({
    where: { id: invitation.invitedById },
    select: { name: true },
  });
  const token = randomToken();
  await deps.prisma.invitation.update({
    where: { id: job.invitationId },
    data: { tokenHash: sha256(token) },
  });
  const email = buildEmail(job, {
    recipientName: "",
    appUrl: deps.appUrl,
    token,
    invitation: {
      workspaceName: invitation.workspace.name,
      inviterName: inviter?.name ?? null,
      roleName: invitation.role.name,
    },
  });
  await deps.mailer.send({ to: invitation.email, workspaceId: invitation.workspaceId, ...email });
}

/** ZIP en segundo plano: el enlace se crea al enviar y reemplaza al anterior (solo sirve el último). */
async function sendExportEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "export-ready" | "export-failed" }>,
): Promise<void> {
  const zip = await deps.prisma.zipExport.findUnique({ where: { id: job.exportId } });
  if (zip === null) return;
  const membership = await deps.prisma.membership.findFirst({
    where: { id: zip.membershipId, workspaceId: zip.workspaceId, status: "ACTIVE" },
    select: { user: { select: { email: true, name: true } } },
  });
  const user = membership?.user;
  if (user?.email === undefined || user.email === null) {
    deps.logger.warn({ kind: job.kind }, "Email omitido: no hay a quién escribirle");
    return;
  }
  const base: EmailContext = { recipientName: user.name, appUrl: deps.appUrl };
  if (job.kind === "export-failed") {
    const email = buildEmail(job, {
      ...base,
      zip: {
        fileName: zip.fileName,
        sizeLabel: "",
        url: "",
        retentionDays: EXPORT_RETENTION_DAYS,
        reason: zip.error ?? "",
      },
    });
    await deps.mailer.send({ to: user.email, workspaceId: zip.workspaceId, ...email });
    return;
  }
  if (zip.status !== "DONE") return;
  const token = randomToken();
  await deps.prisma.zipExport.update({ where: { id: zip.id }, data: { linkHash: sha256(token) } });
  const email = buildEmail(job, {
    ...base,
    zip: {
      fileName: zip.fileName,
      sizeLabel: formatBytes(Number(zip.sizeBytes ?? 0n)),
      url: new URL(`/api/v1/exports/${token}`, deps.appUrl).toString(),
      retentionDays: EXPORT_RETENTION_DAYS,
      reason: "",
    },
  });
  await deps.mailer.send({ to: user.email, workspaceId: zip.workspaceId, ...email });
}

/** Cambio de email: el enlace va al email nuevo y un aviso (sin enlace) al actual. */
async function sendEmailChange(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "email-change" }>,
): Promise<void> {
  const user = await deps.prisma.user.findUnique({
    where: { id: job.userId },
    select: { name: true, email: true, pendingEmail: true },
  });
  if (user?.pendingEmail == null) return;
  const token = await issueAuthToken(deps.prisma, job.userId, "CHANGE_EMAIL");
  const confirm = buildEmail(job, { recipientName: user.name, appUrl: deps.appUrl, token });
  await deps.mailer.send({ to: user.pendingEmail, ...confirm });
  if (user.email !== null) {
    const t = emailChangeTexts.notice;
    await deps.mailer.send({
      to: user.email,
      ...renderEmail({
        subject: t.subject,
        title: t.title,
        paragraphs: [t.greeting(user.name), t.body(user.pendingEmail), t.warning],
      }),
    });
  }
}

/** Aviso de una mención: solo a quien sigue ACTIVO y ve la página (el título no se filtra). */
async function sendMentionEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "mention" }>,
): Promise<void> {
  const mention = await deps.prisma.mention.findUnique({ where: { id: job.mentionId } });
  if (mention === null) return;
  const [page, recipient, author] = await Promise.all([
    deps.prisma.node.findFirst({
      where: { id: mention.nodeId, trashedAt: null, type: "PAGE" },
      select: { name: true, spaceId: true, workspace: { select: { slug: true } } },
    }),
    deps.prisma.membership.findFirst({
      where: { id: mention.mentionedId, status: "ACTIVE" },
      select: { userId: true, user: { select: { email: true, name: true } } },
    }),
    deps.prisma.membership.findFirst({
      where: { id: mention.createdById },
      select: { user: { select: { name: true } } },
    }),
  ]);
  if (page === null || recipient === null || recipient.user.email === null) return;
  const loaded = await loadTenantContext(
    deps.prisma,
    { id: mention.workspaceId },
    recipient.userId,
  );
  if (loaded === null) return;
  const access = await loadAccess(loaded.db, accessActorOf({ tenant: loaded.tenant }), {
    nodeIds: [mention.nodeId],
    spaceIds: [page.spaceId],
  });
  if (access.ofNode(mention.nodeId) === null) return;
  const url = new URL(
    `/app/${page.workspace.slug}/files/${page.spaceId}/p/${mention.nodeId}`,
    deps.appUrl,
  ).toString();
  const email = buildEmail(job, {
    recipientName: recipient.user.name,
    appUrl: deps.appUrl,
    mention: {
      who: author?.user.name ?? emailTexts.someone,
      page: page.name,
      inComment: mention.commentId !== null,
      url,
    },
  });
  await deps.mailer.send({ to: recipient.user.email, workspaceId: mention.workspaceId, ...email });
}

/**
 * Aviso de un acceso compartido: solo a una persona (no a un departamento), si sigue ACTIVA y de
 * verdad ve lo compartido. Cuando exista la preferencia de avisos (módulo 7) se respeta acá.
 */
async function sendSharedEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "shared" }>,
): Promise<void> {
  const permission = await deps.prisma.permission.findUnique({
    where: { id: job.permissionId },
    select: {
      workspaceId: true,
      spaceId: true,
      nodeId: true,
      level: true,
      grantedById: true,
      membershipId: true,
      workspace: { select: { slug: true } },
    },
  });
  if (permission === null || permission.membershipId === null) return;
  const [recipient, granter, node, space] = await Promise.all([
    deps.prisma.membership.findFirst({
      where: { id: permission.membershipId, status: "ACTIVE" },
      select: { userId: true, user: { select: { email: true, name: true } } },
    }),
    deps.prisma.membership.findFirst({
      where: { id: permission.grantedById },
      select: { user: { select: { name: true } } },
    }),
    permission.nodeId === null
      ? null
      : deps.prisma.node.findFirst({
          where: { id: permission.nodeId, trashedAt: null },
          select: { id: true, name: true, type: true, parentId: true, spaceId: true },
        }),
    permission.spaceId === null
      ? null
      : deps.prisma.space.findFirst({
          where: { id: permission.spaceId },
          select: { id: true, name: true },
        }),
  ]);
  if (recipient === null || recipient.user.email === null) return;
  const spaceId = node?.spaceId ?? space?.id;
  const what = node?.name ?? space?.name;
  if (spaceId === undefined || what === undefined) return;
  const loaded = await loadTenantContext(
    deps.prisma,
    { id: permission.workspaceId },
    recipient.userId,
  );
  if (loaded === null) return;
  const access = await loadAccess(loaded.db, accessActorOf({ tenant: loaded.tenant }), {
    nodeIds: node === null ? [] : [node.id],
    spaceIds: [spaceId],
  });
  const sees = node === null ? access.ofSpace(spaceId) : access.ofNode(node.id);
  if (sees === null) return;
  const base = `/app/${permission.workspace.slug}/files/${spaceId}`;
  const path =
    node === null
      ? base
      : node.type === "PAGE"
        ? `${base}/p/${node.id}`
        : node.type === "FORM"
          ? `${base}/form/${node.id}`
          : node.type === "FOLDER"
            ? `${base}/f/${node.id}`
            : node.parentId === null
              ? base
              : `${base}/f/${node.parentId}`;
  const email = buildEmail(job, {
    recipientName: recipient.user.name,
    appUrl: deps.appUrl,
    shared: {
      who: granter?.user.name ?? emailTexts.someone,
      what,
      level: permission.level,
      url: new URL(path, deps.appUrl).toString(),
    },
  });
  await deps.mailer.send({
    to: recipient.user.email,
    workspaceId: permission.workspaceId,
    ...email,
  });
}

/** Aviso de un documento controlado: solo a quien sigue ACTIVO y todavía ve el documento. */
async function sendDocumentNoticeEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "document-notice" }>,
): Promise<void> {
  const notice = await deps.prisma.notification.findUnique({ where: { id: job.notificationId } });
  if (notice === null || notice.nodeId === null || notice.version === null) return;
  const kind = (
    [
      "approval_pending",
      "approval_approved",
      "approval_rejected",
      "approval_changes",
      "reading_required",
      "reading_reminder",
      "reading_overdue_leader",
    ] as const
  ).find((candidate) => candidate === notice.kind);
  if (kind === undefined) return;
  const [node, controlled, recipient, actor] = await Promise.all([
    deps.prisma.node.findFirst({
      where: { id: notice.nodeId, trashedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        spaceId: true,
        parentId: true,
        workspace: { select: { slug: true } },
      },
    }),
    deps.prisma.controlledDocument.findUnique({
      where: { nodeId: notice.nodeId },
      select: { code: true },
    }),
    deps.prisma.membership.findFirst({
      where: { id: notice.membershipId, status: "ACTIVE" },
      select: { userId: true, user: { select: { email: true, name: true } } },
    }),
    notice.actorId === null
      ? null
      : deps.prisma.membership.findFirst({
          where: { id: notice.actorId },
          select: { user: { select: { name: true } } },
        }),
  ]);
  if (node === null || controlled === null || recipient === null || recipient.user.email === null) {
    return;
  }
  const loaded = await loadTenantContext(deps.prisma, { id: notice.workspaceId }, recipient.userId);
  if (loaded === null) return;
  const workspace = await deps.prisma.workspace.findUnique({
    where: { id: notice.workspaceId },
    select: { settings: true },
  });
  const access = await loadAccess(loaded.db, accessActorOf({ tenant: loaded.tenant }), {
    nodeIds: [node.id],
    spaceIds: [node.spaceId],
  });
  if (access.ofNode(node.id) === null) return;
  const base = `/app/${node.workspace.slug}/files/${node.spaceId}`;
  const path =
    node.type === "PAGE"
      ? `${base}/p/${node.id}`
      : node.type === "FORM"
        ? `${base}/form/${node.id}`
        : node.parentId === null
          ? base
          : `${base}/f/${node.parentId}`;
  const email = buildEmail(job, {
    recipientName: recipient.user.name,
    appUrl: deps.appUrl,
    documentNotice: {
      kind,
      who: actor?.user.name ?? emailTexts.someone,
      // A deadline is the end of a day in the company's zone: that day, written in it.
      due:
        notice.expiresAt === null
          ? null
          : formatDayIn(notice.expiresAt, zoneOf(workspace?.settings), currentLocale()),
      what: node.name,
      code: controlled.code,
      version: notice.version,
      url: new URL(path, deps.appUrl).toString(),
    },
  });
  await deps.mailer.send({ to: recipient.user.email, workspaceId: notice.workspaceId, ...email });
}

/** A period's key in words: «el 2 de noviembre de 2026», «la semana del 2 de noviembre…», «noviembre de 2026». */
function periodWords(key: string): string {
  const p = formNoticeTexts.periods;
  if (/^\d{4}-\d{2}$/u.test(key)) {
    return p.month(
      new Intl.DateTimeFormat(currentLocale(), {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${key}-01T12:00:00Z`)),
    );
  }
  const day = new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));
  return p.day(day);
}

/** A form's notice: only to whoever is still active and still sees the form. */
async function sendFormNoticeEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "form-notice" }>,
): Promise<void> {
  const notice = await deps.prisma.notification.findUnique({ where: { id: job.notificationId } });
  if (notice === null || notice.nodeId === null || notice.detail === null) return;
  const kind = (["form_nonconforming", "form_due", "form_overdue"] as const).find(
    (candidate) => candidate === notice.kind,
  );
  if (kind === undefined) return;
  const [node, recipient, actor, settings] = await Promise.all([
    deps.prisma.node.findFirst({
      where: { id: notice.nodeId, trashedAt: null, type: "FORM" },
      select: { id: true, name: true, spaceId: true, workspace: { select: { slug: true } } },
    }),
    deps.prisma.membership.findFirst({
      where: { id: notice.membershipId, status: "ACTIVE" },
      select: { userId: true, user: { select: { email: true, name: true } } },
    }),
    notice.actorId === null
      ? null
      : deps.prisma.membership.findFirst({
          where: { id: notice.actorId },
          select: { user: { select: { name: true } } },
        }),
    deps.prisma.formSettings.findUnique({
      where: { nodeId: notice.nodeId },
      select: { frequency: true },
    }),
  ]);
  if (node === null || recipient === null || recipient.user.email === null) return;
  const loaded = await loadTenantContext(deps.prisma, { id: notice.workspaceId }, recipient.userId);
  if (loaded === null) return;
  const access = await loadAccess(loaded.db, accessActorOf({ tenant: loaded.tenant }), {
    nodeIds: [node.id],
    spaceIds: [node.spaceId],
  });
  if (access.ofNode(node.id) === null) return;
  const base = `/app/${node.workspace.slug}/files/${node.spaceId}/form/${node.id}`;
  let detail: string;
  let path: string;
  if (kind === "form_nonconforming") {
    const record = await deps.prisma.formRecord.findFirst({
      where: { id: notice.detail, nodeId: node.id },
      select: { id: true, version: true, nonConforming: true },
    });
    if (record === null) return;
    const version = await deps.prisma.formVersion.findUnique({
      where: { nodeId_version: { nodeId: node.id, version: record.version } },
      select: { fields: true },
    });
    const labels = new Map(
      ((version?.fields ?? []) as { id?: unknown; label?: unknown }[]).map((field) => [
        String(field.id),
        String(field.label),
      ]),
    );
    detail = record.nonConforming.map((id) => labels.get(id) ?? id).join(", ");
    path = `${base}/r/${record.id}`;
  } else {
    const words = periodWords(notice.detail);
    detail =
      settings?.frequency === "weekly"
        ? formNoticeTexts.periods.week(words.replace(/^\S+\s/u, ""))
        : words;
    path = kind === "form_due" ? `${base}/fill` : base;
  }
  const email = buildEmail(job, {
    recipientName: recipient.user.name,
    appUrl: deps.appUrl,
    formNotice: {
      kind,
      who: actor?.user.name ?? emailTexts.someone,
      what: node.name,
      detail,
      url: new URL(path, deps.appUrl).toString(),
    },
  });
  await deps.mailer.send({ to: recipient.user.email, workspaceId: notice.workspaceId, ...email });
}

/** Something expires: only to whoever is still active, while the item exists and isn't resolved. */
async function sendExpiryNoticeEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "expiry-notice" }>,
): Promise<void> {
  const notice = await deps.prisma.notification.findUnique({ where: { id: job.notificationId } });
  if (notice === null || notice.expiryId === null) return;
  const [expiry, recipient, workspace] = await Promise.all([
    deps.prisma.expiry.findFirst({
      where: { id: notice.expiryId, workspaceId: notice.workspaceId, resolvedAt: null },
    }),
    deps.prisma.membership.findFirst({
      where: { id: notice.membershipId, status: "ACTIVE" },
      select: { user: { select: { email: true, name: true } } },
    }),
    deps.prisma.workspace.findUnique({
      where: { id: notice.workspaceId },
      select: { slug: true, settings: true },
    }),
  ]);
  if (expiry === null || recipient === null || recipient.user.email === null || workspace === null)
    return;
  const described = await expiryKindOf(expiry.kind)?.describe(
    forTenant(deps.prisma, notice.workspaceId),
    expiry,
    { slug: workspace.slug },
  );
  if (described === undefined || described === null) return;
  const zone = zoneOf(workspace.settings);
  const due = dayOf(expiry.dueOn);
  const left = daysUntil(dayIn(new Date(), zone), due);
  const date = new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${due}T12:00:00Z`));
  const w = expiryNoticeTexts.when;
  const when =
    left < 0
      ? w.past(date)
      : left === 0
        ? w.today
        : left === 1
          ? w.tomorrow(date)
          : w.inDays(date, left);
  const email = buildEmail(job, {
    recipientName: recipient.user.name,
    appUrl: deps.appUrl,
    expiryNotice: {
      expired: left < 0,
      what: described.what,
      when,
      url: new URL(described.path, deps.appUrl).toString(),
    },
  });
  await deps.mailer.send({ to: recipient.user.email, workspaceId: notice.workspaceId, ...email });
}

/** An audit room's link, or a fresh one-time code (only the last one works), while the room is open. */
async function sendAuditRoomEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "audit-room-invite" | "audit-room-code" }>,
): Promise<void> {
  const room = await deps.prisma.auditRoom.findUnique({
    where: { id: job.roomId },
    select: {
      id: true,
      name: true,
      auditorEmail: true,
      expiresAt: true,
      revokedAt: true,
      workspaceId: true,
      workspace: { select: { name: true, settings: true } },
    },
  });
  if (room === null || room.revokedAt !== null || room.expiresAt <= new Date()) {
    deps.logger.warn({ kind: job.kind }, "Email omitido: la sala ya no está abierta");
    return;
  }
  let code: string | undefined;
  if (job.kind === "audit-room-code") {
    code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const db = forTenant(deps.prisma, room.workspaceId);
    await db.auditRoomCode.deleteMany({ where: { roomId: room.id, usedAt: null } });
    await db.auditRoomCode.create({
      data: {
        roomId: room.id,
        codeHash: auditCodeHash(room.id, code),
        expiresAt: new Date(Date.now() + AUDIT_CODE_MINUTES * 60_000),
      },
    });
  }
  const until = formatDayIn(room.expiresAt, zoneOf(room.workspace.settings), currentLocale());
  const email = buildEmail(job, {
    recipientName: "",
    appUrl: deps.appUrl,
    auditRoom: {
      company: room.workspace.name,
      room: room.name,
      until,
      url: new URL(`/auditoria/${room.id}`, deps.appUrl).toString(),
      ...(code === undefined ? {} : { code }),
    },
  });
  await deps.mailer.send({ to: room.auditorEmail, workspaceId: room.workspaceId, ...email });
}

/** A new accident or incident: only while the recipient is active and can still see health data. */
async function sendSafetyIncidentEmail(
  deps: WorkerDeps,
  job: Extract<EmailJob, { kind: "safety-incident-notice" }>,
): Promise<void> {
  const notice = await deps.prisma.notification.findUnique({ where: { id: job.notificationId } });
  if (notice === null || notice.kind !== "safety_incident" || notice.detail === null) return;
  const [recipient, actor, workspace] = await Promise.all([
    deps.prisma.membership.findFirst({
      where: {
        id: notice.membershipId,
        status: "ACTIVE",
        role: { capabilities: { has: "safety.health" } },
      },
      select: { user: { select: { email: true, name: true } } },
    }),
    notice.actorId === null
      ? null
      : deps.prisma.membership.findFirst({
          where: { id: notice.actorId },
          select: { user: { select: { name: true } } },
        }),
    deps.prisma.workspace.findUnique({ where: { id: notice.workspaceId }, select: { slug: true } }),
  ]);
  if (recipient === null || recipient.user.email === null || workspace === null) return;
  const email = buildEmail(job, {
    recipientName: recipient.user.name,
    appUrl: deps.appUrl,
    safetyIncident: {
      who: actor?.user.name ?? "",
      url: new URL(
        `/app/${workspace.slug}/seguridad/incidentes/${notice.detail}`,
        deps.appUrl,
      ).toString(),
    },
  });
  await deps.mailer.send({ to: recipient.user.email, workspaceId: notice.workspaceId, ...email });
}

export async function sendEmailJob(deps: WorkerDeps, payload: unknown): Promise<void> {
  const job: EmailJob = EmailJobSchema.parse(payload);
  // Todo el email (textos, fechas, tamaños) en el idioma del destinatario.
  const locale = await emailLocale(deps.prisma, job);
  await withLocale(locale, () => sendEmail(deps, job));
}

async function sendEmail(deps: WorkerDeps, job: EmailJob): Promise<void> {
  if (job.kind === "mention") {
    await sendMentionEmail(deps, job);
    return;
  }
  if (job.kind === "document-notice") {
    await sendDocumentNoticeEmail(deps, job);
    return;
  }
  if (job.kind === "form-notice") {
    await sendFormNoticeEmail(deps, job);
    return;
  }
  if (job.kind === "expiry-notice") {
    await sendExpiryNoticeEmail(deps, job);
    return;
  }
  if (job.kind === "audit-room-invite" || job.kind === "audit-room-code") {
    await sendAuditRoomEmail(deps, job);
    return;
  }
  if (job.kind === "safety-incident-notice") {
    await sendSafetyIncidentEmail(deps, job);
    return;
  }
  if (job.kind === "shared") {
    await sendSharedEmail(deps, job);
    return;
  }
  if (job.kind === "email-change") {
    await sendEmailChange(deps, job);
    return;
  }
  if (job.kind === "export-ready" || job.kind === "export-failed") {
    await sendExportEmail(deps, job);
    return;
  }
  if (job.kind === "invitation") {
    await sendInvitationEmail(deps, job);
    return;
  }
  const user = await deps.prisma.user.findUnique({
    where: { id: job.userId },
    select: { email: true, name: true, emailVerifiedAt: true },
  });
  // Si el usuario ya no existe no hay a quién escribirle: se da por terminado, sin reintento.
  if (user === null) {
    deps.logger.warn({ kind: job.kind }, "Email omitido: el usuario no existe");
    return;
  }
  // Usuarios de PIN (lectores de planta): no tienen email, no hay a quién escribirle.
  if (user.email === null) {
    deps.logger.warn({ kind: job.kind }, "Email omitido: el usuario no tiene email");
    return;
  }
  if (job.kind === "verify-email" && user.emailVerifiedAt !== null) return;

  const context: EmailContext = { recipientName: user.name, appUrl: deps.appUrl };
  if (job.kind === "mfa-reset") {
    const workspace = await deps.prisma.workspace.findUnique({
      where: { id: job.workspaceId },
      select: { name: true },
    });
    if (workspace !== null) context.workspaceName = workspace.name;
  }
  // El token se crea acá, al enviar: nunca queda guardado en la cola. Un reintento crea otro
  // e invalida el anterior.
  if (job.kind === "verify-email") {
    context.token = await issueAuthToken(deps.prisma, job.userId, "VERIFY_EMAIL");
  } else if (job.kind === "reset-password") {
    context.token = await issueAuthToken(deps.prisma, job.userId, "RESET_PASSWORD");
  } else if (job.kind === "new-login") {
    const session = await deps.prisma.session.findUnique({
      where: { id: job.sessionId },
      select: { userAgent: true, createdAt: true },
    });
    context.login = { userAgent: session?.userAgent ?? null, at: session?.createdAt ?? new Date() };
    // An account email: the zone of the person's first company (UTC without one).
    const membership = await deps.prisma.membership.findFirst({
      where: { userId: job.userId, status: "ACTIVE", workspace: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { workspace: { select: { settings: true } } },
    });
    context.timeZone = zoneOf(membership?.workspace.settings);
  }
  const email = buildEmail(job, context);
  await deps.mailer.send({ to: user.email, ...email });
}

/**
 * An email that won't be sent (permanent SMTP error, or retries exhausted): logged, reported to
 * Sentry and notified to the owner and administrators of its workspaces, with the reason.
 */
export async function reportFailedEmail(
  deps: Pick<WorkerDeps, "logger" | "prisma">,
  payload: unknown,
): Promise<void> {
  const job = EmailJobSchema.safeParse(payload);
  const kind = job.success ? job.data.kind : "desconocido";
  deps.logger.error({ kind }, "Email no enviado: se marcó como fallido");
  Sentry.captureMessage(`Email no enviado: ${kind}`, "error");
  if (!job.success) return;
  try {
    await alertFailedEmail(deps.prisma, job.data);
  } catch (error) {
    deps.logger.warn({ err: error }, "No se pudo avisar a los administradores del email fallido");
  }
}

export interface CleanupResult {
  rateLimitBuckets: number;
  sessions: number;
  authTokens: number;
  ssoFlows: number;
}

/** Borra objetos de S3 de lo eliminado para siempre. Idempotente: se reintenta entero si algo falla. */
export async function deleteObjects(
  deps: Pick<WorkerDeps, "storage" | "logger">,
  payload: unknown,
): Promise<number> {
  const { keys } = ObjectsDeleteJobSchema.parse(payload);
  for (const key of keys) await deps.storage.delete(key);
  deps.logger.info({ objects: keys.length }, "Objetos borrados de S3");
  return keys.length;
}

export interface TrashExpireResult {
  purged: number;
  failed: number;
}

/**
 * Papelera: elimina para siempre lo que lleva 30 días o más. Cada raíz es independiente y se hace
 * en una transacción por workspace (forTenant), igual que al eliminar a mano.
 */
export async function expireTrash(
  deps: Pick<WorkerDeps, "prisma" | "logger"> & { jobs: Jobs },
  payload: unknown,
  now: Date = new Date(),
): Promise<TrashExpireResult> {
  MaintenanceJobSchema.parse(payload ?? {});
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 3600 * 1000);
  const groups = await deps.prisma.node.groupBy({
    by: ["workspaceId", "trashRootId"],
    where: { trashedAt: { lt: cutoff }, trashRootId: { not: null } },
    orderBy: [{ workspaceId: "asc" }, { trashRootId: "asc" }],
    take: 500,
  });
  const result = { purged: 0, failed: 0 };
  for (const group of groups) {
    if (group.trashRootId === null) continue;
    try {
      await purgeTrashRoot(
        forTenant(deps.prisma, group.workspaceId),
        deps.jobs,
        group.trashRootId,
        null,
      );
      result.purged++;
    } catch (error) {
      result.failed++;
      deps.logger.warn({ err: error, rootId: group.trashRootId }, "No se pudo vaciar la papelera");
    }
  }
  deps.logger.info(result, "Papelera vencida");
  return result;
}

export interface UploadsCleanupResult {
  released: number;
  failed: number;
}

/**
 * Reservas de subida vencidas: aborta la subida por partes, borra el objeto (si llegó a subirse)
 * y libera la fila (y con ella la cuota reservada). Cada reserva es independiente: una que falle
 * se reintenta en la próxima corrida.
 */
export async function cleanupExpiredUploads(
  deps: Pick<WorkerDeps, "prisma" | "logger" | "storage">,
  payload: unknown,
  now: Date = new Date(),
): Promise<UploadsCleanupResult> {
  MaintenanceJobSchema.parse(payload ?? {});
  const result = { released: 0, failed: 0 };
  for (;;) {
    const rows = await deps.prisma.uploadReservation.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true, storageKey: true, multipartId: true },
      orderBy: { expiresAt: "asc" },
      take: 100,
    });
    if (rows.length === 0) break;
    let progress = 0;
    for (const row of rows) {
      try {
        if (row.multipartId !== null) {
          await deps.storage.abortMultipart(row.storageKey, row.multipartId);
        }
        await deps.storage.delete(row.storageKey);
        await deps.prisma.uploadReservation.deleteMany({ where: { id: row.id } });
        result.released++;
        progress++;
      } catch (error) {
        result.failed++;
        deps.logger.warn({ err: error, reservationId: row.id }, "No se pudo liberar una subida");
      }
    }
    // Si nada avanzó (el almacenamiento está caído), se corta: reintenta la próxima corrida.
    if (progress === 0) break;
  }
  deps.logger.info(result, "Limpieza de subidas vencidas");
  return result;
}

/** Limpieza horaria (UTC): contadores de rate limit, sesiones y tokens vencidos. */
/**
 * Preventive maintenance (docs/spec/mantenimiento.md, section 5): every company with plans gets the work
 * orders of the ones that are due, on its own day. Each company apart: one failing doesn't stop the rest.
 */
export async function generatePreventive(
  deps: Pick<WorkerDeps, "prisma" | "logger">,
  payload: unknown,
): Promise<number> {
  MaintenanceJobSchema.parse(payload ?? {});
  const groups = await deps.prisma.maintPlan.groupBy({
    by: ["workspaceId"],
    where: { archivedAt: null },
    orderBy: { workspaceId: "asc" },
  });
  let created = 0;
  for (const { workspaceId } of groups) {
    const db = forTenant(deps.prisma, workspaceId);
    try {
      created += await generateDue(
        { db, info: { actorId: "", ip: null, userAgent: null } },
        await companyToday(db),
      );
    } catch (error) {
      deps.logger.error({ err: error, workspaceId }, "Preventivo: no se pudieron generar las OT");
    }
  }
  if (created > 0) deps.logger.info({ created }, "OT preventivas generadas");
  return created;
}

/**
 * Maintenance voice notes (docs/spec/mantenimiento.md, section 3): the audio is deleted after 30 days
 * (the transcript stays), and a report's note never confirmed, after a day. Of every company.
 */
export async function purgeMaintenanceAudio(
  deps: Pick<WorkerDeps, "prisma" | "logger" | "storage">,
  now: Date = new Date(),
): Promise<{ orphans: number; audio: number }> {
  const orphanBefore = new Date(now.getTime() - maintenanceLimits.audioOrphanHours * 3600 * 1000);
  const audioBefore = new Date(
    now.getTime() - maintenanceLimits.audioRetentionDays * 24 * 3600 * 1000,
  );
  const orphans = await deps.prisma.maintRecording.findMany({
    where: { workOrderId: null, createdAt: { lt: orphanBefore } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  for (const row of orphans) if (row.storageKey !== null) await deps.storage.delete(row.storageKey);
  if (orphans.length > 0) {
    await deps.prisma.maintRecording.deleteMany({
      where: { id: { in: orphans.map((row) => row.id) }, workOrderId: null },
    });
  }
  const expired = await deps.prisma.maintRecording.findMany({
    where: { storageKey: { not: null }, createdAt: { lt: audioBefore } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  for (const row of expired) if (row.storageKey !== null) await deps.storage.delete(row.storageKey);
  if (expired.length > 0) {
    await deps.prisma.maintRecording.updateMany({
      where: { id: { in: expired.map((row) => row.id) } },
      data: { storageKey: null },
    });
  }
  return { orphans: orphans.length, audio: expired.length };
}

export async function cleanupExpired(
  deps: Pick<WorkerDeps, "prisma" | "logger" | "systemStorage" | "storage">,
  payload: unknown,
  now: Date = new Date(),
): Promise<CleanupResult> {
  MaintenanceJobSchema.parse(payload ?? {});
  const [buckets, sessions, tokens, ssoFlows] = await deps.prisma.$transaction([
    deps.prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }),
    deps.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    deps.prisma.authToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    // Directory sign-ins (OIDC) never finished, of every company.
    deps.prisma.ssoFlow.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  // Audit rooms: the auditors' expired sessions and codes, of every company.
  await deps.prisma.auditRoomSession.deleteMany({ where: { expiresAt: { lt: now } } });
  await deps.prisma.auditRoomCode.deleteMany({ where: { expiresAt: { lt: now } } });
  await expireExports(deps, now);
  const voiceNotes = await purgeMaintenanceAudio(deps, now);
  if (voiceNotes.orphans + voiceNotes.audio > 0) {
    deps.logger.info(voiceNotes, "Notas de voz de mantenimiento purgadas");
  }
  const result = {
    rateLimitBuckets: buckets.count,
    sessions: sessions.count,
    authTokens: tokens.count,
    ssoFlows: ssoFlows.count,
  };
  deps.logger.info(result, "Limpieza de vencidos");
  return result;
}
