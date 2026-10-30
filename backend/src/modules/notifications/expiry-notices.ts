// Daily notice at 8:00 in each company's zone (an hourly job that only takes the companies where it's 8
// now): the access that expires in the next 2 days, to whoever received it (the person, or the
// members of the department) and to whoever shared it. Once per access and expiry: the job can run
// again without duplicating notices (dedupeKey unique per person).
import type { WorkerDeps } from "../../jobs/handlers.ts";
import { localHour, zoneOf } from "../../lib/time-zone.ts";
import { parentMapOf, withDescendants } from "../departments/department-tree.ts";

const NOTICE_DAYS = 2;
const NOTICE_HOUR = 8;
const BATCH = 200;

export async function notifyExpiringAccess(
  deps: Pick<WorkerDeps, "prisma" | "logger">,
  now: Date = new Date(),
): Promise<{ notified: number }> {
  const until = new Date(now.getTime() + NOTICE_DAYS * 24 * 60 * 60 * 1000);
  const companies = (
    await deps.prisma.workspace.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })
  )
    .filter((workspace) => localHour(now, zoneOf(workspace.settings)) === NOTICE_HOUR)
    .map((workspace) => workspace.id);
  if (companies.length === 0) return { notified: 0 };
  const trees = new Map<string, ReturnType<typeof parentMapOf>>();
  const treeOf = async (workspaceId: string) => {
    const cached = trees.get(workspaceId);
    if (cached !== undefined) return cached;
    const tree = parentMapOf(
      await deps.prisma.department.findMany({
        where: { workspaceId },
        select: { id: true, parentId: true },
      }),
    );
    trees.set(workspaceId, tree);
    return tree;
  };

  let notified = 0;
  let after: string | undefined;
  for (;;) {
    const permissions = await deps.prisma.permission.findMany({
      where: { workspaceId: { in: companies }, expiresAt: { gt: now, lte: until } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(after === undefined ? {} : { cursor: { id: after }, skip: 1 }),
      select: {
        id: true,
        workspaceId: true,
        spaceId: true,
        nodeId: true,
        membershipId: true,
        departmentId: true,
        includeSubareas: true,
        grantedById: true,
        expiresAt: true,
      },
    });
    if (permissions.length === 0) break;
    after = permissions.at(-1)?.id;
    for (const permission of permissions) {
      if (permission.expiresAt === null) continue;
      let recipients: string[] = [];
      if (permission.membershipId !== null) {
        recipients = [permission.membershipId];
      } else if (permission.departmentId !== null) {
        const ids = permission.includeSubareas
          ? withDescendants([permission.departmentId], await treeOf(permission.workspaceId))
          : [permission.departmentId];
        recipients = (
          await deps.prisma.departmentMember.findMany({
            where: { workspaceId: permission.workspaceId, departmentId: { in: ids } },
            take: 2000,
            select: { membershipId: true },
          })
        ).map((member) => member.membershipId);
      }
      // Quien lo compartió también se entera, con su propio texto (salvo si es de quienes lo
      // reciben: ahí le llega el del receptor).
      const everyone = [...new Set([...recipients, permission.grantedById])];
      const active = await deps.prisma.membership.findMany({
        where: { workspaceId: permission.workspaceId, id: { in: everyone }, status: "ACTIVE" },
        select: { id: true },
      });
      if (active.length === 0) continue;
      const key = `exp:${permission.id}:${String(permission.expiresAt.getTime())}`;
      const result = await deps.prisma.notification.createMany({
        skipDuplicates: true,
        data: active.map((member) => ({
          workspaceId: permission.workspaceId,
          membershipId: member.id,
          kind: recipients.includes(member.id) ? "expiring" : "expiring_granted",
          actorId: permission.grantedById,
          permissionId: permission.id,
          spaceId: permission.spaceId,
          nodeId: permission.nodeId,
          expiresAt: permission.expiresAt,
          dedupeKey: key,
        })),
      });
      notified += result.count;
    }
    if (permissions.length < BATCH) break;
  }
  deps.logger.info({ notified }, "Avisos de vencimiento de accesos");
  return { notified };
}
