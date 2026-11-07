// The food quality module's API (docs/spec/calidad.md): nonconformities, their actions and checks.
// The server checks the module is on and who sees what.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

export const NC_ORIGINS = [
  "INTERNAL",
  "CCP",
  "AUDIT_INTERNAL",
  "AUDIT_EXTERNAL",
  "COMPLAINT",
  "SUPPLIER",
  "OTHER",
] as const;
export const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR"] as const;
export const NC_STATUSES = [
  "OPEN",
  "ANALYSIS",
  "ACTIONS",
  "VERIFICATION",
  "CLOSED",
  "CANCELLED",
] as const;
export const ACTION_KINDS = ["CORRECTION", "CORRECTIVE", "PREVENTIVE"] as const;
export const ISHIKAWA_BRANCHES = [
  "people",
  "method",
  "machine",
  "material",
  "measurement",
  "environment",
] as const;

export type NcOrigin = (typeof NC_ORIGINS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type NcStatus = (typeof NC_STATUSES)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];
export type CauseMethod = "FIVE_WHYS" | "ISHIKAWA" | "OTHER";
export type IshikawaBranch = (typeof ISHIKAWA_BRANCHES)[number];

interface Person {
  id: string;
  name: string;
}

export interface NcSummary {
  id: string;
  code: string;
  title: string;
  origin: NcOrigin;
  severity: Severity;
  status: NcStatus;
  detectedOn: string;
  owner: Person;
  department: { id: string; name: string } | null;
  actions: { total: number; open: number; overdue: number };
  createdAt: string;
}

export interface QualityAction {
  id: string;
  nc: { id: string; code: string; title: string };
  kind: ActionKind;
  description: string;
  responsible: Person;
  dueOn: string;
  overdue: boolean;
  done: { at: string; by: Person | null; note: string | null } | null;
  canEdit: boolean;
  canComplete: boolean;
}

export interface NcDetail extends NcSummary {
  description: string;
  location: string | null;
  record: { id: string; formId: string; spaceId: string; label: string } | null;
  fieldIds: string[];
  productAffected: boolean;
  productNote: string | null;
  correction: string | null;
  causeMethod: CauseMethod | null;
  causeAnalysis: unknown;
  rootCause: string | null;
  verifyOn: string | null;
  cancelReason: string | null;
  folder: { id: string; spaceId: string } | null;
  reportedBy: Person;
  closedAt: string | null;
  closedBy: Person | null;
  actionItems: QualityAction[];
  verifications: { id: string; effective: boolean; note: string; by: Person; at: string }[];
  holds: Hold[];
  access: "manage" | "edit" | "read";
}

export interface NcEvent {
  id: string;
  kind: string;
  actor: Person | null;
  data: Record<string, unknown>;
  at: string;
}

export interface NcFilters {
  q?: string | undefined;
  status?: "open" | "all" | NcStatus | undefined;
  origin?: NcOrigin | undefined;
  severity?: Severity | undefined;
  owner?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  mine?: "reported" | undefined;
  sort?: "createdAt" | "detectedOn" | "severity" | undefined;
  dir?: "asc" | "desc" | undefined;
}

export interface ActionFilters {
  status?: "open" | "overdue" | "done" | "all" | undefined;
  kind?: ActionKind | undefined;
  responsible?: string | undefined;
  mine?: "1" | undefined;
}

export interface ReportInput {
  title: string;
  description: string;
  detectedOn: string;
  location: string | null;
  productAffected: boolean;
  productNote: string | null;
  correction: string | null;
}

export interface CreateInput extends ReportInput {
  origin: NcOrigin;
  severity: Severity;
  ownerId: string;
  departmentId: string | null;
}

export interface UpdateInput {
  title?: string;
  description?: string;
  origin?: NcOrigin;
  severity?: Severity;
  detectedOn?: string;
  location?: string | null;
  departmentId?: string | null;
  ownerId?: string;
  productAffected?: boolean;
  productNote?: string | null;
  correction?: string | null;
  causeMethod?: CauseMethod | null;
  causeAnalysis?: unknown;
  rootCause?: string | null;
}

export interface ActionInput {
  kind: ActionKind;
  description: string;
  responsibleId: string;
  dueOn: string;
}

export interface QualitySummary {
  open: Record<Severity, number>;
  overdueActions: number;
  verificationsDue: number;
  latest: NcSummary[];
}

export interface QualitySettingsView {
  enabled: boolean;
  standards: ("IFS8" | "BRCGS9")[];
  verifyDays: number;
  space: { id: string; name: string } | null;
}

export interface FormQuality {
  autoNc: boolean;
  severity: Severity | null;
  owner: Person | null;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const qualityKeys = {
  all: (slug: string) => ["w", slug, "quality"] as const,
  summary: (slug: string) => ["w", slug, "quality", "summary"] as const,
  list: (slug: string, filters: NcFilters) => ["w", slug, "quality", "ncs", filters] as const,
  one: (slug: string, id: string) => ["w", slug, "quality", "nc", id] as const,
  events: (slug: string, id: string) => ["w", slug, "quality", "nc", id, "events"] as const,
  actions: (slug: string, filters: ActionFilters) =>
    ["w", slug, "quality", "actions", filters] as const,
  ofRecord: (slug: string, recordId: string) => ["w", slug, "quality", "record", recordId] as const,
  form: (slug: string, formId: string) => ["w", slug, "quality", "form", formId] as const,
  settings: (slug: string) => ["w", slug, "quality", "settings"] as const,
};

export const qualityApi = {
  summary: (slug: string) => api<QualitySummary>(w(slug, "/quality/summary")),
  list: (slug: string, filters: NcFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<NcSummary>>(w(slug, `/quality/ncs?${listQuery({ ...filters, cursor })}`), {
      signal,
    }),
  csv: (slug: string, filters: NcFilters) =>
    apiBlob(w(slug, `/quality/ncs/export?${listQuery({ ...filters })}`)),
  get: (slug: string, id: string) => api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}`)),
  events: (slug: string, id: string) =>
    api<{ items: NcEvent[] }>(w(slug, `/quality/ncs/${id}/events`)),
  create: (slug: string, body: CreateInput) =>
    api<{ nc: NcDetail }>(w(slug, "/quality/ncs"), { method: "POST", body }),
  report: (slug: string, body: ReportInput) =>
    api<{ nc: NcDetail }>(w(slug, "/quality/ncs/report"), { method: "POST", body }),
  update: (slug: string, id: string, body: UpdateInput) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}`), { method: "PATCH", body }),
  cancel: (slug: string, id: string, reason: string) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}/cancel`), {
      method: "POST",
      body: { reason },
    }),
  reopen: (slug: string, id: string, reason: string) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}/reopen`), {
      method: "POST",
      body: { reason },
    }),
  folder: (slug: string, id: string) =>
    api<{ folder: { id: string; spaceId: string } }>(w(slug, `/quality/ncs/${id}/folder`), {
      method: "POST",
    }),
  addAction: (slug: string, id: string, body: ActionInput) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}/actions`), { method: "POST", body }),
  updateAction: (slug: string, id: string, body: Partial<ActionInput>) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/actions/${id}`), { method: "PATCH", body }),
  doneAction: (slug: string, id: string) =>
    api<{ action: QualityAction }>(w(slug, `/quality/actions/${id}/done`), {
      method: "POST",
      body: {},
    }),
  actions: (
    slug: string,
    filters: ActionFilters,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    api<CursorPage<QualityAction>>(
      w(slug, `/quality/actions?${listQuery({ ...filters, cursor })}`),
      {
        signal,
      },
    ),
  setVerifyOn: (slug: string, id: string, date: string) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}/verify-on`), {
      method: "PUT",
      body: { date },
    }),
  verify: (slug: string, id: string, body: { effective: boolean; note: string }) =>
    api<{ nc: NcDetail }>(w(slug, `/quality/ncs/${id}/verifications`), { method: "POST", body }),
  fromRecord: (slug: string, recordId: string) =>
    api<{ nc: NcDetail }>(w(slug, "/quality/ncs/from-record"), {
      method: "POST",
      body: { recordId },
    }),
  ofRecord: (slug: string, recordId: string) =>
    api<{ nc: { id: string; code: string } | null }>(w(slug, `/quality/records/${recordId}/nc`)),
  form: (slug: string, formId: string) =>
    api<{ settings: FormQuality }>(w(slug, `/quality/forms/${formId}`)),
  saveForm: (
    slug: string,
    formId: string,
    body: { autoNc: boolean; severity: Severity | null; ownerId: string | null },
  ) => api<{ settings: FormQuality }>(w(slug, `/quality/forms/${formId}`), { method: "PUT", body }),
  settings: (slug: string) => api<{ quality: QualitySettingsView }>(w(slug, "/admin/quality")),
  saveSettings: (
    slug: string,
    body: { enabled?: boolean; standards?: ("IFS8" | "BRCGS9")[]; verifyDays?: number },
  ) => api<{ quality: QualitySettingsView }>(w(slug, "/admin/quality"), { method: "PUT", body }),
};

// ─── Phase 2: HACCP and product on hold ──────────────────────────────────────────────────

export const HAZARD_TYPES = ["BIOLOGICAL", "CHEMICAL", "PHYSICAL", "ALLERGEN"] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];
export const HOLD_DECISIONS = ["RELEASED", "REWORKED", "DIVERTED", "DESTROYED"] as const;
export type HoldStatus = "HELD" | (typeof HOLD_DECISIONS)[number];

export interface Ccp {
  id: string;
  code: string;
  name: string;
  step: string;
  hazard: string;
  hazardType: HazardType;
  criticalLimit: string;
  form: { id: string; name: string; spaceId: string } | null;
  frequency: string;
  responsible: Person | null;
  correctiveAction: string;
  verification: string;
  archived: boolean;
  stats: { records: number; outOfLimits: number; openNcs: number } | null;
}

export interface CcpInput {
  code: string;
  name: string;
  step: string;
  hazard: string;
  hazardType: HazardType;
  criticalLimit: string;
  formId: string | null;
  frequency: string;
  responsibleId: string | null;
  correctiveAction: string;
  verification: string;
}

export interface HaccpOverview {
  plan: { nodeId: string; code: string; name: string; spaceId: string; page: boolean } | null;
  ccps: Ccp[];
}

export interface Hold {
  id: string;
  nc: { id: string; code: string; title: string } | null;
  product: string;
  lot: string | null;
  quantity: string | null;
  location: string | null;
  reason: string;
  status: HoldStatus;
  decision: { note: string | null; by: Person; at: string; signed: boolean } | null;
  createdBy: Person;
  createdAt: string;
  canDecide: boolean;
}

export interface HoldInput {
  ncId: string | null;
  product: string;
  lot: string | null;
  quantity: string | null;
  location: string | null;
  reason: string;
}

export const haccpKeys = {
  overview: (slug: string, archived: boolean) => ["w", slug, "quality", "haccp", archived] as const,
  holds: (slug: string, status: string) => ["w", slug, "quality", "holds", status] as const,
};

export const haccpApi = {
  overview: (slug: string, archived: boolean) =>
    api<HaccpOverview>(w(slug, `/quality/haccp${archived ? "?archived=1" : ""}`)),
  createCcp: (slug: string, body: CcpInput) =>
    api<{ ccp: Ccp }>(w(slug, "/quality/ccps"), { method: "POST", body }),
  updateCcp: (slug: string, id: string, body: Partial<CcpInput>) =>
    api<{ ccp: Ccp }>(w(slug, `/quality/ccps/${id}`), { method: "PATCH", body }),
  archiveCcp: (slug: string, id: string, archived: boolean) =>
    api<{ ccp: Ccp }>(w(slug, `/quality/ccps/${id}/archive`), {
      method: "POST",
      body: { archived },
    }),
  orderCcps: (slug: string, ids: string[]) =>
    api<undefined>(w(slug, "/quality/ccps/order"), { method: "PUT", body: { ids } }),
  formOptions: (slug: string, q: string, signal?: AbortSignal) =>
    api<{ items: { id: string; name: string; space: string }[] }>(
      w(slug, `/quality/ccps/form-options?${listQuery({ q })}`),
      signal ? { signal } : {},
    ),
  template: (slug: string) =>
    api<{ forms: number; ccps: number }>(w(slug, "/admin/quality/template"), { method: "POST" }),
  holds: (slug: string, status: string, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<Hold>>(w(slug, `/quality/holds?${listQuery({ status, cursor })}`), { signal }),
  createHold: (slug: string, body: HoldInput) =>
    api<{ hold: Hold }>(w(slug, "/quality/holds"), { method: "POST", body }),
  decide: (
    slug: string,
    id: string,
    body: { status: (typeof HOLD_DECISIONS)[number]; note: string; signature: string },
  ) => api<{ hold: Hold }>(w(slug, `/quality/holds/${id}/decision`), { method: "POST", body }),
};
