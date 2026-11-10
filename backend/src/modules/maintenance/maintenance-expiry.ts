// A planned work order's due date as a kind of expiry (docs/spec/mantenimiento.md, section 2): told to
// whoever it's assigned to; paused while the module is off.
import { maintenanceTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { maintenanceSettingsOf } from "./maintenance-access.ts";
import { WORK_ORDER_EXPIRY } from "./work-orders.service.ts";

registerExpiryKind(WORK_ORDER_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.maintWorkOrder.findFirst({
      where: {
        id: expiry.subjectId,
        status: { in: ["REPORTED", "PLANNED", "IN_PROGRESS", "ON_HOLD"] },
      },
      select: { id: true, year: true, number: true, title: true },
    });
    if (row === null) return null;
    return {
      what: maintenanceTexts.expiry(maintenanceTexts.code(row.year, row.number), row.title),
      path: `/app/${workspace.slug}/mantenimiento/ot/${row.id}`,
    };
  },
  paused: async (db) => !(await maintenanceSettingsOf(db)).enabled,
});
