// Food quality, phase 6c (docs/spec/calidad.md, «Fase 6c»): the culture plan, its anonymous surveys and
// change management.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api } from "@/lib/api";

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const CULTURE_KINDS = ["TRAINING", "COMMUNICATION", "SURVEY", "MEETING", "OTHER"] as const;
export type CultureKind = (typeof CULTURE_KINDS)[number];

export interface CultureActivity {
  id: string;
  year: number;
  title: string;
  kind: CultureKind;
  plannedOn: string;
  doneOn: string | null;
  responsible: { id: string; name: string } | null;
  note: string | null;
  overdue: boolean;
  archived: boolean;
  access: "manage" | "responsible" | "read";
}

export type SurveyState = "scheduled" | "open" | "closed";

export interface SurveySummary {
  id: string;
  title: string;
  questions: number;
  opensOn: string;
  closesOn: string;
  state: SurveyState;
  answers: number;
}

export interface CultureOverview {
  year: number;
  objectives: string;
  activities: CultureActivity[];
  surveys: SurveySummary[];
  canManage: boolean;
}

export interface Survey {
  id: string;
  title: string;
  questions: string[];
  opensOn: string;
  closesOn: string;
  state: SurveyState;
  answers: number;
  canManage: boolean;
}

export interface SurveyResults {
  survey: Survey;
  eligible: number;
  answers: number;
  participation: number | null;
  minimum: number;
  hidden: boolean;
  average: number | null;
  questions: { text: string; average: number; distribution: number[] }[];
  comments: string[];
}

export interface PendingSurvey {
  id: string;
  title: string;
  questions: number;
  closesOn: string;
}

export interface SurveyToAnswer {
  id: string;
  title: string;
  questions: string[];
  closesOn: string;
  open: boolean;
  answered: boolean;
}

export interface ActivityBody {
  title: string;
  kind: CultureKind;
  plannedOn: string;
  responsibleId: string | null;
  note: string | null;
}

export interface SurveyBody {
  title: string;
  questions?: string[];
  opensOn: string;
  closesOn: string;
}

export const cultureKeys = {
  all: (slug: string) => ["w", slug, "quality", "culture"] as const,
  overview: (slug: string, year: number | undefined) =>
    ["w", slug, "quality", "culture", "overview", year ?? "current"] as const,
  survey: (slug: string, id: string) => ["w", slug, "quality", "culture", "survey", id] as const,
  results: (slug: string, id: string) =>
    ["w", slug, "quality", "culture", "survey", id, "results"] as const,
  pending: (slug: string) => ["w", slug, "quality", "culture", "pending"] as const,
  answer: (slug: string, id: string) =>
    ["w", slug, "quality", "culture", "survey", id, "answer"] as const,
};

export const cultureApi = {
  overview: (slug: string, year: number | undefined) =>
    api<CultureOverview>(
      w(slug, `/quality/culture?${listQuery({ year: year === undefined ? undefined : String(year) })}`),
    ),
  savePlan: (slug: string, year: number, objectives: string) =>
    api<{ plan: { year: number; objectives: string } }>(
      w(slug, `/quality/culture/plans/${String(year)}`),
      { method: "PUT", body: { objectives } },
    ),
  createActivity: (slug: string, body: ActivityBody & { year: number }) =>
    api<{ activity: CultureActivity }>(w(slug, "/quality/culture/activities"), {
      method: "POST",
      body,
    }),
  updateActivity: (slug: string, id: string, body: Partial<ActivityBody>) =>
    api<{ activity: CultureActivity }>(w(slug, `/quality/culture/activities/${id}`), {
      method: "PATCH",
      body,
    }),
  done: (slug: string, id: string, doneOn: string | null) =>
    api<{ activity: CultureActivity }>(w(slug, `/quality/culture/activities/${id}/done`), {
      method: "POST",
      body: { doneOn },
    }),
  archiveActivity: (slug: string, id: string) =>
    api<{ archived: true }>(w(slug, `/quality/culture/activities/${id}/archive`), {
      method: "POST",
    }),
  createSurvey: (slug: string, body: SurveyBody) =>
    api<{ survey: Survey }>(w(slug, "/quality/culture/surveys"), { method: "POST", body }),
  survey: (slug: string, id: string) =>
    api<{ survey: Survey }>(w(slug, `/quality/culture/surveys/${id}`)),
  updateSurvey: (slug: string, id: string, body: Partial<SurveyBody>) =>
    api<{ survey: Survey }>(w(slug, `/quality/culture/surveys/${id}`), { method: "PATCH", body }),
  closeSurvey: (slug: string, id: string) =>
    api<{ survey: Survey }>(w(slug, `/quality/culture/surveys/${id}/close`), { method: "POST" }),
  results: (slug: string, id: string) =>
    api<SurveyResults>(w(slug, `/quality/culture/surveys/${id}/results`)),
  pending: (slug: string) =>
    api<{ items: PendingSurvey[] }>(w(slug, "/quality/culture/surveys/pending")),
  toAnswer: (slug: string, id: string) =>
    api<{ survey: SurveyToAnswer }>(w(slug, `/quality/culture/surveys/${id}/answer`)),
  answer: (slug: string, id: string, body: { scores: number[]; comment: string | null }) =>
    api<{ answered: true }>(w(slug, `/quality/culture/surveys/${id}/answer`), {
      method: "POST",
      body,
    }),
};

export const CHANGE_KINDS = [
  "RECIPE",
  "PRODUCT",
  "LINE",
  "EQUIPMENT",
  "SUPPLIER",
  "PROCESS",
  "OTHER",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "REJECTED",
  "IMPLEMENTED",
  "CANCELLED",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_IMPACTS = ["NONE", "LOW", "HIGH"] as const;
export type ChangeImpact = (typeof CHANGE_IMPACTS)[number];
export const REVIEW_POINTS = ["haccp", "allergens", "label", "training", "validation"] as const;
export type ReviewPoint = (typeof REVIEW_POINTS)[number];
export const REVIEW_STATES = ["pending", "not_applicable", "done"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export type ChangeReview = Record<ReviewPoint, { state: ReviewState; note: string }>;

export interface ChangeSummary {
  id: string;
  code: string;
  title: string;
  kind: ChangeKind;
  status: ChangeStatus;
  impact: ChangeImpact | null;
  plannedOn: string | null;
  owner: { id: string; name: string } | null;
  proposedBy: { id: string; name: string };
  pending: number;
  overdue: boolean;
  createdAt: string;
}

export interface ChangeDetail extends ChangeSummary {
  description: string;
  product: { id: string; name: string } | null;
  review: ChangeReview;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  implementedOn: string | null;
  can: { edit: boolean; decide: boolean; implement: boolean; cancel: boolean };
}

export interface ChangeFilters {
  q?: string | undefined;
  status?: ChangeStatus | undefined;
  kind?: ChangeKind | undefined;
}

export interface ChangeBody {
  title: string;
  kind: ChangeKind;
  description: string;
  productId: string | null;
  plannedOn: string | null;
}

export interface ChangeUpdate extends Partial<ChangeBody> {
  ownerId?: string | null;
  impact?: ChangeImpact | null;
  review?: ChangeReview;
}

export const changeKeys = {
  all: (slug: string) => ["w", slug, "quality", "changes"] as const,
  list: (slug: string, filters: ChangeFilters) =>
    ["w", slug, "quality", "changes", "list", filters] as const,
  one: (slug: string, id: string) => ["w", slug, "quality", "changes", "one", id] as const,
};

export const changesApi = {
  list: (slug: string, filters: ChangeFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<ChangeSummary>>(
      w(slug, `/quality/changes?${listQuery({ ...filters, dir: "desc", cursor })}`),
      { signal },
    ),
  get: (slug: string, id: string) =>
    api<{ change: ChangeDetail }>(w(slug, `/quality/changes/${id}`)),
  propose: (slug: string, body: ChangeBody) =>
    api<{ change: ChangeDetail }>(w(slug, "/quality/changes"), { method: "POST", body }),
  update: (slug: string, id: string, body: ChangeUpdate) =>
    api<{ change: ChangeDetail }>(w(slug, `/quality/changes/${id}`), { method: "PATCH", body }),
  decide: (slug: string, id: string, body: { decision: "APPROVE" | "REJECT"; note: string | null }) =>
    api<{ change: ChangeDetail }>(w(slug, `/quality/changes/${id}/decision`), {
      method: "POST",
      body,
    }),
  implemented: (slug: string, id: string, implementedOn: string) =>
    api<{ change: ChangeDetail }>(w(slug, `/quality/changes/${id}/implemented`), {
      method: "POST",
      body: { implementedOn },
    }),
  cancel: (slug: string, id: string) =>
    api<{ change: ChangeDetail }>(w(slug, `/quality/changes/${id}/cancel`), { method: "POST" }),
};
