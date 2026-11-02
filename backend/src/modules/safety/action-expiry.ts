// An incident's corrective measure as a kind of expiry (docs/spec/seguridad-salud.md, «Accidentes e
// incidentes»): told to whoever has to do it, by its day; resolved when it's done. It names only the
// measure, never the incident (health data): the person opens their measures.
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const ACTION_EXPIRY = "safety.action";

registerExpiryKind(ACTION_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const action = await db.safetyAction.findFirst({
      where: { id: expiry.subjectId, doneAt: null },
      select: { description: true },
    });
    if (action === null) return null;
    const what =
      action.description.length > 90 ? `${action.description.slice(0, 89)}…` : action.description;
    return { what, path: `/app/${workspace.slug}/seguridad/medidas` };
  },
  paused: async (db) => !(await safetySettingsOf(db)).enabled,
});
