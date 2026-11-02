// Fitness for work that expires as a kind of expiry (docs/spec/seguridad-salud.md): told to the person
// and to whoever recorded it. It names only the person, never the status (health data).
import { safetyTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const FITNESS_EXPIRY = "safety.fitness";

registerExpiryKind(FITNESS_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.safetyFitness.findFirst({
      where: { id: expiry.subjectId },
      select: { membershipId: true },
    });
    if (row === null) return null;
    const person = await db.membership.findFirst({
      where: { id: row.membershipId },
      select: { user: { select: { name: true } } },
    });
    return {
      what: safetyTexts.fitnessWhat(person?.user.name ?? ""),
      path: `/app/${workspace.slug}/seguridad/personas/${row.membershipId}`,
    };
  },
  paused: async (db) => !(await safetySettingsOf(db)).enabled,
});
