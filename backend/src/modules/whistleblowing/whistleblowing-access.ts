// Who sees the whistleblowing channel's cases (docs/spec/canal-denuncias.md, «Quién hace qué»): only
// the managers the owner designated, never by role, and never a case they're excluded from. Plus the
// encryption of everything the reporter or management writes.
import { whistleblowingLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { createSecretBox, type SecretBox } from "../../lib/secret-box.ts";
import { whistleblowingTexts } from "../../i18n/index.ts";
import type { AppDeps } from "../../routes.ts";
import { readWhistleblowingSettings, type WhistleblowingSettings } from "../workspaces/settings.ts";

export const DEADLINE_EXPIRY = "whistleblowing.deadline";

/** The encryption every case's content goes through; the channel can't be on without it. */
export function boxOf(env: AppDeps["env"]): SecretBox {
  if (env.EMAIL_ENCRYPTION_KEY === undefined) {
    throw new AppError("CONFLICT", { message: whistleblowingTexts.noKey });
  }
  return createSecretBox(env);
}

export async function channelSettingsOf(db: TenantDb): Promise<WhistleblowingSettings> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readWhistleblowingSettings(workspace?.settings);
}

/** The company's categories: its own, or the default ones. */
export function categoriesOf(settings: WhistleblowingSettings): string[] {
  return settings.categories.length > 0
    ? [...settings.categories]
    : [...whistleblowingTexts.defaultCategories];
}

/**
 * Whether a membership can manage the channel: active, with a full seat and its two-step verification
 * on. A manager who turns it off can't get in until they turn it on again.
 */
export async function eligibleManagers(
  db: TenantDb,
  membershipIds: readonly string[],
): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await db.membership.findMany({
    where: {
      id: { in: [...membershipIds] },
      status: "ACTIVE",
      seatType: "FULL",
      user: { totpEnabledAt: { not: null } },
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** The designated managers who can work now (eligible), the responsible one first. */
export async function activeManagers(db: TenantDb): Promise<string[]> {
  const rows = await db.whistleblowingManager.findMany({
    orderBy: [{ responsible: "desc" }, { addedAt: "asc" }],
    select: { membershipId: true },
  });
  const ids = rows.map((row) => row.membershipId);
  const eligible = await eligibleManagers(db, ids);
  return ids.filter((id) => eligible.has(id));
}

/** The managers who see a case: the active ones minus its exclusions. */
export async function caseManagers(db: TenantDb, caseId: string): Promise<string[]> {
  const excluded = await db.whistleblowingExclusion.findMany({
    where: { caseId },
    select: { membershipId: true },
  });
  const out = new Set(excluded.map((row) => row.membershipId));
  return (await activeManagers(db)).filter((id) => !out.has(id));
}

/**
 * The person must be an active, eligible manager. Anyone else gets 404, as if the channel didn't
 * exist: not even its existence is told to people outside management.
 */
export async function requireManager(db: TenantDb, membershipId: string): Promise<void> {
  const row = await db.whistleblowingManager.findFirst({
    where: { membershipId },
    select: { membershipId: true },
  });
  if (row === null) throw notFound();
  if (!(await eligibleManagers(db, [membershipId])).has(membershipId)) {
    throw new AppError("FORBIDDEN", { message: whistleblowingTexts.managerNotEligible });
  }
}

/** A case this manager can see (not excluded), else 404. */
export async function visibleCase<T extends object>(
  db: TenantDb,
  membershipId: string,
  caseId: string,
  select: T,
) {
  const row = await db.whistleblowingCase.findFirst({
    where: { id: caseId, exclusions: { none: { membershipId } } },
    select: { ...select, id: true },
  });
  if (row === null) throw notFound();
  return row;
}

/** «YYYY-MM-DD» plus whole months (the last day of a shorter month when it doesn't exist). */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

/** A moment plus whole months (for the purge dates). */
export function monthsAfter(from: Date, months: number): Date {
  const out = new Date(from);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export const NOTICE_DAYS = whistleblowingLimits.noticeDays;
