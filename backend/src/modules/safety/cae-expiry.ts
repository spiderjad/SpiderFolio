// A contractor's accepted document that expires (docs/spec/cae.md, «Modelo»): a kind of expiry told to
// the company's internal responsible person. With CAE or the module off it waits; once a newer one is
// accepted, or the company, worker or requirement is archived, it no longer applies.
import type { TenantDb } from "../../db/tenant.ts";
import { caeTexts } from "../../i18n/index.ts";
import { registerExpiryKind } from "../expiries/expiries.service.ts";
import { caeEnabled } from "../workspaces/settings.ts";
import { safetySettingsOf } from "./safety-access.ts";

export const CAE_DOCUMENT_EXPIRY = "cae.document";

async function currentDocument(db: TenantDb, id: string) {
  return await db.caeDocument.findFirst({
    where: {
      id,
      status: "ACCEPTED",
      supersededAt: null,
      company: { archivedAt: null },
      requirement: { archivedAt: null },
    },
    select: {
      requirement: { select: { name: true } },
      company: { select: { id: true, name: true, responsibleId: true } },
      worker: { select: { id: true, name: true, archivedAt: true } },
    },
  });
}

registerExpiryKind(CAE_DOCUMENT_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const doc = await currentDocument(db, expiry.subjectId);
    if (doc === null || (doc.worker !== null && doc.worker.archivedAt !== null)) return null;
    const base = `/app/${workspace.slug}/seguridad/cae`;
    return doc.worker === null
      ? {
          what: caeTexts.expiryWhat(doc.requirement.name, doc.company.name),
          path: `${base}/empresas/${doc.company.id}`,
        }
      : {
          what: caeTexts.expiryWhat(
            doc.requirement.name,
            caeTexts.workerOf(doc.worker.name, doc.company.name),
          ),
          path: `${base}/trabajadores/${doc.worker.id}`,
        };
  },
  // The company's responsible person now, even if it changed after the document was accepted.
  recipients: async (db, expiry) => {
    const doc = await currentDocument(db, expiry.subjectId);
    return doc === null ? [] : [doc.company.responsibleId];
  },
  paused: async (db) => !caeEnabled(await safetySettingsOf(db)),
});
