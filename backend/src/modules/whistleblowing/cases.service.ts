// Management of the whistleblowing channel's cases (docs/spec/canal-denuncias.md, «Ciclo de vida»):
// only the designated managers, and never a case they're excluded from. Everything written is
// encrypted; every look and change goes to the module's own log, never to the general audit log.
import { whistleblowingLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import type { SecretBox } from "../../lib/secret-box.ts";
import { whistleblowingTexts } from "../../i18n/index.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { readWhistleblowingSettings } from "../workspaces/settings.ts";
import {
  addMonths,
  caseManagers,
  DEADLINE_EXPIRY,
  monthsAfter,
  NOTICE_DAYS,
  requireManager,
  visibleCase,
} from "./whistleblowing-access.ts";
import type { WhistleblowingParty, WhistleblowingStatus } from "../../generated/prisma/enums.ts";

export type CaseStatus = WhistleblowingStatus;
export type CaseOutcome = "SUBSTANTIATED" | "NOT_SUBSTANTIATED" | "PARTIAL" | "REFERRED";

/** What the reporter wrote (encrypted as one JSON). */
export interface ReportBody {
  account: string;
  people: string;
  when: string;
  where: string;
  /** Only when they chose to identify themselves. */
  contact: { name: string; contact: string } | null;
}

export interface CaseSummary {
  id: string;
  code: string;
  category: string;
  status: CaseStatus;
  anonymous: boolean;
  receivedAt: Date;
  dueOn: string;
  unread: boolean;
  instructorId: string | null;
}

export interface CaseDetail extends CaseSummary {
  outcome: CaseOutcome | null;
  acknowledgedAt: Date;
  decidedAt: Date | null;
  decision: string | null;
  extendedAt: Date | null;
  extension: string | null;
  referredAt: Date | null;
  affectedInformedAt: Date | null;
  closedAt: Date | null;
  purged: boolean;
  report: ReportBody | null;
  messages: { id: string; from: WhistleblowingParty; body: string; createdAt: Date }[];
  notes: { id: string; author: string; body: string; createdAt: Date }[];
  events: { id: string; action: string; who: string | null; createdAt: Date }[];
  /** The managers: who sees it (to pick the instructor) and who is excluded. */
  managers: { membershipId: string; name: string; excluded: boolean }[];
}

export interface CasesQuery {
  page: number;
  pageSize: number;
  cursor?: string | undefined;
  sort: "receivedAt" | "dueOn";
  dir: "asc" | "desc";
  status?: CaseStatus | undefined;
  category?: string | undefined;
}

const OPEN: CaseStatus[] = ["RECEIVED", "ADMITTED", "INVESTIGATING"];
/** A look at a case is logged once in this window per person. */
const VIEW_WINDOW_MS = 10 * 60_000;

const summarySelect = {
  id: true,
  year: true,
  number: true,
  category: true,
  status: true,
  anonymous: true,
  receivedAt: true,
  dueOn: true,
  unread: true,
  instructorId: true,
} as const;

type SummaryRow = Prisma.WhistleblowingCaseGetPayload<{ select: typeof summarySelect }>;

const summaryOf = (row: SummaryRow): CaseSummary => ({
  id: row.id,
  code: whistleblowingTexts.code(row.year, row.number),
  category: row.category,
  status: row.status,
  anonymous: row.anonymous,
  receivedAt: row.receivedAt,
  dueOn: dayOf(row.dueOn),
  unread: row.unread,
  instructorId: row.instructorId,
});

export interface CaseDeps {
  box: SecretBox;
}

async function event(
  db: TenantDb,
  caseId: string,
  membershipId: string | null,
  action: string,
): Promise<void> {
  await db.whistleblowingEvent.create({
    data: { caseId, membershipId, action },
    select: { id: true },
  });
}

async function namesOf(db: TenantDb, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.membership.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

/** The deadline notice goes to the instructor, or else to the first manager who sees the case. */
async function syncDeadline(
  db: TenantDb,
  row: { id: string; status: CaseStatus; dueOn: Date; instructorId: string | null },
): Promise<void> {
  if (!OPEN.includes(row.status)) {
    await resolveExpiry(db, DEADLINE_EXPIRY, row.id);
    return;
  }
  const managers = await caseManagers(db, row.id);
  const responsible =
    row.instructorId !== null && managers.includes(row.instructorId)
      ? row.instructorId
      : (managers[0] ?? null);
  await setExpiry(db, {
    kind: DEADLINE_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.dueOn),
    responsibleId: responsible,
    noticeDays: [...NOTICE_DAYS],
  });
}

export async function listCases(ctx: AdminContext, query: CasesQuery): Promise<Page<CaseSummary>> {
  const me = ctx.tenant.membershipId;
  await requireManager(ctx.db, me);
  const where: Prisma.WhistleblowingCaseWhereInput = {
    exclusions: { none: { membershipId: me } },
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.category === undefined ? {} : { category: query.category }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.whistleblowingCase.findMany({
      where,
      select: summarySelect,
      orderBy: stableOrder(
        query.sort === "dueOn" ? { dueOn: query.dir } : { receivedAt: query.dir },
      ),
      ...offsetArgs(query),
    }),
    ctx.db.whistleblowingCase.count({ where }),
  ]);
  return pageOf(rows.map(summaryOf), total, query);
}

/** How many open cases this manager sees, and how many have something unread (for the menu). */
export async function caseCounts(ctx: AdminContext): Promise<{ open: number; unread: number }> {
  const me = ctx.tenant.membershipId;
  await requireManager(ctx.db, me);
  const base = { exclusions: { none: { membershipId: me } }, status: { in: OPEN } };
  const [open, unread] = await Promise.all([
    ctx.db.whistleblowingCase.count({ where: base }),
    ctx.db.whistleblowingCase.count({ where: { ...base, unread: true } }),
  ]);
  return { open, unread };
}

const detailSelect = {
  ...summarySelect,
  outcome: true,
  bodyEnc: true,
  acknowledgedAt: true,
  decidedAt: true,
  decisionEnc: true,
  extendedAt: true,
  extensionEnc: true,
  referredAt: true,
  affectedInformedAt: true,
  closedAt: true,
  purgedAt: true,
} as const;

export async function getCase(
  ctx: AdminContext,
  deps: CaseDeps,
  caseId: string,
): Promise<CaseDetail> {
  const me = ctx.tenant.membershipId;
  await requireManager(ctx.db, me);
  const row = await visibleCase(ctx.db, me, caseId, detailSelect);
  const workspaceId = ctx.tenant.workspaceId;
  const open = (value: string | null) =>
    value === null ? null : deps.box.decrypt(workspaceId, value);

  // The look goes to the module's log (once in a while per person) and clears «unread».
  const lastLook = await ctx.db.whistleblowingEvent.findFirst({
    where: { caseId, membershipId: me, action: "viewed" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastLook === null || Date.now() - lastLook.createdAt.getTime() > VIEW_WINDOW_MS) {
    await event(ctx.db, caseId, me, "viewed");
  }
  if (row.unread) {
    await ctx.db.whistleblowingCase.update({
      where: { id: caseId },
      data: { unread: false },
      select: { id: true },
    });
  }

  const [messages, notes, events, managers, excluded] = await Promise.all([
    ctx.db.whistleblowingMessage.findMany({
      where: { caseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, from: true, bodyEnc: true, createdAt: true },
    }),
    ctx.db.whistleblowingNote.findMany({
      where: { caseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, authorId: true, bodyEnc: true, createdAt: true },
    }),
    ctx.db.whistleblowingEvent.findMany({
      where: { caseId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, action: true, membershipId: true, createdAt: true },
    }),
    ctx.db.whistleblowingManager.findMany({ select: { membershipId: true } }),
    ctx.db.whistleblowingExclusion.findMany({ where: { caseId }, select: { membershipId: true } }),
  ]);
  const out = new Set(excluded.map((entry) => entry.membershipId));
  const names = await namesOf(ctx.db, [
    ...notes.map((note) => note.authorId),
    ...events.flatMap((entry) => (entry.membershipId === null ? [] : [entry.membershipId])),
    ...managers.map((manager) => manager.membershipId),
  ]);
  const report = open(row.bodyEnc);
  return {
    ...summaryOf(row),
    unread: false,
    outcome: row.outcome,
    acknowledgedAt: row.acknowledgedAt,
    decidedAt: row.decidedAt,
    decision: open(row.decisionEnc),
    extendedAt: row.extendedAt,
    extension: open(row.extensionEnc),
    referredAt: row.referredAt,
    affectedInformedAt: row.affectedInformedAt,
    closedAt: row.closedAt,
    purged: row.purgedAt !== null,
    report: report === null ? null : (JSON.parse(report) as ReportBody),
    messages: messages.map((message) => ({
      id: message.id,
      from: message.from,
      body: deps.box.decrypt(workspaceId, message.bodyEnc),
      createdAt: message.createdAt,
    })),
    notes: notes.map((note) => ({
      id: note.id,
      author: names.get(note.authorId) ?? "",
      body: deps.box.decrypt(workspaceId, note.bodyEnc),
      createdAt: note.createdAt,
    })),
    events: events.map((entry) => ({
      id: entry.id,
      action: entry.action,
      who: entry.membershipId === null ? null : (names.get(entry.membershipId) ?? ""),
      createdAt: entry.createdAt,
    })),
    managers: managers.map((manager) => ({
      membershipId: manager.membershipId,
      name: names.get(manager.membershipId) ?? "",
      excluded: out.has(manager.membershipId),
    })),
  };
}

export type CaseAction =
  | { action: "admit" }
  | { action: "not_admit"; reason: string }
  | { action: "investigate" }
  | { action: "close"; outcome: CaseOutcome; summary: string }
  | { action: "extend"; reason: string }
  | { action: "refer" }
  | { action: "affected_informed" }
  | { action: "instructor"; membershipId: string | null }
  | { action: "note"; body: string }
  | { action: "message"; body: string }
  | { action: "recuse" };

const stateSelect = {
  id: true,
  status: true,
  dueOn: true,
  instructorId: true,
  extendedAt: true,
  purgedAt: true,
} as const;

function wrongState(): AppError {
  return new AppError("CONFLICT", { message: whistleblowingTexts.wrongState });
}

/** One change to a case, by a manager who sees it. */
export async function actOnCase(
  ctx: AdminContext,
  deps: CaseDeps,
  caseId: string,
  input: CaseAction,
): Promise<void> {
  const me = ctx.tenant.membershipId;
  await requireManager(ctx.db, me);
  const row = await visibleCase(ctx.db, me, caseId, stateSelect);
  if (row.purgedAt !== null) {
    throw new AppError("CONFLICT", { message: whistleblowingTexts.purged });
  }
  const seal = (text: string) => deps.box.encrypt(ctx.tenant.workspaceId, text);
  const isOpen = OPEN.includes(row.status);
  const now = new Date();
  const update = async (data: Prisma.WhistleblowingCaseUpdateInput) => {
    const saved = await ctx.db.whistleblowingCase.update({
      where: { id: caseId },
      data,
      select: { id: true, status: true, dueOn: true, instructorId: true },
    });
    await syncDeadline(ctx.db, saved);
  };

  switch (input.action) {
    case "admit":
      if (row.status !== "RECEIVED") throw wrongState();
      await update({ status: "ADMITTED", decidedAt: now });
      break;
    case "not_admit":
      if (row.status !== "RECEIVED") throw wrongState();
      // Not investigated: it's purged three months after it was received (art. 32.3).
      await update({ status: "NOT_ADMITTED", decidedAt: now, decisionEnc: seal(input.reason) });
      break;
    case "investigate":
      if (row.status !== "ADMITTED") throw wrongState();
      await update({ status: "INVESTIGATING", purgeAfter: null });
      break;
    case "close": {
      if (row.status !== "ADMITTED" && row.status !== "INVESTIGATING") throw wrongState();
      const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
      const years = readWhistleblowingSettings(workspace?.settings).retentionYears;
      await update({
        status: "CLOSED",
        outcome: input.outcome,
        closedAt: now,
        decisionEnc: seal(input.summary),
        purgeAfter: monthsAfter(now, years * 12),
      });
      break;
    }
    case "extend":
      if (!isOpen) throw wrongState();
      if (row.extendedAt !== null) {
        throw new AppError("CONFLICT", { message: whistleblowingTexts.alreadyExtended });
      }
      await update({
        dueOn: new Date(
          `${addMonths(dayOf(row.dueOn), whistleblowingLimits.extensionMonths)}T00:00:00Z`,
        ),
        extendedAt: now,
        extensionEnc: seal(input.reason),
      });
      break;
    case "refer":
      if (!isOpen) throw wrongState();
      await update({ referredAt: now });
      break;
    case "affected_informed":
      if (!isOpen) throw wrongState();
      await update({ affectedInformedAt: now });
      break;
    case "instructor":
      if (!isOpen) throw wrongState();
      if (
        input.membershipId !== null &&
        !(await caseManagers(ctx.db, caseId)).includes(input.membershipId)
      ) {
        throw notFound();
      }
      await update({ instructorId: input.membershipId });
      break;
    case "note":
      await ctx.db.whistleblowingNote.create({
        data: { caseId, authorId: me, bodyEnc: seal(input.body) },
        select: { id: true },
      });
      break;
    case "message":
      await ctx.db.whistleblowingMessage.create({
        data: { caseId, from: "MANAGEMENT", bodyEnc: seal(input.body) },
        select: { id: true },
      });
      break;
    case "recuse": {
      const others = (await caseManagers(ctx.db, caseId)).filter((id) => id !== me);
      if (others.length === 0) {
        throw new AppError("CONFLICT", { message: whistleblowingTexts.keepOneVisible });
      }
      await ctx.db.whistleblowingExclusion.create({
        data: { caseId, membershipId: me },
        select: { caseId: true },
      });
      if (row.instructorId === me) await update({ instructorId: null });
      else await syncDeadline(ctx.db, row);
      break;
    }
  }
  await event(ctx.db, caseId, me, input.action);
}
