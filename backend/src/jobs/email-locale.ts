// Idioma de cada email: el del destinatario o, si no eligió uno, el de su empresa
// (docs/spec/i18n.md). Una invitación a quien todavía no tiene cuenta va en el de la empresa.
import { DEFAULT_LOCALE, localeFor, readWorkspaceLocale, type Locale } from "../i18n/locales.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import type { EmailJob } from "./queues.ts";

async function ofUser(
  prisma: PrismaClient,
  userId: string | undefined,
  workspaceId?: string,
): Promise<Locale> {
  if (userId === undefined) return DEFAULT_LOCALE;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      locale: true,
      memberships: {
        where: { status: "ACTIVE", ...(workspaceId === undefined ? {} : { workspaceId }) },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { workspace: { select: { settings: true } } },
      },
    },
  });
  if (user === null) return DEFAULT_LOCALE;
  return localeFor(user.locale, user.memberships[0]?.workspace.settings);
}

async function ofMembership(prisma: PrismaClient, membershipId: string | null): Promise<Locale> {
  if (membershipId === null) return DEFAULT_LOCALE;
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { user: { select: { locale: true } }, workspace: { select: { settings: true } } },
  });
  return membership === null
    ? DEFAULT_LOCALE
    : localeFor(membership.user.locale, membership.workspace.settings);
}

export async function emailLocale(prisma: PrismaClient, job: EmailJob): Promise<Locale> {
  switch (job.kind) {
    case "invitation": {
      const invitation = await prisma.invitation.findUnique({
        where: { id: job.invitationId },
        select: { email: true, workspace: { select: { settings: true } } },
      });
      if (invitation === null) return DEFAULT_LOCALE;
      const user = await prisma.user.findUnique({
        where: { email: invitation.email },
        select: { locale: true },
      });
      return localeFor(user?.locale, invitation.workspace.settings);
    }
    case "mention": {
      const mention = await prisma.mention.findUnique({
        where: { id: job.mentionId },
        select: { mentionedId: true },
      });
      return ofMembership(prisma, mention?.mentionedId ?? null);
    }
    case "shared": {
      const permission = await prisma.permission.findUnique({
        where: { id: job.permissionId },
        select: { membershipId: true },
      });
      return ofMembership(prisma, permission?.membershipId ?? null);
    }
    case "document-notice": {
      const notice = await prisma.notification.findUnique({
        where: { id: job.notificationId },
        select: { membershipId: true },
      });
      return ofMembership(prisma, notice?.membershipId ?? null);
    }
    case "export-ready":
    case "export-failed": {
      const zip = await prisma.zipExport.findUnique({
        where: { id: job.exportId },
        select: { membershipId: true },
      });
      return ofMembership(prisma, zip?.membershipId ?? null);
    }
    case "mfa-reset":
      return ofUser(prisma, job.userId, job.workspaceId);
    default:
      return ofUser(prisma, job.userId);
  }
}

/** Idioma de los textos de una empresa sin destinatario concreto (PDF controlado). */
export async function workspaceLocale(prisma: PrismaClient, workspaceId: string): Promise<Locale> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });
  return readWorkspaceLocale(workspace?.settings);
}
