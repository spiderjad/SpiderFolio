// Expiry notices (docs/spec/seguridad-salud.md, «Motor de vencimientos»): an hourly job that only takes
// the companies where it's 8:00 now. Each unresolved expiry that reached a notice threshold not yet
// notified gives one «expiry_due» notice (bell and email) to the recipients of its kind; the thresholds
// reached are marked as sent. Once per person and threshold (dedupeKey), so a rerun repeats nothing.
import type { Logger } from "pino";
import { forTenant } from "../../db/tenant.ts";
import type { Jobs } from "../../jobs/boss.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { dayIn, localHour, zoneOf } from "../../lib/time-zone.ts";
import { dayOf, defaultRecipients, expiryKindOf } from "./expiries.service.ts";
import { daysUntil, noticeFor } from "./expiry-rules.ts";
import "./kinds.ts";

const NOTICE_HOUR = 8;
const BATCH = 500;
/** Expiries further away than this never reach a threshold (notice days go up to 365). */
const HORIZON_DAYS = 366;

export async function sendExpiryNotices(
  deps: { prisma: PrismaClient; logger: Logger; jobs: Pick<Jobs, "enqueue"> },
  now: Date = new Date(),
  /** By hand or in tests: every company, whatever the hour there. */
  options: { anyHour?: boolean } = {},
): Promise<{ notified: number }> {
  let notified = 0;
  const workspaces = await deps.prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, settings: true },
  });
  for (const workspace of workspaces) {
    const zone = zoneOf(workspace.settings);
    if (options.anyHour !== true && localHour(now, zone) !== NOTICE_HOUR) continue;
    const today = dayIn(now, zone);
    const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + HORIZON_DAYS * 86_400_000);
    const db = forTenant(deps.prisma, workspace.id);
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.expiry.findMany({
        where: { resolvedAt: null, dueOn: { lte: horizon } },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (rows.length === 0) break;
      cursor = rows.at(-1)?.id;
      for (const expiry of rows) {
        const kind = expiryKindOf(expiry.kind);
        if (kind === undefined || (await kind.paused?.(db)) === true) continue;
        const left = daysUntil(today, dayOf(expiry.dueOn));
        const notice = noticeFor(left, expiry.noticeDays, expiry.noticesSent);
        if (!notice.notify) continue;
        const described = await kind.describe(db, expiry, { slug: workspace.slug });
        if (described === null) {
          await db.expiry.update({ where: { id: expiry.id }, data: { resolvedAt: now } });
          continue;
        }
        const wanted = await (kind.recipients?.(db, expiry) ?? defaultRecipients(expiry));
        const active = await db.membership.findMany({
          where: { id: { in: [...new Set(wanted)] }, status: "ACTIVE" },
          select: { id: true },
        });
        // The smallest threshold reached names the notice: the same day is told only once.
        const threshold = Math.min(...notice.sent.filter((days) => left <= days));
        for (const { id: membershipId } of active) {
          const dedupeKey = `expiry:${expiry.id}:${dayOf(expiry.dueOn)}:${String(threshold)}`;
          const seen = await db.notification.count({ where: { membershipId, dedupeKey } });
          if (seen > 0) continue;
          const created = await db.notification.create({
            data: {
              membershipId,
              kind: "expiry_due",
              expiryId: expiry.id,
              expiresAt: expiry.dueOn,
              detail: String(left),
              dedupeKey,
            },
            select: { id: true },
          });
          await deps.jobs.enqueue("email-send", {
            kind: "expiry-notice",
            notificationId: created.id,
          });
          notified += 1;
        }
        await db.expiry.update({
          where: { id: expiry.id },
          data: { noticesSent: notice.sent },
        });
      }
      if (rows.length < BATCH) break;
    }
  }
  deps.logger.info({ notified }, "Avisos de vencimientos");
  return { notified };
}
