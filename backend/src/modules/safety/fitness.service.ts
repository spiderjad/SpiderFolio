// Fitness for work (docs/spec/seguridad-salud.md, «Aptitud»): fit, fit with restrictions or not fit, and
// until when, without medical data. Health data: only `safety.health` records and sees everyone's; each
// person sees their own. The latest record counts; each one sets an expiry («safety.fitness»).
import { forbidden, notFound } from "../../lib/errors.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { expiryState, type ExpiryState } from "../expiries/expiry-rules.ts";
import { FITNESS_EXPIRY } from "./fitness-expiry.ts";
import { requireSafety } from "./safety-access.ts";

export type FitnessStatus = "APT" | "APT_RESTRICTED" | "NOT_APT";

export interface FitnessView {
  id: string;
  status: FitnessStatus;
  validUntil: string | null;
  restrictions: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
  /** Of the validity (null when it has no date). */
  state: ExpiryState | null;
}

const canSeeHealth = (ctx: Pick<AdminContext, "tenant">) =>
  ctx.tenant.capabilities.includes("safety.health");

async function assertMayRead(ctx: AdminContext, membershipId: string): Promise<void> {
  await requireSafety(ctx);
  if (membershipId !== ctx.tenant.membershipId && !canSeeHealth(ctx)) throw notFound();
  if ((await ctx.db.membership.count({ where: { id: membershipId } })) === 0) throw notFound();
}

/** The person's fitness records, latest first (the first one counts). */
export async function fitnessOf(
  ctx: AdminContext,
  membershipId: string,
): Promise<{ items: FitnessView[]; canRecord: boolean }> {
  await assertMayRead(ctx, membershipId);
  const rows = await ctx.db.safetyFitness.findMany({
    where: { membershipId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  const authors = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((row) => [row.id, row.user.name]),
  );
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const today = dayIn(new Date(), zoneOf(workspace?.settings));
  return {
    items: rows.map((row) => {
      const validUntil = row.validUntil === null ? null : dayOf(row.validUntil);
      return {
        id: row.id,
        status: row.status as FitnessStatus,
        validUntil,
        restrictions: row.restrictions,
        createdAt: row.createdAt,
        createdBy: authors.has(row.createdById)
          ? { id: row.createdById, name: authors.get(row.createdById) ?? "" }
          : null,
        state: validUntil === null ? null : expiryState(today, validUntil, [30, 7, 0]),
      };
    }),
    canRecord: canSeeHealth(ctx),
  };
}

export async function recordFitness(
  ctx: AdminContext,
  membershipId: string,
  input: { status: FitnessStatus; validUntil: string | null; restrictions: string | null },
): Promise<void> {
  await requireSafety(ctx);
  if (!canSeeHealth(ctx)) throw forbidden();
  const person = await ctx.db.membership.count({ where: { id: membershipId, status: "ACTIVE" } });
  if (person === 0) throw notFound();
  await ctx.db.$transaction(async (tx) => {
    const previous = await tx.safetyFitness.findMany({
      where: { membershipId },
      select: { id: true },
    });
    for (const row of previous) await resolveExpiry(tx, FITNESS_EXPIRY, row.id);
    const created = await tx.safetyFitness.create({
      data: {
        membershipId,
        status: input.status,
        validUntil: input.validUntil === null ? null : new Date(`${input.validUntil}T00:00:00Z`),
        restrictions: input.status === "APT_RESTRICTED" ? input.restrictions : null,
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    if (input.validUntil !== null) {
      await setExpiry(tx, {
        kind: FITNESS_EXPIRY,
        subjectId: created.id,
        dueOn: input.validUntil,
        membershipId,
        responsibleId: ctx.tenant.membershipId,
      });
    }
  });
  await auditAdmin(ctx, {
    action: "safety.fitness.record",
    entityType: "Membership",
    entityId: membershipId,
    // Only that it was recorded and until when: the status itself is health data.
    metadata: { validUntil: input.validUntil },
  });
}
