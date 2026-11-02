// The expiry engine (docs/spec/seguridad-salud.md, «Motor de vencimientos»): a date that expires on any
// kind of item, with notices. Each user of the engine registers its kind (who is told, how the item is
// named and where the notice leads) and sets or resolves the expiry of its items.
import type { TenantDb } from "../../db/tenant.ts";
import type { Expiry } from "../../generated/prisma/client.ts";
import { cleanNoticeDays } from "./expiry-rules.ts";

export const DEFAULT_NOTICE_DAYS = [30, 7, 0] as const;

export type ExpiryRow = Pick<
  Expiry,
  "id" | "kind" | "subjectId" | "membershipId" | "responsibleId" | "dueOn"
>;

export interface ExpiryKind {
  /**
   * What the item is called (in the active language) and the app path the notice opens; null when the
   * item no longer exists or no longer applies (then the expiry is resolved and nobody is told).
   */
  describe: (
    db: TenantDb,
    expiry: ExpiryRow,
    workspace: { slug: string },
  ) => Promise<{ what: string; path: string } | null>;
  /** Who is told (memberships); by default whoever is responsible and the person it is about. */
  recipients?: (db: TenantDb, expiry: ExpiryRow) => Promise<string[]>;
  /** While true for a company (its module is off), no notices go out and nothing is resolved. */
  paused?: (db: TenantDb) => Promise<boolean>;
}

const kinds = new Map<string, ExpiryKind>();

/** Registers a kind of item («safety.ppe», «node»…): an unregistered kind gives no notices. */
export function registerExpiryKind(kind: string, definition: ExpiryKind): void {
  kinds.set(kind, definition);
}

export function expiryKindOf(kind: string): ExpiryKind | undefined {
  return kinds.get(kind);
}

/** «YYYY-MM-DD» as the DATE column stores it. */
const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** The DATE column as a «YYYY-MM-DD» company day. */
export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

export interface SetExpiryInput {
  kind: string;
  subjectId: string;
  /** The company day it expires on («YYYY-MM-DD»). */
  dueOn: string;
  membershipId?: string | null;
  responsibleId?: string | null;
  noticeDays?: readonly number[];
}

/**
 * Creates the item's expiry or changes it. Moving the date (or bringing back a resolved one) arms the
 * notices again.
 */
export async function setExpiry(db: TenantDb, input: SetExpiryInput): Promise<ExpiryRow> {
  const noticeDays = cleanNoticeDays(input.noticeDays ?? DEFAULT_NOTICE_DAYS);
  const select = {
    id: true,
    kind: true,
    subjectId: true,
    membershipId: true,
    responsibleId: true,
    dueOn: true,
  } as const;
  const current = await db.expiry.findFirst({
    where: { kind: input.kind, subjectId: input.subjectId },
    select: { id: true, dueOn: true, resolvedAt: true, noticeDays: true },
  });
  const people = {
    ...(input.membershipId === undefined ? {} : { membershipId: input.membershipId }),
    ...(input.responsibleId === undefined ? {} : { responsibleId: input.responsibleId }),
  };
  if (current === null) {
    return await db.expiry.create({
      data: {
        kind: input.kind,
        subjectId: input.subjectId,
        dueOn: dateOf(input.dueOn),
        noticeDays,
        ...people,
      },
      select,
    });
  }
  const rearm =
    dayOf(current.dueOn) !== input.dueOn ||
    current.resolvedAt !== null ||
    current.noticeDays.join() !== noticeDays.join();
  return await db.expiry.update({
    where: { id: current.id },
    data: {
      dueOn: dateOf(input.dueOn),
      noticeDays,
      ...people,
      ...(rearm ? { noticesSent: [], resolvedAt: null } : {}),
    },
    select,
  });
}

/** Renewed, replaced or no longer applies: no more notices. Nothing happens if it has none. */
export async function resolveExpiry(db: TenantDb, kind: string, subjectId: string): Promise<void> {
  await db.expiry.updateMany({
    where: { kind, subjectId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

/** By default: whoever is responsible and the person it is about. */
export function defaultRecipients(expiry: ExpiryRow): string[] {
  return [
    ...new Set(
      [expiry.responsibleId, expiry.membershipId].filter((id): id is string => id !== null),
    ),
  ];
}
