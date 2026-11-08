// Crisis and recall (docs/spec/calidad.md, «Gestión de crisis y retirada»): the crisis team, its outside
// contacts (authority, customers, insurer, lab) and the recall tests, with the yearly notice to do the
// next one. quality.manage changes them; quality.view reads them.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { assertLot } from "./lots.service.ts";
import { RECALL_TEST_EXPIRY } from "./quality-expiry.ts";
import type {
  CrisisContactInput,
  RecallTestInput,
  UpdateCrisisContactInput,
} from "./complaints.schemas.ts";

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

async function requireReader(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
}

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
}

export interface CrisisView {
  team: { id: string; person: { id: string; name: string }; role: string }[];
  contacts: {
    id: string;
    kind: string;
    name: string;
    organization: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  }[];
  tests: {
    id: string;
    kind: "DRILL" | "REAL";
    date: string;
    product: string;
    lot: string;
    lotId: string | null;
    direction: string;
    minutes: number;
    recoveredPercent: number | null;
    result: string;
    by: { id: string; name: string };
  }[];
  /** When the next yearly test is due (a year after the last one); null without any. */
  nextTestOn: string | null;
  /** The quality space, where the communication templates live. */
  spaceId: string | null;
}

export async function getCrisis(ctx: AdminContext): Promise<CrisisView> {
  await requireReader(ctx);
  const settings = await requireQuality(ctx);
  const [team, contacts, tests] = await Promise.all([
    ctx.db.qualityCrisisMember.findMany({
      select: { id: true, membershipId: true, role: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: 50,
    }),
    ctx.db.qualityCrisisContact.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        kind: true,
        name: true,
        organization: true,
        phone: true,
        email: true,
        notes: true,
      },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: 100,
    }),
    ctx.db.qualityRecallTest.findMany({
      select: {
        id: true,
        kind: true,
        date: true,
        product: true,
        lot: true,
        lotId: true,
        direction: true,
        minutes: true,
        recoveredPercent: true,
        result: true,
        createdById: true,
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: 50,
    }),
  ]);
  const people = await ctx.db.membership.findMany({
    where: {
      id: {
        in: [...new Set([...team.map((m) => m.membershipId), ...tests.map((t) => t.createdById)])],
      },
    },
    select: { id: true, user: { select: { name: true } } },
  });
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const last = tests[0];
  const next = last === undefined ? null : new Date(last.date);
  next?.setUTCFullYear(next.getUTCFullYear() + 1);
  return {
    team: team.map((member) => ({
      id: member.id,
      person: { id: member.membershipId, name: nameOf.get(member.membershipId) ?? "" },
      role: member.role,
    })),
    contacts,
    tests: tests.map((test) => ({
      id: test.id,
      kind: test.kind,
      date: dayOf(test.date),
      product: test.product,
      lot: test.lot,
      lotId: test.lotId,
      direction: test.direction,
      minutes: test.minutes,
      recoveredPercent: test.recoveredPercent,
      result: test.result,
      by: { id: test.createdById, name: nameOf.get(test.createdById) ?? "" },
    })),
    nextTestOn: next === null ? null : dayOf(next),
    spaceId: settings.spaceId ?? null,
  };
}

export async function addCrisisMember(
  ctx: AdminContext,
  input: { membershipId: string; role: string },
): Promise<CrisisView> {
  await requireManager(ctx);
  const found = await ctx.db.membership.count({
    where: { id: input.membershipId, status: "ACTIVE" },
  });
  if (found === 0) throw notFound();
  const already = await ctx.db.qualityCrisisMember.count({
    where: { membershipId: input.membershipId },
  });
  if (already > 0) {
    throw new AppError("CONFLICT", { message: qualityTexts.complaintMessages.alreadyMember });
  }
  await ctx.db.qualityCrisisMember.create({
    data: { ...input, position: await ctx.db.qualityCrisisMember.count() },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.crisis.member.add",
    entityType: "Membership",
    entityId: input.membershipId,
    metadata: { role: input.role },
  });
  return await getCrisis(ctx);
}

export async function removeCrisisMember(ctx: AdminContext, id: string): Promise<CrisisView> {
  await requireManager(ctx);
  const removed = await ctx.db.qualityCrisisMember.deleteMany({ where: { id } });
  if (removed.count === 0) throw notFound();
  await auditAdmin(ctx, {
    action: "quality.crisis.member.remove",
    entityType: "QualityCrisisMember",
    entityId: id,
  });
  return await getCrisis(ctx);
}

export async function addCrisisContact(
  ctx: AdminContext,
  input: CrisisContactInput,
): Promise<CrisisView> {
  await requireManager(ctx);
  const created = await ctx.db.qualityCrisisContact.create({
    data: {
      kind: input.kind,
      name: input.name,
      organization: input.organization ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      position: await ctx.db.qualityCrisisContact.count(),
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.crisis.contact.add",
    entityType: "QualityCrisisContact",
    entityId: created.id,
    metadata: { kind: input.kind },
  });
  return await getCrisis(ctx);
}

export async function updateCrisisContact(
  ctx: AdminContext,
  id: string,
  input: UpdateCrisisContactInput,
): Promise<CrisisView> {
  await requireManager(ctx);
  const found = await ctx.db.qualityCrisisContact.count({ where: { id, archivedAt: null } });
  if (found === 0) throw notFound();
  await ctx.db.qualityCrisisContact.update({
    where: { id },
    data: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.crisis.contact.update",
    entityType: "QualityCrisisContact",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await getCrisis(ctx);
}

export async function archiveCrisisContact(ctx: AdminContext, id: string): Promise<CrisisView> {
  await requireManager(ctx);
  const found = await ctx.db.qualityCrisisContact.count({ where: { id, archivedAt: null } });
  if (found === 0) throw notFound();
  await ctx.db.qualityCrisisContact.update({
    where: { id },
    data: { archivedAt: new Date() },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.crisis.contact.archive",
    entityType: "QualityCrisisContact",
    entityId: id,
  });
  return await getCrisis(ctx);
}

/** A recall test: the next one is due a year after the latest (whoever records it is told). */
export async function addRecallTest(
  ctx: AdminContext,
  input: RecallTestInput,
): Promise<CrisisView> {
  await requireManager(ctx);
  await assertLot(ctx.db, input.lotId);
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityRecallTest.create({
      data: { ...input, date: dateOf(input.date), createdById: ctx.tenant.membershipId },
      select: { id: true },
    });
    const latest = await tx.qualityRecallTest.findFirst({
      select: { date: true },
      orderBy: [{ date: "desc" }, { id: "asc" }],
    });
    if (latest !== null) {
      const next = new Date(latest.date);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      await setExpiry(tx, {
        kind: RECALL_TEST_EXPIRY,
        subjectId: tx.workspaceId,
        dueOn: dayOf(next),
        responsibleId: ctx.tenant.membershipId,
        noticeDays: [30, 7, 0],
      });
    }
  });
  await auditAdmin(ctx, {
    action: "quality.recall.test",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { kind: input.kind, date: input.date, minutes: input.minutes },
  });
  return await getCrisis(ctx);
}
