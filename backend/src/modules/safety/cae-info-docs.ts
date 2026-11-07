// The site's information for contractors (docs/spec/cae.md, «Información»; RD 171/2004, arts. 7 to 9):
// the controlled documents the company chose (settings.safety.cae.infoNodeIds), in their version in
// force. A contractor has it once each of them was handed to it in that version.
import type { AdminContext } from "../admin/admin-context.ts";
import { safetySettingsOf } from "./safety-access.ts";

export interface InfoDocument {
  nodeId: string;
  code: string;
  title: string;
  /** The version in force. */
  version: number;
}

/** «nodeId@version»: what a delivery records of each document. */
export const infoKey = (doc: { nodeId: string; version: number }): string =>
  `${doc.nodeId}@${String(doc.version)}`;

/** The chosen documents still in force (in the chosen order); trashed or withdrawn ones drop out. */
export async function currentInfoDocuments(
  ctx: Pick<AdminContext, "db">,
  nodeIds?: readonly string[],
): Promise<InfoDocument[]> {
  const ids = nodeIds ?? (await safetySettingsOf(ctx.db)).cae.infoNodeIds;
  if (ids.length === 0) return [];
  const controlled = await ctx.db.controlledDocument.findMany({
    where: {
      nodeId: { in: [...ids] },
      publishedVersion: { not: null },
      node: { trashedAt: null },
    },
    select: { nodeId: true, code: true, publishedVersion: true },
  });
  const versions = await ctx.db.documentVersion.findMany({
    where: {
      OR: controlled.map((doc) => ({ nodeId: doc.nodeId, version: doc.publishedVersion ?? 0 })),
    },
    select: { nodeId: true, title: true },
  });
  const titleOf = new Map(versions.map((version) => [version.nodeId, version.title]));
  const byNode = new Map(controlled.map((doc) => [doc.nodeId, doc]));
  return ids.flatMap((id) => {
    const doc = byNode.get(id);
    return doc === undefined || doc.publishedVersion === null
      ? []
      : [
          {
            nodeId: doc.nodeId,
            code: doc.code,
            title: titleOf.get(doc.nodeId) ?? doc.code,
            version: doc.publishedVersion,
          },
        ];
  });
}

/** The documents a contractor has to have received to be authorized ([] when it's not required). */
export async function requiredInfoDocuments(
  ctx: Pick<AdminContext, "db">,
): Promise<InfoDocument[]> {
  const settings = await safetySettingsOf(ctx.db);
  if (!settings.cae.infoRequired) return [];
  return await currentInfoDocuments(ctx, settings.cae.infoNodeIds);
}

/** For each company, the required documents it hasn't received in their version in force. */
export async function missingInfo(
  ctx: Pick<AdminContext, "db">,
  companyIds: readonly string[],
  documents: readonly InfoDocument[],
): Promise<Map<string, InfoDocument[]>> {
  if (documents.length === 0 || companyIds.length === 0) return new Map();
  const deliveries = await ctx.db.caeInfoDelivery.findMany({
    where: {
      companyId: { in: [...companyIds] },
      deliveredKeys: { hasSome: documents.map(infoKey) },
    },
    select: { companyId: true, deliveredKeys: true },
  });
  const given = new Map<string, Set<string>>();
  for (const delivery of deliveries) {
    const keys = given.get(delivery.companyId) ?? new Set<string>();
    for (const key of delivery.deliveredKeys) keys.add(key);
    given.set(delivery.companyId, keys);
  }
  return new Map(
    companyIds.map((id) => [
      id,
      documents.filter((doc) => !(given.get(id)?.has(infoKey(doc)) ?? false)),
    ]),
  );
}
