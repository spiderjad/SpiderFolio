// The committee's reminders as kinds of expiry (docs/spec/seguridad-salud.md, «Consulta y
// participación»): the end of a delegate's term (one per committee member) and the next ordinary
// meeting, three months after the last one (one per company). Told to whoever manages the module; with
// the module off, they wait.
import { safetyTexts } from "../../i18n/index.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const MANDATE_EXPIRY = "safety.mandate";
export const MEETING_EXPIRY = "safety.meeting";
/** One meeting reminder per company. */
export const MEETING_SUBJECT = "quarterly";

async function managers(db: TenantDb): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { status: "ACTIVE", role: { capabilities: { has: "safety.manage" } } },
    select: { id: true },
    take: 50,
  });
  return rows.map((row) => row.id);
}

const paused = async (db: TenantDb) => !(await safetySettingsOf(db)).enabled;

registerExpiryKind(MANDATE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const member = await db.safetyCommitteeMember.findFirst({
      where: { id: expiry.subjectId, endedAt: null },
      select: { membershipId: true },
    });
    if (member === null) return null;
    const person = await db.membership.findFirst({
      where: { id: member.membershipId },
      select: { user: { select: { name: true } } },
    });
    return {
      what: safetyTexts.committee.mandateWhat(person?.user.name ?? ""),
      path: `/app/${workspace.slug}/seguridad/comite`,
    };
  },
  recipients: managers,
  paused,
});

registerExpiryKind(MEETING_EXPIRY, {
  describe: (_db, _expiry, workspace) =>
    Promise.resolve({
      what: safetyTexts.committee.meetingWhat,
      path: `/app/${workspace.slug}/seguridad/comite/reuniones`,
    }),
  recipients: managers,
  paused,
});
