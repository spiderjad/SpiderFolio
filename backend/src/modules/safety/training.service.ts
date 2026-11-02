// Training (docs/spec/seguridad-salud.md, «Formación y evaluaciones»): a course is a controlled document
// whose reading counts as training, valid for some months. Who has to do it comes from the document's
// required readings (departments, positions, people). The «Leí y comprendo» of the current version is
// a training record; once it expires the person confirms again from the module (the reading of a
// version is confirmed only once). Whoever manages the module also records in-person training.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page, type PageQuery } from "../../lib/pagination.ts";
import { dayIn, dayMonthsLater, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import { escapeHtml } from "@spiderfolio/content";
import { formMessages, safetyTexts } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { signatureBytes } from "./ppe.service.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { expandRequirements } from "../documents/readings.core.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { expiryState, type ExpiryState } from "../expiries/expiry-rules.ts";
import {
  canManageSafety,
  requireSafety,
  safetySettingsOf,
  visiblePeople,
} from "./safety-access.ts";
import { TRAINING_EXPIRY } from "./training-expiry.ts";

export type TrainingState = ExpiryState | "pending";

async function zone(ctx: Pick<AdminContext, "db">): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return zoneOf(workspace?.settings);
}

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
}

/** Records a training and moves its expiry: the person's earlier ones of the course stop telling. */
async function addTraining(
  ctx: AdminContext,
  course: { id: string; validityMonths: number | null },
  membershipId: string,
  completedAt: Date,
  source: "READING" | "IN_PERSON",
  signature?: Buffer,
): Promise<void> {
  const tz = await zone(ctx);
  const validUntil =
    course.validityMonths === null
      ? null
      : dayIn(dayMonthsLater(completedAt, course.validityMonths, tz), tz);
  await ctx.db.$transaction(async (tx) => {
    const previous = await tx.safetyTraining.findMany({
      where: { courseId: course.id, membershipId },
      select: { id: true },
    });
    for (const row of previous) await resolveExpiry(tx, TRAINING_EXPIRY, row.id);
    const training = await tx.safetyTraining.create({
      data: {
        courseId: course.id,
        membershipId,
        completedAt,
        source,
        validUntil: validUntil === null ? null : new Date(`${validUntil}T00:00:00Z`),
        ...(signature === undefined ? {} : { signature: new Uint8Array(signature) }),
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    if (validUntil !== null) {
      await setExpiry(tx, {
        kind: TRAINING_EXPIRY,
        subjectId: training.id,
        dueOn: validUntil,
        membershipId,
        noticeDays: [30, 7, 0],
      });
    }
  });
}

/** Called after a «Leí y comprendo»: if the document is a course, it's a training record. */
export async function trainingFromReading(ctx: AdminContext, nodeId: string): Promise<void> {
  const course = await ctx.db.safetyCourse.findFirst({
    where: { nodeId },
    select: { id: true, validityMonths: true },
  });
  if (course === null || !(await safetySettingsOf(ctx.db)).enabled) return;
  await addTraining(ctx, course, ctx.tenant.membershipId, new Date(), "READING");
}

// ─── Courses ─────────────────────────────────────────────────────────────────────────────

export interface CourseView {
  id: string;
  document: { id: string; spaceId: string; code: string; name: string; type: "PAGE" | "FILE" };
  validityMonths: number | null;
  /** People who have to do it and how they stand (counts). */
  counts: Record<TrainingState, number>;
}

interface PersonState {
  membershipId: string;
  name: string;
  state: TrainingState;
  completedAt: Date | null;
  source: string | null;
  validUntil: string | null;
}

/** Each required person's state in a course: the latest training counts. */
async function statesOf(
  ctx: AdminContext,
  course: { id: string; nodeId: string },
  people: string[] | null,
): Promise<PersonState[]> {
  const document = await ctx.db.controlledDocument.findFirst({
    where: { nodeId: course.nodeId },
    select: { publishedVersion: true },
  });
  const requirements =
    document?.publishedVersion == null
      ? []
      : await ctx.db.readRequirement.findMany({
          where: { nodeId: course.nodeId, version: document.publishedVersion },
        });
  const required = await expandRequirements(ctx.db, requirements);
  const trainings = await ctx.db.safetyTraining.findMany({
    where: { courseId: course.id, ...(people === null ? {} : { membershipId: { in: people } }) },
    orderBy: { completedAt: "desc" },
    select: { membershipId: true, completedAt: true, source: true, validUntil: true },
    take: 10_000,
  });
  const latest = new Map<string, (typeof trainings)[number]>();
  for (const row of trainings) if (!latest.has(row.membershipId)) latest.set(row.membershipId, row);
  const ids = [...new Set([...required.keys(), ...latest.keys()])].filter(
    (id) => people === null || people.includes(id),
  );
  const names = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: ids }, status: "ACTIVE" },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((row) => [row.id, row.user.name]),
  );
  const today = dayIn(new Date(), await zone(ctx));
  return ids.flatMap((id) => {
    const name = names.get(id);
    if (name === undefined) return [];
    const row = latest.get(id);
    const validUntil = row?.validUntil == null ? null : dayOf(row.validUntil);
    const state: TrainingState =
      row === undefined
        ? "pending"
        : validUntil === null
          ? "valid"
          : expiryState(today, validUntil, [30, 7, 0]);
    return [
      {
        membershipId: id,
        name,
        state,
        completedAt: row?.completedAt ?? null,
        source: row?.source ?? null,
        validUntil,
      },
    ];
  });
}

const emptyCounts = (): Record<TrainingState, number> => ({
  valid: 0,
  due_soon: 0,
  expired: 0,
  pending: 0,
});

async function courseViews(
  ctx: AdminContext,
  rows: { id: string; nodeId: string; validityMonths: number | null }[],
  people: string[] | null,
): Promise<CourseView[]> {
  const documents = await ctx.db.controlledDocument.findMany({
    where: { nodeId: { in: rows.map((row) => row.nodeId) }, node: { trashedAt: null } },
    select: {
      nodeId: true,
      code: true,
      node: { select: { name: true, spaceId: true, type: true } },
    },
  });
  const byNode = new Map(documents.map((row) => [row.nodeId, row]));
  const views: CourseView[] = [];
  for (const row of rows) {
    const document = byNode.get(row.nodeId);
    if (document === undefined) continue;
    const counts = emptyCounts();
    for (const person of await statesOf(ctx, row, people)) counts[person.state] += 1;
    views.push({
      id: row.id,
      document: {
        id: row.nodeId,
        spaceId: document.node.spaceId,
        code: document.code,
        name: document.node.name,
        type: document.node.type === "FILE" ? "FILE" : "PAGE",
      },
      validityMonths: row.validityMonths,
      counts,
    });
  }
  return views;
}

/** The courses: everything for whoever manages the module; heads their area; the rest their own. */
export async function listCourses(ctx: AdminContext, query: PageQuery): Promise<Page<CourseView>> {
  await requireSafety(ctx);
  const people = await visiblePeople(ctx);
  const [rows, total] = await Promise.all([
    ctx.db.safetyCourse.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, nodeId: true, validityMonths: true },
      ...offsetArgs(query),
    }),
    ctx.db.safetyCourse.count(),
  ]);
  return pageOf(await courseViews(ctx, rows, people), total, query);
}

export async function createCourse(
  ctx: AdminContext,
  input: { nodeId: string; validityMonths: number | null },
): Promise<CourseView> {
  await requireManager(ctx);
  const document = await ctx.db.controlledDocument.findFirst({
    where: { nodeId: input.nodeId, node: { trashedAt: null } },
    select: { nodeId: true },
  });
  if (document === null || !atLeast(await levelOfNode(ctx, input.nodeId), "VIEW")) {
    throw notFound();
  }
  const taken = await ctx.db.safetyCourse.count({ where: { nodeId: input.nodeId } });
  if (taken > 0) throw new AppError("CONFLICT", { message: safetyTexts.training.alreadyCourse });
  const course = await ctx.db.safetyCourse.create({
    data: {
      nodeId: input.nodeId,
      validityMonths: input.validityMonths,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true, nodeId: true, validityMonths: true },
  });
  await auditAdmin(ctx, {
    action: "safety.course.create",
    entityType: "SafetyCourse",
    entityId: course.id,
    metadata: { nodeId: input.nodeId, validityMonths: input.validityMonths },
  });
  const [view] = await courseViews(ctx, [course], null);
  if (view === undefined) throw notFound();
  return view;
}

export async function updateCourse(
  ctx: AdminContext,
  id: string,
  validityMonths: number | null,
): Promise<CourseView> {
  await requireManager(ctx);
  const current = await ctx.db.safetyCourse.findFirst({ where: { id } });
  if (current === null) throw notFound();
  const course = await ctx.db.safetyCourse.update({
    where: { id },
    data: { validityMonths },
    select: { id: true, nodeId: true, validityMonths: true },
  });
  await auditAdmin(ctx, {
    action: "safety.course.update",
    entityType: "SafetyCourse",
    entityId: id,
    metadata: { before: current.validityMonths, after: validityMonths },
  });
  const [view] = await courseViews(ctx, [course], null);
  if (view === undefined) throw notFound();
  return view;
}

async function loadCourse(ctx: AdminContext, id: string) {
  await requireSafety(ctx);
  const course = await ctx.db.safetyCourse.findFirst({
    where: { id },
    select: { id: true, nodeId: true, validityMonths: true },
  });
  if (course === null) throw notFound();
  return course;
}

export async function getCourse(
  ctx: AdminContext,
  id: string,
): Promise<{ course: CourseView; people: PersonState[]; canRecord: boolean }> {
  const course = await loadCourse(ctx, id);
  const people = await visiblePeople(ctx);
  const [view] = await courseViews(ctx, [course], people);
  if (view === undefined) throw notFound();
  const states = await statesOf(ctx, course, people);
  states.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { course: view, people: states, canRecord: canManageSafety(ctx) };
}

/**
 * In-person training: whoever manages the module records who attended and when, and each attendee signs
 * with a finger (on the same tablet, one after another).
 */
export async function recordAttendance(
  ctx: AdminContext,
  id: string,
  input: { attendees: { membershipId: string; signature: string }[]; completedOn: string },
): Promise<void> {
  await requireManager(ctx);
  const course = await loadCourse(ctx, id);
  const ids = input.attendees.map((attendee) => attendee.membershipId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.training.repeated });
  }
  const found = await ctx.db.membership.count({ where: { id: { in: ids }, status: "ACTIVE" } });
  if (found !== ids.length) throw notFound();
  const signatures = input.attendees.map((attendee) => signatureBytes(attendee.signature));
  const completedAt = new Date(`${input.completedOn}T12:00:00Z`);
  for (const [index, attendee] of input.attendees.entries()) {
    await addTraining(
      ctx,
      course,
      attendee.membershipId,
      completedAt,
      "IN_PERSON",
      signatures[index],
    );
  }
  await auditAdmin(ctx, {
    action: "safety.training.attendance",
    entityType: "SafetyCourse",
    entityId: id,
    metadata: { people: ids.length, completedOn: input.completedOn },
  });
}

/** The signed attendance sheet of one day as a PDF (Gotenberg), for whoever manages the module. */
export async function attendancePdf(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  id: string,
  day: string,
): Promise<{ fileName: string; body: Uint8Array }> {
  await requireManager(ctx);
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const course = await loadCourse(ctx, id);
  const document = await ctx.db.controlledDocument.findFirst({
    where: { nodeId: course.nodeId },
    select: { code: true, publishedVersion: true, node: { select: { name: true } } },
  });
  const rows = await ctx.db.safetyTraining.findMany({
    where: {
      courseId: id,
      source: "IN_PERSON",
      completedAt: { gte: new Date(`${day}T00:00:00Z`), lte: new Date(`${day}T23:59:59Z`) },
    },
    orderBy: { createdAt: "asc" },
    select: { membershipId: true, signature: true, createdById: true },
  });
  if (rows.length === 0) throw notFound();
  const people = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: rows.flatMap((row) => [row.membershipId, row.createdById]) } },
        select: { id: true, positionId: true, user: { select: { name: true } } },
      })
    ).map((row) => [row.id, row]),
  );
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { name: true } });
  const t = safetyTexts.attendancePdf;
  const locale = currentLocale();
  const title = `${document?.code ?? ""} ${document?.node.name ?? ""}`.trim();
  const when = formatUtcDay(new Date(`${day}T12:00:00Z`), locale);
  const lines = rows
    .map((row, index) => {
      const image =
        row.signature === null
          ? ""
          : `<img alt="" src="data:image/png;base64,${Buffer.from(row.signature).toString("base64")}">`;
      return `<tr><td>${String(index + 1)}</td><td>${escapeHtml(
        people.get(row.membershipId)?.user.name ?? "",
      )}</td><td class="sign">${image}</td></tr>`;
    })
    .join("");
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; }
    h1 { font-size: 16pt; margin: 0 0 .2em; } .meta { color: #555; margin: 0 0 1em; }
    table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; }
    th { background: #f3f3f3; font-weight: normal; } td.sign img { height: 48px; } td:first-child { width: 2em; }
  `;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>
<h1>${escapeHtml(t.title)}</h1><p class="meta">${escapeHtml(workspace?.name ?? "")} · ${escapeHtml(title)}${
    document?.publishedVersion == null ? "" : ` · v${String(document.publishedVersion)}`
  } · ${escapeHtml(when)}</p>
<table><thead><tr><th>#</th><th>${escapeHtml(t.person)}</th><th>${escapeHtml(t.signature)}</th></tr></thead><tbody>${lines}</tbody></table>
<p class="meta">${escapeHtml(t.recordedBy(people.get(rows[0]?.createdById ?? "")?.user.name ?? ""))}</p></body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const body = await renderWithGotenberg(deps.gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(t.title)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${safetyTexts.pdf.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  await auditAdmin(ctx, {
    action: "safety.training.export",
    entityType: "SafetyCourse",
    entityId: id,
    metadata: { day, people: rows.length },
  });
  return { fileName: t.fileName(title, day), body };
}

/** Done again after it expired: the person confirms they read the current version once more. */
export async function confirmTraining(ctx: AdminContext, id: string): Promise<void> {
  const course = await loadCourse(ctx, id);
  if (!atLeast(await levelOfNode(ctx, course.nodeId), "VIEW")) throw notFound();
  const [mine] = await statesOf(ctx, course, [ctx.tenant.membershipId]);
  if (mine === undefined) throw forbidden();
  if (mine.state === "valid") {
    throw new AppError("CONFLICT", { message: safetyTexts.training.stillValid });
  }
  await addTraining(ctx, course, ctx.tenant.membershipId, new Date(), "READING");
  await auditAdmin(ctx, {
    action: "safety.training.confirm",
    entityType: "SafetyCourse",
    entityId: id,
  });
}

/** A person's training, for their sheet. */
export async function personTraining(
  ctx: AdminContext,
  membershipId: string,
): Promise<
  {
    id: string;
    document: CourseView["document"];
    state: TrainingState;
    validUntil: string | null;
    completedAt: Date | null;
  }[]
> {
  await requireSafety(ctx);
  const visible = await visiblePeople(ctx);
  if (visible !== null && !visible.includes(membershipId)) throw notFound();
  const courses = await ctx.db.safetyCourse.findMany({
    select: { id: true, nodeId: true, validityMonths: true },
    take: 500,
  });
  const views = await courseViews(ctx, courses, [membershipId]);
  const result = [];
  for (const course of courses) {
    const view = views.find((candidate) => candidate.id === course.id);
    if (view === undefined) continue;
    const [state] = await statesOf(ctx, course, [membershipId]);
    if (state === undefined) continue;
    result.push({
      id: course.id,
      document: view.document,
      state: state.state,
      validUntil: state.validUntil,
      completedAt: state.completedAt,
    });
  }
  return result;
}
