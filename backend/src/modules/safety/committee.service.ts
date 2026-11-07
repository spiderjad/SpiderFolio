// Consultation and participation (docs/spec/seguridad-salud.md, «Consulta y participación»): the
// health and safety committee (prevention delegates, company representatives, the adviser and the
// secretary, each with their term), its meetings with attendees, agenda and minutes, and the agreements
// as planning measures (origin COMMITTEE). Whoever manages the module manages it; the committee's
// members read it (members, meetings, minutes and agreements) without seeing any other safety data.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { dayIn, formatUtcDay, zoneOf } from "../../lib/time-zone.ts";
import { currentLocale, readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { safetyTexts } from "../../i18n/index.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { expiryState } from "../expiries/expiry-rules.ts";
import { createPage } from "../nodes/pages.service.ts";
import { actionsOf, type ActionView } from "./actions.service.ts";
import { MANDATE_EXPIRY, MEETING_EXPIRY, MEETING_SUBJECT } from "./committee-expiry.ts";
import { canManageSafety, requireSafety } from "./safety-access.ts";
import type { SafetySettings } from "../workspaces/settings.ts";

type CommitteeRole = "DELEGATE" | "COMPANY_REP" | "ADVISOR" | "SECRETARY";
type MeetingKind = "ORDINARY" | "EXTRAORDINARY";

/** Notices before a delegate's term ends: two months, one month, a week and the day. */
const MANDATE_NOTICE_DAYS = [60, 30, 7, 0] as const;

async function requireManager(ctx: AdminContext): Promise<SafetySettings> {
  const settings = await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
  return settings;
}

async function isMember(ctx: AdminContext): Promise<boolean> {
  const rows = await ctx.db.safetyCommitteeMember.count({
    where: { membershipId: ctx.tenant.membershipId, endedAt: null },
  });
  return rows > 0;
}

/** Whoever manages the module, or a current member of the committee (read only); else 404. */
async function requireReader(ctx: AdminContext): Promise<SafetySettings> {
  const settings = await requireSafety(ctx);
  if (!canManageSafety(ctx) && !(await isMember(ctx))) throw notFound();
  return settings;
}

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

async function namesOf(ctx: AdminContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

/** What the screens can show: the committee tab is for managers and for the committee's members. */
export async function committeeAccess(
  ctx: AdminContext,
): Promise<{ manage: boolean; member: boolean }> {
  await requireSafety(ctx);
  return { manage: canManageSafety(ctx), member: await isMember(ctx) };
}

// ─── Members ─────────────────────────────────────────────────────────────────────────────

export interface CommitteeMemberView {
  id: string;
  person: { id: string; name: string };
  role: CommitteeRole;
  termStart: string | null;
  termEnd: string | null;
  /** valid / due_soon / expired for a term with an end; null without one. */
  term: "valid" | "due_soon" | "expired" | null;
  ended: boolean;
}

export interface CommitteeView {
  members: CommitteeMemberView[];
  lastMeeting: { id: string; date: string } | null;
  /** The next ordinary meeting is due before this day (three months after the last one). */
  nextMeetingBy: string | null;
  canManage: boolean;
}

const memberSelect = {
  id: true,
  membershipId: true,
  role: true,
  termStart: true,
  termEnd: true,
  endedAt: true,
} as const;

type MemberRow = Prisma.SafetyCommitteeMemberGetPayload<{ select: typeof memberSelect }>;

const roleOrder: Record<CommitteeRole, number> = {
  DELEGATE: 0,
  COMPANY_REP: 1,
  ADVISOR: 2,
  SECRETARY: 3,
};

async function memberViews(ctx: AdminContext, rows: MemberRow[]): Promise<CommitteeMemberView[]> {
  const names = await namesOf(
    ctx,
    rows.map((row) => row.membershipId),
  );
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const today = dayIn(new Date(), zoneOf(workspace?.settings));
  return rows
    .map((row) => {
      const termEnd = row.termEnd === null ? null : dayOf(row.termEnd);
      return {
        id: row.id,
        person: { id: row.membershipId, name: names.get(row.membershipId) ?? "" },
        role: row.role,
        termStart: row.termStart === null ? null : dayOf(row.termStart),
        termEnd,
        term:
          termEnd === null || row.endedAt !== null
            ? null
            : expiryState(today, termEnd, MANDATE_NOTICE_DAYS),
        ended: row.endedAt !== null,
      };
    })
    .sort(
      (a, b) =>
        roleOrder[a.role] - roleOrder[b.role] ||
        a.person.name.localeCompare(b.person.name, currentLocale()),
    );
}

export async function getCommittee(ctx: AdminContext, ended: boolean): Promise<CommitteeView> {
  await requireReader(ctx);
  const manage = canManageSafety(ctx);
  // Only managers see the committee's former members.
  const rows = await ctx.db.safetyCommitteeMember.findMany({
    where: ended && manage ? {} : { endedAt: null },
    select: memberSelect,
    take: 200,
  });
  const last = await ctx.db.safetyMeeting.findFirst({
    where: { kind: "ORDINARY" },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true, date: true },
  });
  const next = await ctx.db.expiry.findFirst({
    where: { kind: MEETING_EXPIRY, subjectId: MEETING_SUBJECT, resolvedAt: null },
    select: { dueOn: true },
  });
  return {
    members: await memberViews(ctx, rows),
    lastMeeting: last === null ? null : { id: last.id, date: dayOf(last.date) },
    nextMeetingBy: next === null ? null : dayOf(next.dueOn),
    canManage: manage,
  };
}

/** The end of a delegate's term warns whoever manages the module; anything else has no reminder. */
async function syncMandate(ctx: AdminContext, id: string): Promise<void> {
  const row = await ctx.db.safetyCommitteeMember.findFirst({ where: { id }, select: memberSelect });
  if (row === null) return;
  if (row.role === "DELEGATE" && row.termEnd !== null && row.endedAt === null) {
    await setExpiry(ctx.db, {
      kind: MANDATE_EXPIRY,
      subjectId: row.id,
      dueOn: dayOf(row.termEnd),
      membershipId: row.membershipId,
      noticeDays: MANDATE_NOTICE_DAYS,
      setById: ctx.tenant.membershipId,
    });
  } else {
    await resolveExpiry(ctx.db, MANDATE_EXPIRY, row.id);
  }
}

function assertTermOrder(start: string | null, end: string | null): void {
  if (start !== null && end !== null && end < start) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.committee.messages.termOrder });
  }
}

export async function addCommitteeMember(
  ctx: AdminContext,
  input: {
    membershipId: string;
    role: CommitteeRole;
    termStart: string | null;
    termEnd: string | null;
  },
): Promise<void> {
  await requireManager(ctx);
  assertTermOrder(input.termStart, input.termEnd);
  // The company's own people: an external guest can't sit on the committee.
  const person = await ctx.db.membership.count({
    where: { id: input.membershipId, status: "ACTIVE", role: { base: { not: "GUEST" } } },
  });
  if (person === 0) throw notFound();
  const current = await ctx.db.safetyCommitteeMember.count({
    where: { membershipId: input.membershipId, endedAt: null },
  });
  if (current > 0) {
    throw new AppError("CONFLICT", { message: safetyTexts.committee.messages.alreadyMember });
  }
  const row = await ctx.db.safetyCommitteeMember.create({
    data: {
      membershipId: input.membershipId,
      role: input.role,
      termStart: input.termStart === null ? null : dateOf(input.termStart),
      termEnd: input.termEnd === null ? null : dateOf(input.termEnd),
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await syncMandate(ctx, row.id);
  await auditAdmin(ctx, {
    action: "safety.committee.member.add",
    entityType: "SafetyCommitteeMember",
    entityId: row.id,
    metadata: { membershipId: input.membershipId, role: input.role },
  });
}

export async function updateCommitteeMember(
  ctx: AdminContext,
  id: string,
  input: {
    role?: CommitteeRole | undefined;
    termStart?: string | null | undefined;
    termEnd?: string | null | undefined;
    ended?: boolean | undefined;
  },
): Promise<void> {
  await requireManager(ctx);
  const current = await ctx.db.safetyCommitteeMember.findFirst({
    where: { id },
    select: memberSelect,
  });
  if (current === null) throw notFound();
  const start =
    input.termStart !== undefined
      ? input.termStart
      : current.termStart === null
        ? null
        : dayOf(current.termStart);
  const end =
    input.termEnd !== undefined
      ? input.termEnd
      : current.termEnd === null
        ? null
        : dayOf(current.termEnd);
  assertTermOrder(start, end);
  if (input.ended === false && current.endedAt !== null) {
    // Back in the committee: only if they aren't in it again already.
    const again = await ctx.db.safetyCommitteeMember.count({
      where: { membershipId: current.membershipId, endedAt: null },
    });
    if (again > 0) {
      throw new AppError("CONFLICT", { message: safetyTexts.committee.messages.alreadyMember });
    }
  }
  await ctx.db.safetyCommitteeMember.update({
    where: { id },
    data: {
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.termStart === undefined
        ? {}
        : { termStart: input.termStart === null ? null : dateOf(input.termStart) }),
      ...(input.termEnd === undefined
        ? {}
        : { termEnd: input.termEnd === null ? null : dateOf(input.termEnd) }),
      ...(input.ended === undefined
        ? {}
        : { endedAt: input.ended ? (current.endedAt ?? new Date()) : null }),
    },
    select: { id: true },
  });
  await syncMandate(ctx, id);
  await auditAdmin(ctx, {
    action: "safety.committee.member.update",
    entityType: "SafetyCommitteeMember",
    entityId: id,
    metadata: { changed: Object.keys(input), membershipId: current.membershipId },
  });
}

// ─── Meetings ────────────────────────────────────────────────────────────────────────────

export interface MeetingInput {
  date: string;
  kind: MeetingKind;
  attendeeIds: string[];
  agenda: string | null;
  minutesNodeId: string | null;
}

export interface MeetingView {
  id: string;
  date: string;
  kind: MeetingKind;
  attendees: { id: string; name: string; role: CommitteeRole }[];
  agenda: string | null;
  minutes: {
    id: string;
    spaceId: string;
    name: string;
    type: "PAGE" | "FILE" | "FOLDER" | "FORM";
    parentId: string | null;
  } | null;
  actions: { total: number; open: number };
  createdBy: { id: string; name: string };
  createdAt: Date;
}

const meetingSelect = {
  id: true,
  date: true,
  kind: true,
  attendeeIds: true,
  agenda: true,
  minutesNodeId: true,
  createdById: true,
  createdAt: true,
  actions: { select: { doneAt: true } },
} as const;

type MeetingRow = Prisma.SafetyMeetingGetPayload<{ select: typeof meetingSelect }>;

async function meetingViews(ctx: AdminContext, rows: MeetingRow[]): Promise<MeetingView[]> {
  const nodeIds = rows.flatMap((row) => (row.minutesNodeId === null ? [] : [row.minutesNodeId]));
  const memberIds = [...new Set(rows.flatMap((row) => row.attendeeIds))];
  const [nodes, members] = await Promise.all([
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: { id: true, name: true, spaceId: true, type: true, parentId: true },
        }),
    memberIds.length === 0
      ? Promise.resolve([])
      : ctx.db.safetyCommitteeMember.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, membershipId: true, role: true },
        }),
  ]);
  const names = await namesOf(ctx, [
    ...rows.map((row) => row.createdById),
    ...members.map((member) => member.membershipId),
  ]);
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const memberOf = new Map(members.map((member) => [member.id, member]));
  return rows.map((row) => {
    const node = row.minutesNodeId === null ? undefined : nodeOf.get(row.minutesNodeId);
    return {
      id: row.id,
      date: dayOf(row.date),
      kind: row.kind,
      attendees: row.attendeeIds.flatMap((id) => {
        const member = memberOf.get(id);
        return member === undefined
          ? []
          : [{ id, name: names.get(member.membershipId) ?? "", role: member.role }];
      }),
      agenda: row.agenda,
      minutes: node ?? null,
      actions: {
        total: row.actions.length,
        open: row.actions.filter((action) => action.doneAt === null).length,
      },
      createdBy: { id: row.createdById, name: names.get(row.createdById) ?? "" },
      createdAt: row.createdAt,
    };
  });
}

/** Attendees have to be (or have been) committee members. */
async function assertAttendees(ctx: AdminContext, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const found = await ctx.db.safetyCommitteeMember.count({ where: { id: { in: unique } } });
  if (found !== unique.length) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.committee.messages.notMember });
  }
  return unique;
}

/** The minutes: a page or a file of the module's space, not in the trash. */
async function assertMinutes(
  ctx: AdminContext,
  settings: SafetySettings,
  nodeId: string | null,
): Promise<void> {
  if (nodeId === null) return;
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { spaceId: true, type: true },
  });
  if (node === null) throw notFound();
  if (node.spaceId !== settings.spaceId || (node.type !== "PAGE" && node.type !== "FILE")) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.committee.messages.minutesOutside });
  }
}

/** The quarterly reminder: three months after the last ordinary meeting. */
async function syncMeetingExpiry(ctx: AdminContext): Promise<void> {
  const last = await ctx.db.safetyMeeting.findFirst({
    where: { kind: "ORDINARY" },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { date: true },
  });
  if (last === null) {
    await resolveExpiry(ctx.db, MEETING_EXPIRY, MEETING_SUBJECT);
    return;
  }
  const next = new Date(last.date);
  next.setUTCMonth(next.getUTCMonth() + 3);
  await setExpiry(ctx.db, {
    kind: MEETING_EXPIRY,
    subjectId: MEETING_SUBJECT,
    dueOn: dayOf(next),
    setById: ctx.tenant.membershipId,
  });
}

export async function createMeeting(ctx: AdminContext, input: MeetingInput): Promise<MeetingView> {
  const settings = await requireManager(ctx);
  const attendeeIds = await assertAttendees(ctx, input.attendeeIds);
  await assertMinutes(ctx, settings, input.minutesNodeId);
  const row = await ctx.db.safetyMeeting.create({
    data: {
      date: dateOf(input.date),
      kind: input.kind,
      attendeeIds,
      agenda: input.agenda,
      minutesNodeId: input.minutesNodeId,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await syncMeetingExpiry(ctx);
  await auditAdmin(ctx, {
    action: "safety.meeting.create",
    entityType: "SafetyMeeting",
    entityId: row.id,
    metadata: { date: input.date, kind: input.kind },
  });
  return await getMeeting(ctx, row.id);
}

export async function updateMeeting(
  ctx: AdminContext,
  id: string,
  input: { [K in keyof MeetingInput]?: MeetingInput[K] | undefined },
): Promise<MeetingView> {
  const settings = await requireManager(ctx);
  const current = await ctx.db.safetyMeeting.count({ where: { id } });
  if (current === 0) throw notFound();
  const data: Prisma.SafetyMeetingUncheckedUpdateInput = {};
  if (input.date !== undefined) data.date = dateOf(input.date);
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.attendeeIds !== undefined)
    data.attendeeIds = await assertAttendees(ctx, input.attendeeIds);
  if (input.agenda !== undefined) data.agenda = input.agenda;
  if (input.minutesNodeId !== undefined) {
    await assertMinutes(ctx, settings, input.minutesNodeId);
    data.minutesNodeId = input.minutesNodeId;
  }
  await ctx.db.safetyMeeting.update({ where: { id }, data, select: { id: true } });
  if (input.date !== undefined || input.kind !== undefined) await syncMeetingExpiry(ctx);
  await auditAdmin(ctx, {
    action: "safety.meeting.update",
    entityType: "SafetyMeeting",
    entityId: id,
    metadata: { changed: Object.keys(input) },
  });
  return await getMeeting(ctx, id);
}

export async function getMeeting(ctx: AdminContext, id: string): Promise<MeetingView> {
  await requireReader(ctx);
  const row = await ctx.db.safetyMeeting.findFirst({ where: { id }, select: meetingSelect });
  if (row === null) throw notFound();
  const [view] = await meetingViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

/** A meeting's agreements (planning measures with origin COMMITTEE), for the committee too. */
export async function meetingAgreements(ctx: AdminContext, id: string): Promise<ActionView[]> {
  await requireReader(ctx);
  const meeting = await ctx.db.safetyMeeting.count({ where: { id } });
  if (meeting === 0) throw notFound();
  return await actionsOf(ctx, { meetingId: id });
}

export async function listMeetings(
  ctx: AdminContext,
  query: {
    page: number;
    pageSize: number;
    cursor?: string | undefined;
    dir: "asc" | "desc";
    kind?: MeetingKind | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<Page<MeetingView>> {
  await requireReader(ctx);
  const where: Prisma.SafetyMeetingWhereInput = {
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          date: {
            ...(query.from === undefined ? {} : { gte: dateOf(query.from) }),
            ...(query.to === undefined ? {} : { lte: dateOf(query.to) }),
          },
        }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.safetyMeeting.findMany({
      where,
      select: meetingSelect,
      orderBy: stableOrder({ date: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.safetyMeeting.count({ where }),
  ]);
  return pageOf(await meetingViews(ctx, rows), total, query);
}

/** Pages and files of the module's space, to pick a meeting's minutes. */
export async function minutesOptions(
  ctx: AdminContext,
  query: {
    page: number;
    pageSize: number;
    cursor?: string | undefined;
    dir: "asc" | "desc";
    q?: string | undefined;
  },
): Promise<Page<{ id: string; name: string; type: "PAGE" | "FILE" }>> {
  const settings = await requireManager(ctx);
  if (settings.spaceId === undefined) return pageOf([], 0, query);
  const where: Prisma.NodeWhereInput = {
    spaceId: settings.spaceId,
    trashedAt: null,
    type: { in: ["PAGE", "FILE"] },
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" } }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.node.findMany({
      where,
      select: { id: true, name: true, type: true },
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.node.count({ where }),
  ]);
  return pageOf(
    rows.flatMap((row) =>
      row.type === "PAGE" || row.type === "FILE"
        ? [{ id: row.id, name: row.name, type: row.type }]
        : [],
    ),
    total,
    query,
  );
}

/**
 * The minutes as a new page of the module's space, from a template with the meeting's date, type,
 * attendees and agenda already written (in the company's language), linked to the meeting.
 */
export async function createMinutes(ctx: AdminContext, id: string): Promise<MeetingView> {
  const settings = await requireManager(ctx);
  if (settings.spaceId === undefined) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.committee.messages.noSpace });
  }
  const [meeting] = await meetingViews(ctx, [
    await ctx.db.safetyMeeting.findFirst({ where: { id }, select: meetingSelect }).then((row) => {
      if (row === null) throw notFound();
      return row;
    }),
  ]);
  if (meeting === undefined) throw notFound();
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const locale = readWorkspaceLocale(workspace?.settings);
  const { name, content } = withLocale(locale, () => {
    const m = safetyTexts.committee.minutes;
    const day = formatUtcDay(dateOf(meeting.date), locale);
    const roles = safetyTexts.committee.roles[settings.terms];
    const text = (value: string) => ({ type: "text", text: value });
    const paragraph = (value?: string) => ({
      type: "paragraph",
      ...(value === undefined ? {} : { content: [text(value)] }),
    });
    const heading = (value: string) => ({
      type: "heading",
      attrs: { level: 2 },
      content: [text(value)],
    });
    const list = (values: string[]) => ({
      type: "bulletList",
      content: values.map((value) => ({ type: "listItem", content: [paragraph(value)] })),
    });
    const agenda = (meeting.agenda ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return {
      name: m.title(day),
      content: {
        type: "doc",
        content: [
          paragraph(`${m.date}: ${day}`),
          paragraph(`${m.kind}: ${safetyTexts.committee.kinds[meeting.kind]}`),
          heading(m.attendees),
          meeting.attendees.length === 0
            ? paragraph(m.noAttendees)
            : list(meeting.attendees.map((person) => `${person.name} (${roles[person.role]})`)),
          heading(m.agenda),
          agenda.length === 0 ? paragraph(m.noAgenda) : list(agenda),
          heading(m.discussion),
          paragraph(),
          heading(m.agreements),
          paragraph(),
        ],
      },
    };
  });
  const page = await createPage(ctx, settings.spaceId, { name, content });
  await ctx.db.safetyMeeting.update({
    where: { id },
    data: { minutesNodeId: page.node.id },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "safety.meeting.update",
    entityType: "SafetyMeeting",
    entityId: id,
    metadata: { changed: ["minutesNodeId"], minutesCreated: page.node.id },
  });
  return await getMeeting(ctx, id);
}
