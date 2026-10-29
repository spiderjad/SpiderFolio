// When a plugin that signed people in stops being active (license expired or removed), its sync stops
// with it: people who leave the directory are no longer suspended on their own. The owners of each
// company with linked members get a bell notice, once per license.
import { forTenant } from "../../db/tenant.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { PluginRuntime } from "../../plugins/runtime.ts";

export async function notifyStoppedDirectories(
  prisma: PrismaClient,
  plugins: PluginRuntime,
): Promise<number> {
  const signIn = new Set(
    plugins.installed
      .filter((plugin) => (plugin.backend?.authProviders ?? []).length > 0)
      .map((plugin) => plugin.manifest.id),
  );
  if (signIn.size === 0) return 0;
  const linked = await prisma.externalIdentity.groupBy({
    by: ["workspaceId", "pluginId"],
    where: { pluginId: { in: [...signIn] }, workspace: { deletedAt: null } },
  });
  let created = 0;
  for (const { workspaceId, pluginId } of linked) {
    if (await plugins.isActive(workspaceId, pluginId)) continue;
    const status = await plugins.licenseStatus(workspaceId);
    const license =
      status.state === "valid" || status.state === "expired" ? status.payload.id : "none";
    const db = forTenant(prisma, workspaceId);
    const owners = await db.membership.findMany({
      where: { status: "ACTIVE", role: { base: "OWNER" } },
      select: { id: true },
    });
    if (owners.length === 0) continue;
    const result = await db.notification.createMany({
      data: owners.map((owner) => ({
        membershipId: owner.id,
        kind: "directory_sync_stopped",
        detail: pluginId,
        dedupeKey: `directory_sync_stopped:${pluginId}:${license}`,
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }
  return created;
}
