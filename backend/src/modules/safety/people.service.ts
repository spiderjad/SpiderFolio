// The module's people list (docs/spec/seguridad-salud.md, «Ficha por persona»): whoever manages it sees
// everyone, heads their area; search, position and department filters, and each person's alerts: PPE
// their position requires and they lack, training expired or pending and, only with safety.health,
// fitness about to expire or expired.
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { expiryState } from "../expiries/expiry-rules.ts";
import { personPpe } from "./ppe.service.ts";
import { requireSafety, visiblePeople } from "./safety-access.ts";
import { personTraining } from "./training.service.ts";

export interface SafetyPersonRow {
  id: string;
  name: string;
  position: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  alerts: {
    /** PPE their position requires and they lack (or have expired). */
    missingPpe: number;
    /** Courses expired or never done. */
    training: number;
    /** Fitness about to expire or expired; null without safety.health. */
    fitness: "due_soon" | "expired" | null;
  };
}

export async function listSafetyPeople(
  ctx: AdminContext,
  query: {
    q?: string | undefined;
    position?: string | undefined;
    department?: string | undefined;
    page: number;
    pageSize: number;
    cursor?: string | undefined;
  },
): Promise<Page<SafetyPersonRow>> {
  await requireSafety(ctx);
  const visible = await visiblePeople(ctx);
  const where: Prisma.MembershipWhereInput = {
    status: "ACTIVE",
    role: { base: { not: "GUEST" } },
    ...(visible === null ? {} : { id: { in: visible } }),
    ...(query.position === undefined ? {} : { positionId: query.position }),
    ...(query.department === undefined
      ? {}
      : { departments: { some: { departmentId: query.department } } }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { user: { name: { contains: query.q, mode: "insensitive" } } }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.membership.findMany({
      where,
      select: {
        id: true,
        positionId: true,
        user: { select: { name: true } },
        departments: { select: { department: { select: { id: true, name: true } } } },
      },
      orderBy: stableOrder({ user: { name: "asc" } }),
      ...offsetArgs(query),
    }),
    ctx.db.membership.count({ where }),
  ]);
  const positions = new Map(
    (
      await ctx.db.position.findMany({
        where: {
          id: { in: rows.flatMap((row) => (row.positionId === null ? [] : [row.positionId])) },
        },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row]),
  );
  const health = ctx.tenant.capabilities.includes("safety.health");
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const today = dayIn(new Date(), zoneOf(workspace?.settings));
  const items: SafetyPersonRow[] = [];
  for (const row of rows) {
    const ppe = await personPpe(ctx, row.id);
    const training = await personTraining(ctx, row.id);
    let fitness: SafetyPersonRow["alerts"]["fitness"] = null;
    if (health) {
      const latest = await ctx.db.safetyFitness.findFirst({
        where: { membershipId: row.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { validUntil: true },
      });
      if (latest?.validUntil != null) {
        const state = expiryState(today, dayOf(latest.validUntil), [30, 7, 0]);
        fitness = state === "valid" ? null : state;
      }
    }
    items.push({
      id: row.id,
      name: row.user.name,
      position: row.positionId === null ? null : (positions.get(row.positionId) ?? null),
      departments: row.departments.map((member) => member.department),
      alerts: {
        missingPpe: ppe.missing.length,
        training: training.filter(
          (course) => course.state === "expired" || course.state === "pending",
        ).length,
        fitness,
      },
    });
  }
  return pageOf(items, total, query);
}
