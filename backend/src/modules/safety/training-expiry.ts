// A training record that expires as a kind of expiry (docs/spec/seguridad-salud.md): told to the person,
// who does it again; a new record of the same course resolves it.
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const TRAINING_EXPIRY = "safety.training";

registerExpiryKind(TRAINING_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const training = await db.safetyTraining.findFirst({
      where: { id: expiry.subjectId },
      select: { course: { select: { id: true, nodeId: true } } },
    });
    if (training === null) return null;
    const document = await db.controlledDocument.findFirst({
      where: { nodeId: training.course.nodeId, node: { trashedAt: null } },
      select: { code: true, node: { select: { name: true } } },
    });
    if (document === null) return null;
    return {
      what: `${document.code} ${document.node.name}`,
      path: `/app/${workspace.slug}/seguridad/formacion/${training.course.id}`,
    };
  },
  paused: async (db) => !(await safetySettingsOf(db)).enabled,
});
