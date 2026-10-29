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
    plugins.installed.flatMap((plugin) =>
      (plugin.backend?.authProviders ?? []).map(
        (provider) => provider.sharedWith ?? plugin.manifest.id,
      ),
    ),
  );
  if (signIn.size === 0) return 0;
  const linked = await prisma.externalIdentity.groupBy({
    by: ["workspaceId", "pluginId"],
    where: { pluginId: { in: [...signIn] }, workspace: { deletedAt: null } },
  });
  let created = 0;
  for (const { workspaceId, pluginId } of linked) {
    // Still synced: its plugin is active, or an active one replaced it (and uses its accounts).
    const active = await plugins.activeIds(workspaceId);
    const replacedByActive = plugins.installed.some(
      (plugin) => active.has(plugin.manifest.id) && plugin.manifest.replaces.includes(pluginId),
    );
    if (active.has(pluginId) || replacedByActive) continue;
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
