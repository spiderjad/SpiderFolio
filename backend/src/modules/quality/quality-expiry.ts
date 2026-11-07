// A nonconformity's actions and its effectiveness check as kinds of expiry (docs/spec/calidad.md,
// «Avisos»): told to whoever has to do them, by their day; resolved when done.
import { qualityTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { qualitySettingsOf } from "./quality-access.ts";

export const ACTION_EXPIRY = "quality.action";
export const VERIFICATION_EXPIRY = "quality.verification";

const paused = async (db: Parameters<typeof qualitySettingsOf>[0]) =>
  !(await qualitySettingsOf(db)).enabled;

registerExpiryKind(ACTION_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const action = await db.qualityAction.findFirst({
      where: { id: expiry.subjectId, doneAt: null },
      select: { description: true, nc: { select: { year: true, number: true } } },
    });
    if (action === null) return null;
    const text =
      action.description.length > 80 ? `${action.description.slice(0, 79)}…` : action.description;
    const code = qualityTexts.code(action.nc.year, action.nc.number);
    return { what: `${code} · ${text}`, path: `/app/${workspace.slug}/calidad/mis-acciones` };
  },
  paused,
});

registerExpiryKind(VERIFICATION_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const nc = await db.qualityNc.findFirst({
      where: { id: expiry.subjectId, status: "VERIFICATION" },
      select: { id: true, year: true, number: true },
    });
    if (nc === null) return null;
    return {
      what: qualityTexts.verifyWhat(qualityTexts.code(nc.year, nc.number)),
      path: `/app/${workspace.slug}/calidad/no-conformidades/${nc.id}`,
    };
  },
  paused,
});
