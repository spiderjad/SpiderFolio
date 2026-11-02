// Risk assessment reviews as a kind of expiry (docs/spec/seguridad-salud.md, «Formación y evaluaciones»):
// publishing a controlled document of the EVR type sets its review day; the heads and deputies of its
// owner department are told (or whoever made it, without a department). A new publication moves it.
import type { TenantDb } from "../../db/tenant.ts";
import { dayIn } from "../../lib/time-zone.ts";
import { registerExpiryKind, setExpiry } from "../expiries/expiries.service.ts";
import { safetySettingsOf } from "./safety-access.ts";

/** The risk assessment document type (safety.service.ts creates it). */
const RISK_ASSESSMENT_TYPE = "EVR";

export const REVIEW_EXPIRY = "safety.review";

/** After publishing: an EVR's review day becomes an expiry (other types: nothing). */
export async function scheduleReview(
  db: TenantDb,
  document: { nodeId: string; docType: string },
  reviewDueAt: Date,
  zone: string,
): Promise<void> {
  if (document.docType !== RISK_ASSESSMENT_TYPE) return;
  await setExpiry(db, {
    kind: REVIEW_EXPIRY,
    subjectId: document.nodeId,
    dueOn: dayIn(reviewDueAt, zone),
  });
}

registerExpiryKind(REVIEW_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const document = await db.controlledDocument.findFirst({
      where: { nodeId: expiry.subjectId, node: { trashedAt: null } },
      select: {
        code: true,
        node: { select: { name: true, spaceId: true, type: true, parentId: true } },
      },
    });
    if (document === null) return null;
    const base = `/app/${workspace.slug}/files/${document.node.spaceId}`;
    return {
      what: `${document.code} ${document.node.name}`,
      path:
        document.node.type === "PAGE"
          ? `${base}/p/${expiry.subjectId}`
          : document.node.parentId === null
            ? base
            : `${base}/f/${document.node.parentId}`,
    };
  },
  recipients: async (db, expiry) => {
    const document = await db.controlledDocument.findFirst({
      where: { nodeId: expiry.subjectId },
      select: { ownerDepartmentId: true, createdById: true },
    });
    if (document === null) return [];
    if (document.ownerDepartmentId === null) return [document.createdById];
    const leaders = await db.departmentMember.findMany({
      where: { departmentId: document.ownerDepartmentId, position: { in: ["HEAD", "DEPUTY"] } },
      select: { membershipId: true },
    });
    return leaders.length === 0 ? [document.createdById] : leaders.map((row) => row.membershipId);
  },
  paused: async (db) => !(await safetySettingsOf(db)).enabled,
});
