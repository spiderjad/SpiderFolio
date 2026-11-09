// The environment module's items as kinds of expiry (docs/spec/medio-ambiente.md): a permit's expiry or
// review, a recurring obligation, a waste manager's authorization and a waste's maximum storage. Told to
// whoever is in charge, or to whoever has environment.manage; paused while the module is off.
import { environmentTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { environmentManagers, environmentSettingsOf } from "./environment-access.ts";
import { OBLIGATION_EXPIRY, PERMIT_EXPIRY } from "./permits.service.ts";
import { CONTRACTOR_EXPIRY, STORAGE_EXPIRY } from "./waste.service.ts";
import { LEAK_CHECK_EXPIRY } from "./cooling.service.ts";

const paused = async (db: Parameters<typeof environmentSettingsOf>[0]) =>
  !(await environmentSettingsOf(db)).enabled;

/** The one in charge (if any) and, without one, everyone who manages the module. */
const recipients = async (
  db: Parameters<typeof environmentManagers>[0],
  responsibleId: string | null,
): Promise<string[]> => (responsibleId !== null ? [responsibleId] : await environmentManagers(db));

registerExpiryKind(PERMIT_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.envPermit.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (row === null) return null;
    return {
      what: environmentTexts.expiry.permit(row.name),
      path: `/app/${workspace.slug}/medio-ambiente/autorizaciones`,
    };
  },
  recipients: async (db, expiry) => await recipients(db, expiry.responsibleId),
  paused,
});

registerExpiryKind(OBLIGATION_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.envObligation.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (row === null) return null;
    return {
      what: environmentTexts.expiry.obligation(row.name),
      path: `/app/${workspace.slug}/medio-ambiente/autorizaciones`,
    };
  },
  recipients: async (db, expiry) => await recipients(db, expiry.responsibleId),
  paused,
});

registerExpiryKind(CONTRACTOR_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.envContractor.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (row === null) return null;
    return {
      what: environmentTexts.expiry.contractor(row.name),
      path: `/app/${workspace.slug}/medio-ambiente/residuos?pestana=gestores`,
    };
  },
  recipients: async (db) => await environmentManagers(db),
  paused,
});

registerExpiryKind(STORAGE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.envWaste.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (row === null) return null;
    return {
      what: environmentTexts.expiry.storage(row.name),
      path: `/app/${workspace.slug}/medio-ambiente/residuos?pestana=catalogo`,
    };
  },
  recipients: async (db) => await environmentManagers(db),
  paused,
});

registerExpiryKind(LEAK_CHECK_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const row = await db.envCoolingUnit.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (row === null) return null;
    return {
      what: environmentTexts.expiry.leakCheck(row.name),
      path: `/app/${workspace.slug}/medio-ambiente/frio`,
    };
  },
  recipients: async (db) => await environmentManagers(db),
  paused,
});
