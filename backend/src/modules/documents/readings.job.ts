// Recordatorios de lectura: un job por hora en UTC que actúa solo en los workspaces donde en ese
// momento son las 8:00 según su zona horaria (nunca un cron por workspace). A cada persona que debe
// leer y no confirmó: aviso a 3 días del plazo, el día del plazo y uno por semana desde ahí. A los 7
// días de vencido, aviso también al jefe del departamento de la persona. Cada aviso sale una sola
// vez (dedupeKey), así el job puede repetirse sin duplicar.
import type { Logger } from "pino";
import { forTenant, type TenantDb } from "../../db/tenant.ts";
import type { Jobs } from "../../jobs/boss.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { localHour, zoneOf } from "../../lib/time-zone.ts";
import { createDocumentNotices } from "../notifications/notifications.service.ts";
import { expandRequirements, whoCanSee } from "./readings.core.ts";

const DAY = 24 * 60 * 60 * 1000;
const REMINDER_HOUR = 8;

/** Manda un aviso una sola vez por persona y clave. */
async function once(
  db: TenantDb,
  jobs: Pick<Jobs, "enqueue">,
  input: Parameters<typeof createDocumentNotices>[2] & { dedupeKey: string },
): Promise<number> {
  const [recipient] = input.recipients;
  if (recipient === undefined) return 0;
  const sent = await db.notification.findFirst({
    where: { membershipId: recipient, dedupeKey: input.dedupeKey },
    select: { id: true },
  });
  if (sent !== null) return 0;
  await createDocumentNotices(db, jobs, input);
  return 1;
}

export async function sendReadingReminders(
  deps: { prisma: PrismaClient; logger: Logger; jobs: Pick<Jobs, "enqueue"> },
  now: Date = new Date(),
): Promise<{ sent: number }> {
  let sent = 0;
  const workspaces = await deps.prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, settings: true },
  });
  for (const workspace of workspaces) {
    if (localHour(now, zoneOf(workspace.settings)) !== REMINDER_HOUR) continue;
    const db = forTenant(deps.prisma, workspace.id);
    const documents = await db.controlledDocument.findMany({
      where: { publishedVersion: { not: null } },
      select: { nodeId: true, publishedVersion: true },
    });
    for (const document of documents) {
      if (document.publishedVersion === null) continue;
      const version = document.publishedVersion;
      const requirements = await db.readRequirement.findMany({
        where: { nodeId: document.nodeId, version, dueAt: { not: null } },
      });
      if (requirements.length === 0) continue;
      const required = await expandRequirements(db, requirements);
      const acks = new Set(
        (
          await db.readAcknowledgment.findMany({
            where: { nodeId: document.nodeId, version },
            select: { membershipId: true },
          })
        ).map((ack) => ack.membershipId),
      );
      const pending = [...required.values()].filter(
        (person) => person.dueAt !== null && !acks.has(person.membershipId),
      );
      const visible = await whoCanSee(
        db,
        document.nodeId,
        pending.map((person) => person.membershipId),
      );
      for (const person of pending) {
        if (person.dueAt === null || !visible.has(person.membershipId)) continue;
        const untilDue = Math.ceil((person.dueAt.getTime() - now.getTime()) / DAY);
        const overdueDays = Math.floor((now.getTime() - person.dueAt.getTime()) / DAY);
        const base = { actorId: null, nodeId: document.nodeId, version, dueAt: person.dueAt };
        // 3 días antes, el día del plazo y, vencido, una vez por semana.
        const key =
          untilDue > 3
            ? null
            : untilDue > 0
              ? "3d"
              : overdueDays >= 7
                ? `wk${String(Math.floor(overdueDays / 7))}`
                : "due";
        if (key !== null) {
          sent += await once(db, deps.jobs, {
            ...base,
            kind: "reading_reminder",
            recipients: [person.membershipId],
            dedupeKey: `rd:${document.nodeId}:${String(version)}:${key}`,
          });
        }
        // A los 7 días de vencido, al jefe del departamento de la persona.
        if (overdueDays >= 7) {
          const own = await db.departmentMember.findMany({
            where: { membershipId: person.membershipId },
            select: { departmentId: true },
          });
          const heads = await db.departmentMember.findMany({
            where: {
              departmentId: { in: own.map((d) => d.departmentId) },
              position: "HEAD",
              membership: { status: "ACTIVE" },
            },
            select: { membershipId: true },
          });
          for (const head of new Set(heads.map((h) => h.membershipId))) {
            sent += await once(db, deps.jobs, {
              ...base,
              kind: "reading_overdue_leader",
              actorId: person.membershipId,
              recipients: [head],
              dedupeKey: `rd:${document.nodeId}:${String(version)}:head7:${person.membershipId}`,
            });
          }
        }
      }
    }
  }
  deps.logger.info({ sent }, "Recordatorios de lectura");
  return { sent };
}
