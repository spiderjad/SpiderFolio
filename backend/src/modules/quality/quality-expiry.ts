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

export const AUDIT_EXPIRY = "quality.audit";

registerExpiryKind(AUDIT_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const audit = await db.qualityAudit.findFirst({
      where: { id: expiry.subjectId, status: "PLANNED" },
      select: { id: true, title: true },
    });
    if (audit === null) return null;
    return {
      what: qualityTexts.auditWhat(audit.title),
      path: `/app/${workspace.slug}/calidad/auditorias/${audit.id}`,
    };
  },
  paused,
});

export const SUPPLIER_DOC_EXPIRY = "quality.supplier_doc";
export const SUPPLIER_REVIEW_EXPIRY = "quality.supplier_review";

registerExpiryKind(SUPPLIER_DOC_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const doc = await db.qualitySupplierDoc.findFirst({
      where: { id: expiry.subjectId, archivedAt: null, supplier: { archivedAt: null } },
      select: { name: true, supplier: { select: { id: true, name: true } } },
    });
    if (doc === null) return null;
    return {
      what: qualityTexts.supplierDocWhat(doc.supplier.name, doc.name),
      path: `/app/${workspace.slug}/calidad/proveedores/${doc.supplier.id}`,
    };
  },
  paused,
});

registerExpiryKind(SUPPLIER_REVIEW_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const supplier = await db.qualitySupplier.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (supplier === null) return null;
    return {
      what: qualityTexts.supplierReviewWhat(supplier.name),
      path: `/app/${workspace.slug}/calidad/proveedores/${supplier.id}`,
    };
  },
  paused,
});

export const COMPLAINT_EXPIRY = "quality.complaint";
export const RECALL_TEST_EXPIRY = "quality.recall_test";

registerExpiryKind(COMPLAINT_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const complaint = await db.qualityComplaint.findFirst({
      where: { id: expiry.subjectId, status: "OPEN" },
      select: { id: true, from: true, product: true },
    });
    if (complaint === null) return null;
    return {
      what: qualityTexts.complaintWhat(complaint.from, complaint.product),
      path: `/app/${workspace.slug}/calidad/reclamaciones/${complaint.id}`,
    };
  },
  paused,
});

registerExpiryKind(RECALL_TEST_EXPIRY, {
  describe: (_db, _expiry, workspace) =>
    Promise.resolve({
      what: qualityTexts.recallWhat,
      path: `/app/${workspace.slug}/calidad/crisis`,
    }),
  paused,
});

export const PRP_EXPIRY = "quality.prp";

registerExpiryKind(PRP_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const prp = await db.qualityPrp.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (prp === null) return null;
    return {
      what: qualityTexts.prpWhat(prp.name),
      path: `/app/${workspace.slug}/calidad/prerrequisitos`,
    };
  },
  paused,
});

export const SAMPLING_EXPIRY = "quality.sampling";

registerExpiryKind(SAMPLING_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const point = await db.qualitySamplingPoint.findFirst({
      where: { id: expiry.subjectId, archivedAt: null },
      select: { name: true },
    });
    if (point === null) return null;
    return {
      what: qualityTexts.samplingWhat(point.name),
      path: `/app/${workspace.slug}/calidad/plan-analitico`,
    };
  },
  paused,
});

export const CULTURE_EXPIRY = "quality.culture";

registerExpiryKind(CULTURE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const activity = await db.qualityCultureActivity.findFirst({
      where: { id: expiry.subjectId, archivedAt: null, doneOn: null },
      select: { title: true, year: true },
    });
    if (activity === null) return null;
    return {
      what: qualityTexts.cultureWhat(activity.title),
      path: `/app/${workspace.slug}/calidad/cultura?anio=${String(activity.year)}`,
    };
  },
  paused,
});

export const CHANGE_EXPIRY = "quality.change";

registerExpiryKind(CHANGE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const change = await db.qualityChange.findFirst({
      where: { id: expiry.subjectId, status: "APPROVED" },
      select: { id: true, year: true, number: true, title: true },
    });
    if (change === null) return null;
    return {
      what: qualityTexts.changeWhat(qualityTexts.changeCode(change.year, change.number), change.title),
      path: `/app/${workspace.slug}/calidad/cambios/${change.id}`,
    };
  },
  paused,
});
