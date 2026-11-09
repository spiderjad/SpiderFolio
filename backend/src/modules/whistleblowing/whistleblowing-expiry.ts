// The answer deadline of a whistleblowing case as a kind of expiry (docs/spec/canal-denuncias.md,
// «Ciclo de vida»): told to the managers who see the case, without its number or content. It keeps
// going while the channel is off: open cases still have to be answered.
import { whistleblowingTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { caseManagers, DEADLINE_EXPIRY } from "./whistleblowing-access.ts";

registerExpiryKind(DEADLINE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.whistleblowingCase.findFirst({
      where: {
        id: expiry.subjectId,
        status: { in: ["RECEIVED", "ADMITTED", "INVESTIGATING"] },
        purgedAt: null,
      },
      select: { id: true },
    });
    if (row === null) return null;
    return {
      what: whistleblowingTexts.deadlineWhat,
      path: `/app/${workspace.slug}/canal/${row.id}`,
    };
  },
  recipients: async (db, expiry) => await caseManagers(db, expiry.subjectId),
});
