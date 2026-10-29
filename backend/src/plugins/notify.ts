// ctx.notify of the plugins (docs/spec/plugins.md): bell notices to the company's owners and
// administrators, or to some of its members. Only members of the plugin's own company receive them
// (anyone else in the list is ignored). The notice carries no text: «<pluginId>:<code>» in `detail`,
// and the plugin's app part says what it reads (FrontendPlugin.notifications).
import type { PluginNotice } from "@spiderfolio/plugin-sdk/backend";
import { z } from "zod";
import { forTenant } from "../db/tenant.ts";
import type { PrismaClient } from "../lib/prisma.ts";

export const PLUGIN_NOTICE_KIND = "plugin";

const NoticeSchema = z.strictObject({
  to: z.union([
    z.literal("admins"),
    z.strictObject({ membershipIds: z.array(z.string().min(1).max(64)).min(1).max(100) }),
  ]),
  code: z.string().regex(/^[a-z][a-z0-9_.-]{1,39}$/u),
  dedupeKey: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,100}$/u)
    .optional(),
});

/** How many notices were created (a repeated dedupeKey for the same person creates none). */
export function createPluginNotifier(
  prisma: PrismaClient,
  workspaceId: string,
  pluginId: string,
): (notice: PluginNotice) => Promise<number> {
  const db = forTenant(prisma, workspaceId);
  return async (input) => {
    const notice = NoticeSchema.parse(input);
    const recipients = await db.membership.findMany({
      where: {
        status: "ACTIVE",
        ...(notice.to === "admins"
          ? { role: { base: { in: ["OWNER", "ADMIN"] } } }
          : { id: { in: [...new Set(notice.to.membershipIds)] } }),
      },
      select: { id: true },
      take: 500,
    });
    if (recipients.length === 0) return 0;
    const result = await db.notification.createMany({
      data: recipients.map((recipient) => ({
        membershipId: recipient.id,
        kind: PLUGIN_NOTICE_KIND,
        detail: `${pluginId}:${notice.code}`,
        dedupeKey: notice.dedupeKey === undefined ? null : `plugin:${pluginId}:${notice.dedupeKey}`,
      })),
      skipDuplicates: true,
    });
    return result.count;
  };
}
