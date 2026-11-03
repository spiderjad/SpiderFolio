// A file's or a page's expiry as a kind of expiry (docs/spec/vencimientos.md): told at 8:00 to whoever is
// responsible (a person, or the heads and deputies of a department). In the trash it waits; deleted for
// good, it's resolved.
import type { TenantDb } from "../../db/tenant.ts";
import { registerExpiryKind } from "./expiries.service.ts";

export const NODE_EXPIRY = "node";

/** Where a node opens in the app. */
export function nodePath(
  slug: string,
  node: { id: string; type: string; spaceId: string; parentId: string | null },
): string {
  const base = `/app/${slug}/files/${node.spaceId}`;
  if (node.type === "PAGE") return `${base}/p/${node.id}`;
  if (node.type === "FORM") return `${base}/form/${node.id}`;
  return node.parentId === null ? base : `${base}/f/${node.parentId}`;
}

async function nodeOf(db: TenantDb, id: string) {
  return await db.node.findFirst({
    where: { id },
    select: { id: true, name: true, type: true, spaceId: true, parentId: true, trashedAt: true },
  });
}

registerExpiryKind(NODE_EXPIRY, {
  describe: async (db, expiry, workspace) => {
    const node = await nodeOf(db, expiry.subjectId);
    if (node === null) return null;
    return { what: node.name, path: nodePath(workspace.slug, node) };
  },
  waiting: async (db, expiry) => (await nodeOf(db, expiry.subjectId))?.trashedAt != null,
});
