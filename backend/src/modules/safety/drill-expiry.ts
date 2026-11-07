// The yearly emergency drill as a kind of expiry (docs/spec/seguridad-salud.md, «Emergencias y
// simulacros»): one per company, due a year after the latest drill, told to whoever manages the module
// (and to the heads of the emergency plan's department, if it has one). With the module off, it waits.
import { safetyTexts } from "../../i18n/index.ts";
import { defaultRecipients, registerExpiryKind } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const DRILL_EXPIRY = "safety.drill";
/** One reminder per company. */
export const DRILL_SUBJECT = "yearly";

registerExpiryKind(DRILL_EXPIRY, {
  describe: (_db, _expiry, workspace) =>
    Promise.resolve({
      what: safetyTexts.drills.expiryWhat,
      path: `/app/${workspace.slug}/seguridad/emergencias/simulacros`,
    }),
  recipients: async (db, expiry) => {
    const managers = await db.membership.findMany({
      where: { status: "ACTIVE", role: { capabilities: { has: "safety.manage" } } },
      select: { id: true },
      take: 50,
    });
    return [
      ...new Set([...managers.map((row) => row.id), ...(await defaultRecipients(db, expiry))]),
    ];
  },
  paused: async (db) => !(await safetySettingsOf(db)).enabled,
});
