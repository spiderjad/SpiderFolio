// The reporter's side of the whistleblowing channel (docs/spec/canal-denuncias.md, «Anonimato y
// confidencialidad» and «Buzón del informante»): no account, nothing about their address or browser
// is kept. A follow-up code (shown once) and a password open the mailbox.
import { whistleblowingLimits } from "@spiderfolio/limits";
import { forTenant, type TenantDb } from "../../db/tenant.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { whistleblowingTexts } from "../../i18n/index.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { companyToday } from "../quality/prps.service.ts";
import { readWhistleblowingSettings } from "../workspaces/settings.ts";
import type { CaseOutcome, CaseStatus, ReportBody } from "./cases.service.ts";
import { followUpHash, newFollowUpCode } from "./codes.ts";
import {
  activeManagers,
  addMonths,
  boxOf,
  caseManagers,
  categoriesOf,
  DEADLINE_EXPIRY,
  monthsAfter,
  NOTICE_DAYS,
} from "./whistleblowing-access.ts";
import { setExpiry } from "../expiries/expiries.service.ts";
import type { AppDeps } from "../../routes.ts";

type Deps = Pick<AppDeps, "env" | "prisma" | "passwords">;

export interface ChannelPage {
  available: boolean;
  company: string;
  categories: string[];
  intro: string;
  externalChannels: string;
  /** The managers the reporter can exclude (names only), when there's more than one. */
  managers: { id: string; name: string }[];
}

const invalid = () => new AppError("BAD_REQUEST", { message: whistleblowingTexts.invalid });
const noSession = () => new AppError("UNAUTHENTICATED", { message: whistleblowingTexts.noSession });

async function companyOf(prisma: PrismaClient, slug: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, name: true, settings: true },
  });
  if (workspace === null) throw notFound();
  return workspace;
}

/** The public page: whether the form is open, the categories and the texts. */
export async function channelPage(deps: Deps, slug: string): Promise<ChannelPage> {
  const workspace = await companyOf(deps.prisma, slug);
  const settings = readWhistleblowingSettings(workspace.settings);
  if (!settings.enabled) {
    // Closed: only the external channels, never who manages it.
    return {
      available: false,
      company: workspace.name,
      categories: [],
      intro: "",
      externalChannels: settings.externalChannels,
      managers: [],
    };
  }
  const db = forTenant(deps.prisma, workspace.id);
  const ids = await activeManagers(db);
  const people = await db.membership.findMany({
    where: { id: { in: ids } },
    select: { id: true, user: { select: { name: true } } },
  });
  const names = new Map(people.map((person) => [person.id, person.user.name]));
  return {
    available: true,
    company: workspace.name,
    categories: categoriesOf(settings),
    intro: settings.intro,
    externalChannels: settings.externalChannels,
    managers: ids.length > 1 ? ids.map((id) => ({ id, name: names.get(id) ?? "" })) : [],
  };
}

export interface ReportInput {
  category: string;
  account: string;
  people: string;
  when: string;
  where: string;
  contact: { name: string; contact: string } | null;
  excluded: string[];
  password: string;
}

async function nextNumber(db: TenantDb, year: number): Promise<number> {
  const counter = await db.whistleblowingCounter.upsert({
    where: { workspaceId_year: { workspaceId: db.workspaceId, year } },
    create: { year, last: 1 },
    update: { last: { increment: 1 } },
    select: { last: true },
  });
  return counter.last;
}

/** A new report: the case, its acknowledgement, the deadline and a notice without content. */
export async function createReport(
  deps: Deps,
  slug: string,
  input: ReportInput,
): Promise<{ code: string }> {
  const workspace = await companyOf(deps.prisma, slug);
  const settings = readWhistleblowingSettings(workspace.settings);
  if (!settings.enabled) throw notFound();
  const box = boxOf(deps.env);
  if (!categoriesOf(settings).includes(input.category)) {
    throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.invalidCategory });
  }
  const db = forTenant(deps.prisma, workspace.id);
  const managers = await activeManagers(db);
  const excluded = [...new Set(input.excluded)].filter((id) => managers.includes(id));
  if (managers.length === 0 || excluded.length >= managers.length) {
    throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.keepOneVisible });
  }
  const body: ReportBody = {
    account: input.account,
    people: input.people,
    when: input.when,
    where: input.where,
    contact: input.contact,
  };
  const code = newFollowUpCode();
  const passwordHash = await deps.passwords.hash(input.password);
  const today = await companyToday(db);
  const year = Number(today.slice(0, 4));
  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, year);
    const created = await tx.whistleblowingCase.create({
      data: {
        year,
        number,
        category: input.category,
        anonymous: input.contact === null,
        bodyEnc: box.encrypt(workspace.id, JSON.stringify(body)),
        codeHash: followUpHash(workspace.id, code),
        passwordHash,
        receivedAt: now,
        acknowledgedAt: now,
        dueOn: new Date(`${addMonths(today, whistleblowingLimits.responseMonths)}T00:00:00Z`),
        purgeAfter: monthsAfter(now, whistleblowingLimits.purgeUninvestigatedMonths),
      },
      select: { id: true, dueOn: true },
    });
    for (const membershipId of excluded) {
      await tx.whistleblowingExclusion.create({
        data: { caseId: created.id, membershipId },
        select: { caseId: true },
      });
    }
    await tx.whistleblowingEvent.create({
      data: { caseId: created.id, membershipId: null, action: "received" },
      select: { id: true },
    });
    return created;
  });
  const visible = await caseManagers(db, row.id);
  await setExpiry(db, {
    kind: DEADLINE_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.dueOn),
    responsibleId: visible[0] ?? null,
    noticeDays: [...NOTICE_DAYS],
  });
  await tellManagers(db, visible, "new");
  return { code };
}

async function tellManagers(db: TenantDb, to: readonly string[], detail: string): Promise<void> {
  for (const membershipId of to) {
    await db.notification.create({
      data: { membershipId, kind: "whistleblowing", detail },
      select: { id: true },
    });
  }
}

/** Opens the mailbox. Any problem answers the same, after the same work. */
export async function enterMailbox(
  deps: Deps,
  slug: string,
  code: string,
  password: string,
): Promise<{ token: string; expiresAt: Date }> {
  const workspace = await deps.prisma.workspace.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true },
  });
  const row =
    workspace === null
      ? null
      : await deps.prisma.whistleblowingCase.findUnique({
          where: { codeHash: followUpHash(workspace.id, code) },
          select: {
            id: true,
            workspaceId: true,
            passwordHash: true,
            failedLogins: true,
            lockedUntil: true,
          },
        });
  if (row === null || workspace === null || row.workspaceId !== workspace.id) {
    await deps.passwords.verifyDummy(password);
    throw invalid();
  }
  const db = forTenant(deps.prisma, row.workspaceId);
  const now = new Date();
  if (row.lockedUntil !== null && row.lockedUntil > now) {
    await deps.passwords.verifyDummy(password);
    throw invalid();
  }
  if (!(await deps.passwords.verify(row.passwordHash, password))) {
    const failed = row.failedLogins + 1;
    const lock = failed >= whistleblowingLimits.maxFailedLogins;
    await db.whistleblowingCase.update({
      where: { id: row.id },
      data: {
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock
          ? new Date(now.getTime() + whistleblowingLimits.lockHours * 3_600_000)
          : null,
      },
      select: { id: true },
    });
    throw invalid();
  }
  if (row.failedLogins > 0 || row.lockedUntil !== null) {
    await db.whistleblowingCase.update({
      where: { id: row.id },
      data: { failedLogins: 0, lockedUntil: null },
      select: { id: true },
    });
  }
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + whistleblowingLimits.sessionIdleMinutes * 60_000);
  await db.whistleblowingSession.create({
    data: { caseId: row.id, tokenHash: sha256(token), expiresAt },
    select: { id: true },
  });
  return { token, expiresAt };
}

export interface MailboxSession {
  db: TenantDb;
  workspaceId: string;
  caseId: string;
  /** The session's new end (it's extended with each use). */
  expiresAt: Date;
}

/** The mailbox session of this request, extended; checked again on every request. */
export async function mailboxSession(
  deps: Deps,
  slug: string,
  token: string | undefined,
): Promise<MailboxSession> {
  if (token === undefined) throw noSession();
  const session = await deps.prisma.whistleblowingSession.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      workspaceId: true,
      caseId: true,
      expiresAt: true,
      endedAt: true,
      workspace: { select: { slug: true, deletedAt: true } },
    },
  });
  const now = new Date();
  if (
    session === null ||
    session.endedAt !== null ||
    session.expiresAt <= now ||
    session.workspace.slug !== slug ||
    session.workspace.deletedAt !== null
  ) {
    throw noSession();
  }
  const db = forTenant(deps.prisma, session.workspaceId);
  const expiresAt = new Date(now.getTime() + whistleblowingLimits.sessionIdleMinutes * 60_000);
  await db.whistleblowingSession.update({
    where: { id: session.id },
    data: { expiresAt },
    select: { id: true },
  });
  return { db, workspaceId: session.workspaceId, caseId: session.caseId, expiresAt };
}

export async function leaveMailbox(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  await prisma.whistleblowingSession.updateMany({
    where: { tokenHash: sha256(token), endedAt: null },
    data: { endedAt: new Date() },
  });
}

export interface MailboxView {
  category: string;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  receivedAt: Date;
  acknowledgedAt: Date;
  dueOn: string;
  extended: boolean;
  /** Why it wasn't admitted, or how it ended. */
  decision: string | null;
  purged: boolean;
  messages: { id: string; from: "REPORTER" | "MANAGEMENT"; body: string; createdAt: Date }[];
}

export async function mailboxView(deps: Deps, session: MailboxSession): Promise<MailboxView> {
  const box = boxOf(deps.env);
  const row = await session.db.whistleblowingCase.findFirst({
    where: { id: session.caseId },
    select: {
      category: true,
      status: true,
      outcome: true,
      receivedAt: true,
      acknowledgedAt: true,
      dueOn: true,
      extendedAt: true,
      decisionEnc: true,
      purgedAt: true,
    },
  });
  if (row === null) throw noSession();
  const messages = await session.db.whistleblowingMessage.findMany({
    where: { caseId: session.caseId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, from: true, bodyEnc: true, createdAt: true },
  });
  return {
    category: row.category,
    status: row.status,
    outcome: row.outcome,
    receivedAt: row.receivedAt,
    acknowledgedAt: row.acknowledgedAt,
    dueOn: dayOf(row.dueOn),
    extended: row.extendedAt !== null,
    decision: row.decisionEnc === null ? null : box.decrypt(session.workspaceId, row.decisionEnc),
    purged: row.purgedAt !== null,
    messages: messages.map((message) => ({
      id: message.id,
      from: message.from,
      body: box.decrypt(session.workspaceId, message.bodyEnc),
      createdAt: message.createdAt,
    })),
  };
}

/** The reporter writes to management: the case is marked unread and they're told (no content). */
export async function reporterMessage(
  deps: Deps,
  session: MailboxSession,
  body: string,
): Promise<void> {
  const box = boxOf(deps.env);
  const row = await session.db.whistleblowingCase.findFirst({
    where: { id: session.caseId },
    select: { purgedAt: true },
  });
  if (row === null) throw noSession();
  if (row.purgedAt !== null) {
    throw new AppError("CONFLICT", { message: whistleblowingTexts.purged });
  }
  await session.db.whistleblowingMessage.create({
    data: {
      caseId: session.caseId,
      from: "REPORTER",
      bodyEnc: box.encrypt(session.workspaceId, body),
    },
    select: { id: true },
  });
  await session.db.whistleblowingCase.update({
    where: { id: session.caseId },
    data: { unread: true },
    select: { id: true },
  });
  await session.db.whistleblowingEvent.create({
    data: { caseId: session.caseId, membershipId: null, action: "reporter_message" },
    select: { id: true },
  });
  await tellManagers(session.db, await caseManagers(session.db, session.caseId), "message");
}
