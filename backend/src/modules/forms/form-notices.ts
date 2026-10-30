// A form's notices (docs/spec/formularios.md, phase 3), in the bell and by email:
//   form_nonconforming  a record with something non-conforming, to whoever is in charge (not to whoever
//                       sent it); `detail` = the record.
//   form_due            a periodic form's period starts today, to the people who fill it in;
//                       `detail` = the period.
//   form_overdue        the previous period ended without a record, to whoever is in charge;
//                       `detail` = the period.
// The periodic ones go out at 8:00 in each company's zone (an hourly job that only takes the companies
// where it's 8 now), once per person and period.
import type { Logger } from "pino";
import { forTenant, type TenantDb } from "../../db/tenant.ts";
import type { Jobs } from "../../jobs/boss.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { dayIn, localHour, zoneOf } from "../../lib/time-zone.ts";
import { periodOf, periodStart, previousPeriod, startsOn } from "./periods.ts";
import { assigneesOf, responsiblesOf, scheduleOf, settingsRow } from "./settings.service.ts";

const NOTICE_HOUR = 8;

type FormNoticeKind = "form_nonconforming" | "form_due" | "form_overdue";

async function notify(
  db: TenantDb,
  jobs: Pick<Jobs, "enqueue">,
  input: {
    kind: FormNoticeKind;
    recipients: readonly string[];
    nodeId: string;
    actorId?: string;
    detail: string;
    version?: number;
    dedupeKey?: string;
  },
): Promise<number> {
  let sent = 0;
  for (const membershipId of new Set(input.recipients)) {
    if (input.dedupeKey !== undefined) {
      const seen = await db.notification.count({
        where: { membershipId, dedupeKey: input.dedupeKey },
      });
      if (seen > 0) continue;
    }
    const created = await db.notification.create({
      data: {
        membershipId,
        kind: input.kind,
        nodeId: input.nodeId,
        detail: input.detail,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.version === undefined ? {} : { version: input.version }),
        ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      },
      select: { id: true },
    });
    await jobs.enqueue("email-send", { kind: "form-notice", notificationId: created.id });
    sent += 1;
  }
  return sent;
}

/** A record with something non-conforming: whoever is in charge is told (never the sender). */
export async function notifyNonConforming(
  db: TenantDb,
  jobs: Pick<Jobs, "enqueue">,
  record: { id: string; nodeId: string; version: number; submittedById: string },
): Promise<number> {
  const recipients = (await responsiblesOf(db, record.nodeId)).filter(
    (id) => id !== record.submittedById,
  );
  return await notify(db, jobs, {
    kind: "form_nonconforming",
    recipients,
    nodeId: record.nodeId,
    actorId: record.submittedById,
    detail: record.id,
    version: record.version,
  });
}

/** Whether a period already has a record (one that wasn't voided). */
export async function periodDone(
  db: TenantDb,
  nodeId: string,
  periodKey: string,
): Promise<boolean> {
  return (await db.formRecord.count({ where: { nodeId, periodKey, voidedAt: null } })) > 0;
}

/**
 * Hourly: in the companies where it's 8:00, the periods that start today (to the people who fill them
 * in) and the ones that ended yesterday or before without a record (to whoever is in charge).
 */
export async function sendFormReminders(
  deps: { prisma: PrismaClient; logger: Logger; jobs: Pick<Jobs, "enqueue"> },
  now: Date = new Date(),
): Promise<{ due: number; overdue: number }> {
  let due = 0;
  let overdue = 0;
  const workspaces = await deps.prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, settings: true },
  });
  for (const workspace of workspaces) {
    const zone = zoneOf(workspace.settings);
    if (localHour(now, zone) !== NOTICE_HOUR) continue;
    const today = dayIn(now, zone);
    const db = forTenant(deps.prisma, workspace.id);
    const forms = await db.formSettings.findMany({
      where: { frequency: { not: "none" }, node: { trashedAt: null } },
      select: { nodeId: true, updatedAt: true },
      take: 2000,
    });
    for (const { nodeId, updatedAt } of forms) {
      const settings = await settingsRow(db, nodeId);
      const schedule = scheduleOf(settings);
      const current = periodOf(schedule, today);
      if (
        current !== null &&
        startsOn(schedule, today) &&
        !(await periodDone(db, nodeId, current))
      ) {
        due += await notify(db, deps.jobs, {
          kind: "form_due",
          recipients: await assigneesOf(db, nodeId, settings),
          nodeId,
          detail: current,
          dedupeKey: `form-due:${nodeId}:${current}`,
        });
      }
      // Only periods since the form runs this way: changing it doesn't make old periods overdue.
      const previous = previousPeriod(schedule, today);
      if (
        previous !== null &&
        periodStart(schedule, previous) >= dayIn(updatedAt, zone) &&
        !(await periodDone(db, nodeId, previous))
      ) {
        overdue += await notify(db, deps.jobs, {
          kind: "form_overdue",
          recipients: await responsiblesOf(db, nodeId),
          nodeId,
          detail: previous,
          dedupeKey: `form-overdue:${nodeId}:${previous}`,
        });
      }
    }
  }
  deps.logger.info({ due, overdue }, "Avisos de formularios periódicos");
  return { due, overdue };
}
