// In-person training signed on each attendee's own phone (docs/spec/seguridad-salud.md, «Formación y
// evaluaciones»). Whoever manages the module opens a session for a course and a day with the attendees
// chosen; it shows a QR or a link. Each attendee on the list signs once, only for themselves; whoever
// gave it sees live who signed and closes it whenever they want. It expires on its own after 24 hours.
// Each signature is an in-person training record like the tablet's, so the day's PDF includes them all.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { signatureBytes } from "./ppe.service.ts";
import { canManageSafety, requireSafety } from "./safety-access.ts";
import { addTraining, loadCourse, requireManager } from "./training.service.ts";

/** How long a session stays open if nobody closes it. */
export const SESSION_HOURS = 24;

export interface SignSessionView {
  id: string;
  course: { id: string; name: string; code: string | null };
  completedOn: string;
  trainer: { id: string; name: string };
  expiresAt: Date;
  closedAt: Date | null;
  open: boolean;
  /** Only for whoever manages the module: who signed and who's missing. */
  attendees: { id: string; name: string; signedAt: Date | null }[] | null;
  /** For the person looking: whether they're on the list and already signed. */
  me: { listed: boolean; signed: boolean };
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

const isOpen = (row: { closedAt: Date | null; expiresAt: Date }, now = new Date()) =>
  row.closedAt === null && row.expiresAt > now;

async function loadSession(ctx: AdminContext, id: string) {
  await requireSafety(ctx);
  const row = await ctx.db.safetySignSession.findFirst({ where: { id } });
  if (row === null) throw notFound();
  return row;
}

async function viewOf(
  ctx: AdminContext,
  row: Awaited<ReturnType<typeof loadSession>>,
): Promise<SignSessionView> {
  const manages = canManageSafety(ctx);
  const course = await ctx.db.safetyCourse.findFirst({
    where: { id: row.courseId },
    select: { id: true, nodeId: true },
  });
  if (course === null) throw notFound();
  const document = await ctx.db.controlledDocument.findFirst({
    where: { nodeId: course.nodeId },
    select: { code: true, node: { select: { name: true } } },
  });
  const signed = new Map(
    (
      await ctx.db.safetyTraining.findMany({
        where: { sessionId: row.id },
        select: { membershipId: true, createdAt: true },
      })
    ).map((training) => [training.membershipId, training.createdAt]),
  );
  const people = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: [...row.attendeeIds, row.createdById] } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((membership) => [membership.id, membership.user.name]),
  );
  const me = ctx.tenant.membershipId;
  return {
    id: row.id,
    course: { id: course.id, name: document?.node.name ?? "", code: document?.code ?? null },
    completedOn: dayOf(row.completedOn),
    trainer: { id: row.createdById, name: people.get(row.createdById) ?? "" },
    expiresAt: row.expiresAt,
    closedAt: row.closedAt,
    open: isOpen(row),
    attendees: manages
      ? row.attendeeIds
          .map((id) => ({ id, name: people.get(id) ?? "", signedAt: signed.get(id) ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
      : null,
    me: { listed: row.attendeeIds.includes(me), signed: signed.has(me) },
  };
}

export async function createSignSession(
  ctx: AdminContext,
  courseId: string,
  input: { attendeeIds: string[]; completedOn: string },
): Promise<SignSessionView> {
  await requireManager(ctx);
  const course = await loadCourse(ctx, courseId);
  const ids = [...new Set(input.attendeeIds)];
  if (ids.length === 0) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.training.noAttendees });
  }
  const found = await ctx.db.membership.count({ where: { id: { in: ids }, status: "ACTIVE" } });
  if (found !== ids.length) throw notFound();
  const row = await ctx.db.safetySignSession.create({
    data: {
      courseId: course.id,
      completedOn: new Date(`${input.completedOn}T00:00:00Z`),
      attendeeIds: ids,
      createdById: ctx.tenant.membershipId,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
    },
  });
  await auditAdmin(ctx, {
    action: "safety.training.session.open",
    entityType: "SafetySignSession",
    entityId: row.id,
    metadata: { courseId: course.id, people: ids.length, completedOn: input.completedOn },
  });
  return await viewOf(ctx, row);
}

/** A course's sessions still open, for whoever manages the module (to show the QR again). */
export async function openSignSessions(
  ctx: AdminContext,
  courseId: string,
): Promise<SignSessionView[]> {
  await requireManager(ctx);
  await loadCourse(ctx, courseId);
  const rows = await ctx.db.safetySignSession.findMany({
    where: { courseId, closedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return await Promise.all(rows.map((row) => viewOf(ctx, row)));
}

/** The session: whoever manages the module sees who signed; an attendee on the list, what to sign. */
export async function getSignSession(ctx: AdminContext, id: string): Promise<SignSessionView> {
  const row = await loadSession(ctx, id);
  if (!canManageSafety(ctx) && !row.attendeeIds.includes(ctx.tenant.membershipId)) {
    throw new AppError("FORBIDDEN", { message: safetyTexts.training.notListed });
  }
  return await viewOf(ctx, row);
}

/** An attendee signs for themselves, once, while the session is open. */
export async function signSession(
  ctx: AdminContext,
  id: string,
  signature: string,
): Promise<SignSessionView> {
  const row = await loadSession(ctx, id);
  const me = ctx.tenant.membershipId;
  const t = safetyTexts.training;
  if (!row.attendeeIds.includes(me)) throw new AppError("FORBIDDEN", { message: t.notListed });
  if (!isOpen(row)) throw new AppError("CONFLICT", { message: t.sessionClosed });
  if ((await ctx.db.safetyTraining.count({ where: { sessionId: id, membershipId: me } })) > 0) {
    throw new AppError("CONFLICT", { message: t.alreadySigned });
  }
  const course = await ctx.db.safetyCourse.findFirst({
    where: { id: row.courseId },
    select: { id: true, validityMonths: true },
  });
  if (course === null) throw notFound();
  const png = signatureBytes(signature);
  try {
    await addTraining(
      ctx,
      course,
      me,
      new Date(`${dayOf(row.completedOn)}T12:00:00Z`),
      "IN_PERSON",
      png,
      { id: row.id, createdById: row.createdById },
    );
  } catch (error) {
    // Two taps at once: the unique (session, person) keeps it to one signature.
    if ((error as { code?: string }).code === "P2002") {
      throw new AppError("CONFLICT", { message: t.alreadySigned });
    }
    throw error;
  }
  await auditAdmin(ctx, {
    action: "safety.training.session.sign",
    entityType: "SafetySignSession",
    entityId: id,
    metadata: { courseId: course.id },
  });
  return await viewOf(ctx, row);
}

export async function closeSignSession(ctx: AdminContext, id: string): Promise<SignSessionView> {
  const row = await loadSession(ctx, id);
  if (!canManageSafety(ctx)) throw forbidden();
  if (!isOpen(row)) {
    throw new AppError("CONFLICT", { message: safetyTexts.training.sessionClosed });
  }
  const closed = await ctx.db.safetySignSession.update({
    where: { id },
    data: { closedAt: new Date() },
  });
  await auditAdmin(ctx, {
    action: "safety.training.session.close",
    entityType: "SafetySignSession",
    entityId: id,
  });
  return await viewOf(ctx, closed);
}
