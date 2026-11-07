// Food safety culture (docs/spec/calidad.md, «Fase 6c»): the year's plan with its activities, and anonymous
// surveys. quality.manage plans and runs the surveys; an activity's responsible person marks it done;
// quality.view reads the plan and the results. Anyone active (not a guest) answers an open survey once.
// Anonymity by design: an answer stores no person and no time, who answered is in another table with
// nothing linking the two, and results only show from a minimum of answers.
import { randomInt } from "node:crypto";
import { qualityLimits } from "@spiderfolio/limits";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { CULTURE_EXPIRY } from "./quality-expiry.ts";
import { companyToday } from "./prps.service.ts";
import type {
  CultureActivityInput,
  CulturePlanInput,
  SurveyAnswerInput,
  SurveyInput,
  UpdateCultureActivityInput,
  UpdateSurveyInput,
} from "./culture.schemas.ts";

const NOTICE_DAYS = [7, 1, 0] as const;
const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

async function requireCulture(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST") throw forbidden();
}

async function assertMember(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.membership.count({
    where: { id, status: "ACTIVE", role: { base: { not: "GUEST" } } },
  });
  if (found === 0) throw notFound();
}

// ─── Plan and activities ─────────────────────────────────────────────────────────────────

export interface CultureActivityView {
  id: string;
  year: number;
  title: string;
  kind: string;
  plannedOn: string;
  doneOn: string | null;
  responsible: { id: string; name: string } | null;
  note: string | null;
  overdue: boolean;
  archived: boolean;
  access: "manage" | "responsible" | "read";
}

export interface SurveySummary {
  id: string;
  title: string;
  questions: number;
  opensOn: string;
  closesOn: string;
  state: "scheduled" | "open" | "closed";
  answers: number;
}

export interface CultureOverview {
  year: number;
  objectives: string;
  activities: CultureActivityView[];
  /** Only for quality.view; the rest see the surveys they have to answer in «Mis pendientes». */
  surveys: SurveySummary[];
  canManage: boolean;
}

const activitySelect = {
  id: true,
  year: true,
  title: true,
  kind: true,
  plannedOn: true,
  doneOn: true,
  responsibleId: true,
  note: true,
  archivedAt: true,
  createdById: true,
} as const;

type ActivityRow = Prisma.QualityCultureActivityGetPayload<{ select: typeof activitySelect }>;

function activityAccess(ctx: AdminContext, row: ActivityRow): CultureActivityView["access"] {
  if (canManageQuality(ctx)) return "manage";
  if (row.responsibleId === ctx.tenant.membershipId) return "responsible";
  return "read";
}

function activityWhere(ctx: AdminContext): Prisma.QualityCultureActivityWhereInput {
  return canViewQuality(ctx) ? {} : { responsibleId: ctx.tenant.membershipId };
}

async function activityViews(
  ctx: AdminContext,
  rows: ActivityRow[],
): Promise<CultureActivityView[]> {
  if (rows.length === 0) return [];
  const day = await companyToday(ctx.db);
  const people = [
    ...new Set(rows.map((row) => row.responsibleId).filter((id): id is string => id !== null)),
  ];
  const members =
    people.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { id: { in: people } },
          select: { id: true, user: { select: { name: true } } },
        });
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  return rows.map((row) => ({
    id: row.id,
    year: row.year,
    title: row.title,
    kind: row.kind,
    plannedOn: dayOf(row.plannedOn),
    doneOn: row.doneOn === null ? null : dayOf(row.doneOn),
    responsible:
      row.responsibleId === null
        ? null
        : { id: row.responsibleId, name: nameOf.get(row.responsibleId) ?? "" },
    note: row.note,
    overdue: row.doneOn === null && row.archivedAt === null && dayOf(row.plannedOn) < day,
    archived: row.archivedAt !== null,
    access: activityAccess(ctx, row),
  }));
}

function surveyState(
  row: { opensOn: Date; closesOn: Date; closedAt: Date | null },
  day: string,
): SurveySummary["state"] {
  if (row.closedAt !== null || dayOf(row.closesOn) < day) return "closed";
  return dayOf(row.opensOn) > day ? "scheduled" : "open";
}

export async function cultureOverview(
  ctx: AdminContext,
  query: { year?: number | undefined },
): Promise<CultureOverview> {
  await requireCulture(ctx);
  const day = await companyToday(ctx.db);
  const year = query.year ?? Number(day.slice(0, 4));
  const view = canViewQuality(ctx);
  const [plan, rows, surveys] = await Promise.all([
    view
      ? ctx.db.qualityCulturePlan.findFirst({ where: { year }, select: { objectives: true } })
      : Promise.resolve(null),
    ctx.db.qualityCultureActivity.findMany({
      where: { AND: [{ year, archivedAt: null }, activityWhere(ctx)] },
      select: activitySelect,
      orderBy: [{ plannedOn: "asc" }, { id: "asc" }],
      take: 500,
    }),
    view
      ? ctx.db.qualityCultureSurvey.findMany({
          where: {
            opensOn: { gte: dateOf(`${String(year)}-01-01`), lte: dateOf(`${String(year)}-12-31`) },
          },
          select: {
            id: true,
            title: true,
            questions: true,
            opensOn: true,
            closesOn: true,
            closedAt: true,
            _count: { select: { answers: true } },
          },
          orderBy: [{ opensOn: "desc" }, { id: "asc" }],
          take: 50,
        })
      : Promise.resolve([]),
  ]);
  return {
    year,
    objectives: plan?.objectives ?? "",
    activities: await activityViews(ctx, rows),
    surveys: surveys.map((survey) => ({
      id: survey.id,
      title: survey.title,
      questions: survey.questions.length,
      opensOn: dayOf(survey.opensOn),
      closesOn: dayOf(survey.closesOn),
      state: surveyState(survey, day),
      answers: survey._count.answers,
    })),
    canManage: canManageQuality(ctx),
  };
}

export async function saveCulturePlan(
  ctx: AdminContext,
  year: number,
  input: CulturePlanInput,
): Promise<{ year: number; objectives: string }> {
  await requireCulture(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.qualityCulturePlan.upsert({
    where: { workspaceId_year: { workspaceId: ctx.db.workspaceId, year } },
    create: { year, objectives: input.objectives },
    update: { objectives: input.objectives },
    select: { year: true },
  });
  await auditAdmin(ctx, {
    action: "quality.culture.plan",
    entityType: "QualityCulturePlan",
    entityId: String(year),
  });
  return { year, objectives: input.objectives };
}

async function loadActivity(ctx: AdminContext, id: string): Promise<ActivityRow> {
  await requireCulture(ctx);
  const row = await ctx.db.qualityCultureActivity.findFirst({
    where: { AND: [{ id }, activityWhere(ctx)] },
    select: activitySelect,
  });
  if (row === null) throw notFound();
  return row;
}

async function oneActivity(ctx: AdminContext, id: string): Promise<CultureActivityView> {
  const [view] = await activityViews(ctx, [await loadActivity(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

/** The activity's expiry: to its responsible person (or whoever planned it) until it's done. */
async function syncActivityExpiry(db: TenantDb, row: ActivityRow): Promise<void> {
  if (row.doneOn !== null || row.archivedAt !== null) {
    await resolveExpiry(db, CULTURE_EXPIRY, row.id);
    return;
  }
  await setExpiry(db, {
    kind: CULTURE_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.plannedOn),
    responsibleId: row.responsibleId ?? row.createdById,
    noticeDays: [...NOTICE_DAYS],
  });
}

export async function createCultureActivity(
  ctx: AdminContext,
  input: CultureActivityInput,
): Promise<CultureActivityView> {
  await requireCulture(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  await assertMember(ctx.db, input.responsibleId);
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qualityCultureActivity.create({
      data: {
        year: input.year,
        title: input.title,
        kind: input.kind,
        plannedOn: dateOf(input.plannedOn),
        responsibleId: input.responsibleId,
        note: input.note ?? null,
        createdById: ctx.tenant.membershipId,
      },
      select: activitySelect,
    });
    await syncActivityExpiry(tx, created);
    return created.id;
  });
  await auditAdmin(ctx, {
    action: "quality.culture.activity.create",
    entityType: "QualityCultureActivity",
    entityId: id,
    metadata: { year: input.year, kind: input.kind },
  });
  return await oneActivity(ctx, id);
}

export async function updateCultureActivity(
  ctx: AdminContext,
  id: string,
  input: UpdateCultureActivityInput,
): Promise<CultureActivityView> {
  const current = await loadActivity(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.archivedAt !== null) throw notFound();
  await assertMember(ctx.db, input.responsibleId);
  const data: Prisma.QualityCultureActivityUncheckedUpdateInput = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.plannedOn === undefined ? {} : { plannedOn: dateOf(input.plannedOn) }),
    ...(input.responsibleId === undefined ? {} : { responsibleId: input.responsibleId }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityCultureActivity.update({
      where: { id },
      data,
      select: activitySelect,
    });
    await syncActivityExpiry(tx, updated);
  });
  await auditAdmin(ctx, {
    action: "quality.culture.activity.update",
    entityType: "QualityCultureActivity",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await oneActivity(ctx, id);
}

/** Done on a day (quality.manage or its responsible person), or back to pending with null. */
export async function setCultureActivityDone(
  ctx: AdminContext,
  id: string,
  doneOn: string | null,
): Promise<CultureActivityView> {
  const current = await loadActivity(ctx, id);
  if (activityAccess(ctx, current) === "read") throw forbidden();
  if (current.archivedAt !== null) throw notFound();
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.qualityCultureActivity.update({
      where: { id },
      data: { doneOn: doneOn === null ? null : dateOf(doneOn) },
      select: activitySelect,
    });
    await syncActivityExpiry(tx, updated);
  });
  await auditAdmin(ctx, {
    action: doneOn === null ? "quality.culture.activity.reopen" : "quality.culture.activity.done",
    entityType: "QualityCultureActivity",
    entityId: id,
    ...(doneOn === null ? {} : { metadata: { doneOn } }),
  });
  return await oneActivity(ctx, id);
}

export async function archiveCultureActivity(
  ctx: AdminContext,
  id: string,
): Promise<{ archived: true }> {
  await loadActivity(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualityCultureActivity.update({
      where: { id },
      data: { archivedAt: new Date() },
      select: { id: true },
    });
    await resolveExpiry(tx, CULTURE_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: "quality.culture.activity.archive",
    entityType: "QualityCultureActivity",
    entityId: id,
  });
  return { archived: true };
}

// ─── Surveys ─────────────────────────────────────────────────────────────────────────────

const surveySelect = {
  id: true,
  title: true,
  questions: true,
  opensOn: true,
  closesOn: true,
  closedAt: true,
} as const;

type SurveyRow = Prisma.QualityCultureSurveyGetPayload<{ select: typeof surveySelect }>;

export interface SurveyView {
  id: string;
  title: string;
  questions: string[];
  opensOn: string;
  closesOn: string;
  state: SurveySummary["state"];
  answers: number;
  canManage: boolean;
}

async function surveyView(ctx: AdminContext, row: SurveyRow): Promise<SurveyView> {
  const [day, answers] = await Promise.all([
    companyToday(ctx.db),
    ctx.db.qualityCultureAnswer.count({ where: { surveyId: row.id } }),
  ]);
  return {
    id: row.id,
    title: row.title,
    questions: row.questions,
    opensOn: dayOf(row.opensOn),
    closesOn: dayOf(row.closesOn),
    state: surveyState(row, day),
    answers,
    canManage: canManageQuality(ctx),
  };
}

async function loadSurvey(ctx: AdminContext, id: string): Promise<SurveyRow> {
  await requireCulture(ctx);
  const row = await ctx.db.qualityCultureSurvey.findFirst({ where: { id }, select: surveySelect });
  if (row === null) throw notFound();
  return row;
}

function assertDates(opensOn: string, closesOn: string): void {
  if (closesOn < opensOn) throw new AppError("BAD_REQUEST", { message: qualityTexts.culture.datesOrder });
}

/** The ten default statements, in the company's language. */
async function defaultQuestions(db: TenantDb): Promise<string[]> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return withLocale(readWorkspaceLocale(workspace?.settings), () => [
    ...qualityTexts.surveyQuestions,
  ]);
}

export async function getSurvey(ctx: AdminContext, id: string): Promise<SurveyView> {
  const row = await loadSurvey(ctx, id);
  if (!canViewQuality(ctx)) throw forbidden();
  return await surveyView(ctx, row);
}

export async function createSurvey(ctx: AdminContext, input: SurveyInput): Promise<SurveyView> {
  await requireCulture(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  assertDates(input.opensOn, input.closesOn);
  const questions = input.questions ?? (await defaultQuestions(ctx.db));
  const created = await ctx.db.qualityCultureSurvey.create({
    data: {
      title: input.title,
      questions,
      opensOn: dateOf(input.opensOn),
      closesOn: dateOf(input.closesOn),
      createdById: ctx.tenant.membershipId,
    },
    select: surveySelect,
  });
  await auditAdmin(ctx, {
    action: "quality.culture.survey.create",
    entityType: "QualityCultureSurvey",
    entityId: created.id,
    metadata: { questions: questions.length, opensOn: input.opensOn, closesOn: input.closesOn },
  });
  return await surveyView(ctx, created);
}

/** Only while nobody has answered: after the first answer, the survey can only be closed. */
export async function updateSurvey(
  ctx: AdminContext,
  id: string,
  input: UpdateSurveyInput,
): Promise<SurveyView> {
  const current = await loadSurvey(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.closedAt !== null) throw new AppError("CONFLICT", { message: qualityTexts.culture.surveyClosed });
  const answers = await ctx.db.qualityCultureAnswer.count({ where: { surveyId: id } });
  if (answers > 0) throw new AppError("CONFLICT", { message: qualityTexts.culture.hasAnswers });
  assertDates(input.opensOn ?? dayOf(current.opensOn), input.closesOn ?? dayOf(current.closesOn));
  const updated = await ctx.db.qualityCultureSurvey.update({
    where: { id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.questions === undefined ? {} : { questions: input.questions }),
      ...(input.opensOn === undefined ? {} : { opensOn: dateOf(input.opensOn) }),
      ...(input.closesOn === undefined ? {} : { closesOn: dateOf(input.closesOn) }),
    },
    select: surveySelect,
  });
  await auditAdmin(ctx, {
    action: "quality.culture.survey.update",
    entityType: "QualityCultureSurvey",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await surveyView(ctx, updated);
}

export async function closeSurvey(ctx: AdminContext, id: string): Promise<SurveyView> {
  const current = await loadSurvey(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  if (current.closedAt !== null) return await surveyView(ctx, current);
  const updated = await ctx.db.qualityCultureSurvey.update({
    where: { id },
    data: { closedAt: new Date() },
    select: surveySelect,
  });
  await auditAdmin(ctx, {
    action: "quality.culture.survey.close",
    entityType: "QualityCultureSurvey",
    entityId: id,
  });
  return await surveyView(ctx, updated);
}

export interface PendingSurvey {
  id: string;
  title: string;
  questions: number;
  closesOn: string;
}

function openWhere(day: string): Prisma.QualityCultureSurveyWhereInput {
  return { closedAt: null, opensOn: { lte: dateOf(day) }, closesOn: { gte: dateOf(day) } };
}

/** The open surveys the person hasn't answered yet («Mis pendientes»). */
export async function pendingSurveys(ctx: AdminContext): Promise<PendingSurvey[]> {
  await requireCulture(ctx);
  const day = await companyToday(ctx.db);
  const rows = await ctx.db.qualityCultureSurvey.findMany({
    where: {
      ...openWhere(day),
      voters: { none: { membershipId: ctx.tenant.membershipId } },
    },
    select: { id: true, title: true, questions: true, closesOn: true },
    orderBy: [{ closesOn: "asc" }, { id: "asc" }],
    take: 20,
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    questions: row.questions.length,
    closesOn: dayOf(row.closesOn),
  }));
}

export interface SurveyToAnswer {
  id: string;
  title: string;
  questions: string[];
  closesOn: string;
  open: boolean;
  answered: boolean;
}

/** What the person answers: the statements, and whether they already did. */
export async function surveyToAnswer(ctx: AdminContext, id: string): Promise<SurveyToAnswer> {
  const row = await loadSurvey(ctx, id);
  const [day, voted] = await Promise.all([
    companyToday(ctx.db),
    ctx.db.qualityCultureVoter.count({
      where: { surveyId: id, membershipId: ctx.tenant.membershipId },
    }),
  ]);
  return {
    id: row.id,
    title: row.title,
    questions: row.questions,
    closesOn: dayOf(row.closesOn),
    open: surveyState(row, day) === "open",
    answered: voted > 0,
  };
}

/**
 * One answer per person while it's open. Who answered and what go to two tables with nothing linking
 * them; the audit log isn't told (it would tie a person to a time), the voters table is the record.
 */
export async function answerSurvey(
  ctx: AdminContext,
  id: string,
  input: SurveyAnswerInput,
): Promise<{ answered: true }> {
  const row = await loadSurvey(ctx, id);
  const day = await companyToday(ctx.db);
  if (surveyState(row, day) !== "open") {
    throw new AppError("CONFLICT", { message: qualityTexts.culture.surveyClosed });
  }
  if (input.scores.length !== row.questions.length) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.culture.scoresCount });
  }
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.qualityCultureVoter.create({
        data: { surveyId: id, membershipId: ctx.tenant.membershipId },
        select: { surveyId: true },
      });
      await tx.qualityCultureAnswer.create({
        data: { surveyId: id, scores: input.scores, comment: input.comment ?? null },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", { message: qualityTexts.culture.alreadyAnswered });
    }
    throw error;
  }
  return { answered: true };
}

export interface SurveyResults {
  survey: SurveyView;
  /** Active people who could answer (not guests), today. */
  eligible: number;
  answers: number;
  participation: number | null;
  /** Below the minimum nothing else is shown, so no single answer can be told apart. */
  minimum: number;
  hidden: boolean;
  average: number | null;
  questions: { text: string; average: number; distribution: number[] }[];
  comments: string[];
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    const swap = copy[index] as T;
    copy[index] = copy[other] as T;
    copy[other] = swap;
  }
  return copy;
}

const rounded = (value: number) => Math.round(value * 100) / 100;

export async function surveyResults(ctx: AdminContext, id: string): Promise<SurveyResults> {
  const row = await loadSurvey(ctx, id);
  if (!canViewQuality(ctx)) throw forbidden();
  const [survey, eligible, answers] = await Promise.all([
    surveyView(ctx, row),
    ctx.db.membership.count({ where: { status: "ACTIVE", role: { base: { not: "GUEST" } } } }),
    ctx.db.qualityCultureAnswer.findMany({
      where: { surveyId: id },
      select: { scores: true, comment: true },
      take: 20_000,
    }),
  ]);
  const minimum = qualityLimits.surveyMinAnswers;
  const participation = eligible === 0 ? null : rounded((answers.length / eligible) * 100);
  if (answers.length < minimum) {
    return {
      survey,
      eligible,
      answers: answers.length,
      participation,
      minimum,
      hidden: true,
      average: null,
      questions: [],
      comments: [],
    };
  }
  const questions = row.questions.map((text, index) => {
    const distribution = [0, 0, 0, 0, 0];
    let sum = 0;
    let count = 0;
    for (const answer of answers) {
      const score = answer.scores[index];
      if (score === undefined || score < 1 || score > 5) continue;
      distribution[score - 1] = (distribution[score - 1] ?? 0) + 1;
      sum += score;
      count += 1;
    }
    return { text, average: count === 0 ? 0 : rounded(sum / count), distribution };
  });
  const all = questions.filter((question) => question.distribution.some((n) => n > 0));
  return {
    survey,
    eligible,
    answers: answers.length,
    participation,
    minimum,
    hidden: false,
    average:
      all.length === 0
        ? null
        : rounded(all.reduce((total, question) => total + question.average, 0) / all.length),
    questions,
    comments: shuffled(
      answers
        .map((answer) => answer.comment?.trim() ?? "")
        .filter((comment) => comment.length > 0),
    ),
  };
}

/** For the dashboard: overdue activities and the last closed (or open) survey's figures. */
export async function cultureFigures(
  ctx: AdminContext,
  today: Date,
): Promise<{
  overdueActivities: number;
  lastSurvey: { id: string; title: string; participation: number | null; average: number | null } | null;
}> {
  const [overdueActivities, last] = await Promise.all([
    ctx.db.qualityCultureActivity.count({
      where: { archivedAt: null, doneOn: null, plannedOn: { lt: today } },
    }),
    ctx.db.qualityCultureSurvey.findFirst({
      where: { opensOn: { lte: today } },
      select: { id: true },
      orderBy: [{ opensOn: "desc" }, { id: "desc" }],
    }),
  ]);
  if (last === null) return { overdueActivities, lastSurvey: null };
  const results = await surveyResults(ctx, last.id);
  return {
    overdueActivities,
    lastSurvey: {
      id: last.id,
      title: results.survey.title,
      participation: results.participation,
      average: results.average,
    },
  };
}
