// The whistleblowing channel's API (docs/spec/canal-denuncias.md): its setup (the owner), management's
// cases (only the designated managers) and the reporter's side (guestApi: no account and no member's
// session; the mailbox has its own cookie, scoped to /api/v1/canal/:slug/mailbox).
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, guestApi } from "@/lib/api";

export const CASE_STATUSES = [
  "RECEIVED",
  "ADMITTED",
  "NOT_ADMITTED",
  "INVESTIGATING",
  "CLOSED",
] as const;
export const CASE_OUTCOMES = ["SUBSTANTIATED", "NOT_SUBSTANTIATED", "PARTIAL", "REFERRED"] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

// ─── Setup (owner) ────────────────────────────────────────────────────────────────────────

export interface ChannelManager {
  membershipId: string;
  name: string;
  email: string;
  responsible: boolean;
  eligible: boolean;
}

export interface ChannelSettings {
  enabled: boolean;
  categories: string[];
  defaultCategories: boolean;
  intro: string;
  externalChannels: string;
  retentionYears: number;
  managers: ChannelManager[];
  keyConfigured: boolean;
  ownMfa: boolean;
}

export type ChannelSettingsInput = Partial<
  Pick<ChannelSettings, "enabled" | "categories" | "intro" | "externalChannels" | "retentionYears">
>;

// ─── Management ───────────────────────────────────────────────────────────────────────────

export interface CaseSummary {
  id: string;
  code: string;
  category: string;
  status: CaseStatus;
  anonymous: boolean;
  receivedAt: string;
  dueOn: string;
  unread: boolean;
  instructorId: string | null;
}

export interface ReportBody {
  account: string;
  people: string;
  when: string;
  where: string;
  contact: { name: string; contact: string } | null;
}

export interface CaseDetail extends CaseSummary {
  outcome: CaseOutcome | null;
  acknowledgedAt: string;
  decidedAt: string | null;
  decision: string | null;
  extendedAt: string | null;
  extension: string | null;
  referredAt: string | null;
  affectedInformedAt: string | null;
  closedAt: string | null;
  purged: boolean;
  report: ReportBody | null;
  messages: { id: string; from: "REPORTER" | "MANAGEMENT"; body: string; createdAt: string }[];
  notes: { id: string; author: string; body: string; createdAt: string }[];
  events: { id: string; action: string; who: string | null; createdAt: string }[];
  managers: { membershipId: string; name: string; excluded: boolean }[];
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

export interface CasesFilters {
  status?: CaseStatus | undefined;
  category?: string | undefined;
  sort?: "receivedAt" | "dueOn";
  dir?: "asc" | "desc";
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const channelKeys = {
  all: (slug: string) => ["w", slug, "whistleblowing"] as const,
  settings: (slug: string) => ["w", slug, "whistleblowing", "settings"] as const,
  cases: (slug: string, filters: CasesFilters) =>
    ["w", slug, "whistleblowing", "cases", filters] as const,
  counts: (slug: string) => ["w", slug, "whistleblowing", "counts"] as const,
  case: (slug: string, id: string) => ["w", slug, "whistleblowing", "case", id] as const,
};

export const channelApi = {
  settings: (slug: string) => api<{ channel: ChannelSettings }>(w(slug, "/admin/whistleblowing")),
  saveSettings: (slug: string, body: ChannelSettingsInput) =>
    api<{ channel: ChannelSettings }>(w(slug, "/admin/whistleblowing"), { method: "PUT", body }),
  saveManagers: (slug: string, managers: { membershipId: string; responsible: boolean }[]) =>
    api<{ channel: ChannelSettings }>(w(slug, "/admin/whistleblowing/managers"), {
      method: "PUT",
      body: { managers },
    }),
  cases: (slug: string, filters: CasesFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<CaseSummary>>(
      w(slug, `/whistleblowing/cases?${listQuery({ ...filters, cursor })}`),
      { signal },
    ),
  counts: (slug: string) =>
    api<{ open: number; unread: number }>(w(slug, "/whistleblowing/counts")),
  case: (slug: string, id: string) =>
    api<{ case: CaseDetail }>(w(slug, `/whistleblowing/cases/${id}`)),
  act: (slug: string, id: string, body: CaseAction) =>
    api<{ case: CaseDetail }>(w(slug, `/whistleblowing/cases/${id}/actions`), {
      method: "POST",
      body,
    }),
};

// ─── The reporter ─────────────────────────────────────────────────────────────────────────

export interface ChannelPage {
  available: boolean;
  company: string;
  categories: string[];
  intro: string;
  externalChannels: string;
  managers: { id: string; name: string }[];
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

export interface Mailbox {
  category: string;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  receivedAt: string;
  acknowledgedAt: string;
  dueOn: string;
  extended: boolean;
  decision: string | null;
  purged: boolean;
  messages: { id: string; from: "REPORTER" | "MANAGEMENT"; body: string; createdAt: string }[];
}

const c = (slug: string, path = "") => `/canal/${encodeURIComponent(slug)}${path}`;

export const reporterKeys = {
  page: (slug: string) => ["canal", slug, "page"] as const,
  mailbox: (slug: string) => ["canal", slug, "mailbox"] as const,
};

export const reporterApi = {
  page: (slug: string) => guestApi<{ page: ChannelPage }>(c(slug)),
  report: (slug: string, body: ReportInput) =>
    guestApi<{ code: string }>(c(slug, "/reports"), { method: "POST", body }),
  login: (slug: string, code: string, password: string) =>
    guestApi<undefined>(c(slug, "/mailbox/login"), { method: "POST", body: { code, password } }),
  mailbox: (slug: string) => guestApi<{ mailbox: Mailbox }>(c(slug, "/mailbox")),
  write: (slug: string, body: string) =>
    guestApi<{ mailbox: Mailbox }>(c(slug, "/mailbox/messages"), {
      method: "POST",
      body: { body },
    }),
  logout: (slug: string) => guestApi<undefined>(c(slug, "/mailbox/logout"), { method: "POST" }),
};
