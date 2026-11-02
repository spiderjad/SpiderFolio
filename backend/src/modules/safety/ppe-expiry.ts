// PPE replacement as a kind of expiry (docs/spec/seguridad-salud.md, «EPIs»): one per handout line with
// a life. It's told to the person and to whoever handed it out; with the module off, it waits.
import { safetyTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const PPE_EXPIRY = "safety.ppe";

registerExpiryKind(PPE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const line = await db.safetyDeliveryLine.findFirst({
      where: { id: expiry.subjectId, delivery: { voidedAt: null } },
      select: { item: { select: { name: true } }, delivery: { select: { membershipId: true } } },
    });
    if (line === null) return null;
    const person = await db.membership.findFirst({
      where: { id: line.delivery.membershipId },
      select: { user: { select: { name: true } } },
    });
    return {
      what: safetyTexts.expiryWhat(line.item.name, person?.user.name ?? ""),
      path: `/app/${workspace.slug}/seguridad/personas/${line.delivery.membershipId}`,
    };
  },
  paused: async (db) => !(await safetySettingsOf(db)).enabled,
});
