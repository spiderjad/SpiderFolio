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
  "LAB",
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
  audit: { id: string; title: string; clause: string } | null;
  supplier: { id: string; name: string } | null;
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
  supplierId?: string | null;
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
  responseDays: number;
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
    body: {
      enabled?: boolean;
      standards?: ("IFS8" | "BRCGS9")[];
      verifyDays?: number;
      responseDays?: number;
    },
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

// ─── Phase 3: audits ─────────────────────────────────────────────────────────────────────

export const AUDIT_SCHEMES = ["INTERNAL", "IFS8", "BRCGS9", "CLIENT", "OFFICIAL", "OTHER"] as const;
export type AuditScheme = (typeof AUDIT_SCHEMES)[number];
export type Standard = "IFS8" | "BRCGS9";

export interface Finding {
  id: string;
  clause: string;
  description: string;
  severity: Severity;
  nc: { id: string; code: string; status: NcStatus } | null;
  createdAt: string;
}

export interface Audit {
  id: string;
  scheme: AuditScheme;
  title: string;
  scope: string | null;
  plannedOn: string;
  doneOn: string | null;
  auditor: string | null;
  lead: Person | null;
  chapters: string[];
  status: "PLANNED" | "DONE" | "CANCELLED";
  result: string | null;
  room: { id: string; name: string } | null;
  cancelReason: string | null;
  findings: { total: number; openNcs: number };
  access: "manage" | "lead" | "read";
}

export interface AuditDetail extends Audit {
  findingItems: Finding[];
}

export interface AuditInput {
  scheme: AuditScheme;
  title: string;
  scope: string | null;
  plannedOn: string;
  auditor: string | null;
  leadId: string | null;
  chapters: string[];
  auditRoomId: string | null;
}

export interface Coverage {
  standard: Standard;
  chapters: { number: number; audits: string[] }[];
}

export const auditKeys = {
  list: (slug: string, year: number) => ["w", slug, "quality", "audits", year] as const,
  coverage: (slug: string, year: number) =>
    ["w", slug, "quality", "audits", "coverage", year] as const,
  one: (slug: string, id: string) => ["w", slug, "quality", "audit", id] as const,
};

export const auditsApi = {
  list: (slug: string, year: number) =>
    api<{ items: Audit[] }>(w(slug, `/quality/audits?year=${String(year)}`)),
  coverage: (slug: string, year: number) =>
    api<{ standards: Coverage[] }>(w(slug, `/quality/audits/coverage?year=${String(year)}`)),
  get: (slug: string, id: string) => api<{ audit: AuditDetail }>(w(slug, `/quality/audits/${id}`)),
  create: (slug: string, body: AuditInput) =>
    api<{ audit: AuditDetail }>(w(slug, "/quality/audits"), { method: "POST", body }),
  update: (slug: string, id: string, body: Partial<AuditInput>) =>
    api<{ audit: AuditDetail }>(w(slug, `/quality/audits/${id}`), { method: "PATCH", body }),
  close: (slug: string, id: string, body: { doneOn: string; result: string | null }) =>
    api<{ audit: AuditDetail }>(w(slug, `/quality/audits/${id}/done`), { method: "POST", body }),
  cancel: (slug: string, id: string, reason: string) =>
    api<{ audit: AuditDetail }>(w(slug, `/quality/audits/${id}/cancel`), {
      method: "POST",
      body: { reason },
    }),
  addFinding: (
    slug: string,
    id: string,
    body: {
      clause: string;
      description: string;
      severity: Severity;
      openNc: boolean;
      ownerId: string | null;
    },
  ) =>
    api<{ audit: AuditDetail }>(w(slug, `/quality/audits/${id}/findings`), {
      method: "POST",
      body,
    }),
  findingNc: (slug: string, findingId: string) =>
    api<{ audit: AuditDetail }>(w(slug, `/quality/findings/${findingId}/nc`), {
      method: "POST",
      body: { ownerId: null },
    }),
};

// ─── Phase 4: suppliers ──────────────────────────────────────────────────────────────────

export const SUPPLIER_CATEGORIES = [
  "RAW_MATERIAL",
  "INGREDIENT",
  "PACKAGING",
  "SERVICE",
  "OTHER",
] as const;
export const RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export const SUPPLIER_STATUSES = ["PENDING", "APPROVED", "CONDITIONAL", "BLOCKED"] as const;
export const SUPPLIER_DOC_KINDS = [
  "CERT_IFS",
  "CERT_BRCGS",
  "CERT_OTHER",
  "SPEC_SHEET",
  "QUESTIONNAIRE",
  "ANALYSIS",
  "OTHER",
] as const;
export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];
export type Risk = (typeof RISKS)[number];
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
export type SupplierDocKind = (typeof SUPPLIER_DOC_KINDS)[number];
export type DocState = "valid" | "due_soon" | "expired" | "no_expiry";

export interface Supplier {
  id: string;
  name: string;
  taxId: string | null;
  category: SupplierCategory;
  supplies: string;
  risk: Risk;
  fraudRisk: Risk;
  fraudNote: string | null;
  contact: string | null;
  owner: Person | null;
  status: SupplierStatus;
  nextReviewOn: string | null;
  reviewDue: boolean;
  archived: boolean;
  certificates: DocState | null;
  access: "manage" | "owner" | "read";
}

export interface SupplierDetail extends Supplier {
  docs: {
    id: string;
    kind: SupplierDocKind;
    name: string;
    file: { id: string; name: string; spaceId: string; parentId: string | null } | null;
    validUntil: string | null;
    state: DocState;
    archived: boolean;
  }[];
  reviews: {
    id: string;
    reviewedOn: string;
    scores: Record<string, number>;
    result: SupplierStatus;
    note: string;
    by: Person;
  }[];
  ncs: { id: string; code: string; title: string; status: NcStatus; severity: Severity }[];
  folder: { id: string; spaceId: string } | null;
}

export interface SupplierInput {
  name: string;
  taxId: string | null;
  category: SupplierCategory;
  supplies: string;
  risk: Risk;
  fraudRisk: Risk;
  fraudNote: string | null;
  contact: string | null;
  ownerId: string | null;
}

export interface SupplierFilters {
  q?: string | undefined;
  status?: SupplierStatus | "archived" | undefined;
  category?: SupplierCategory | undefined;
  risk?: Risk | undefined;
}

export const supplierKeys = {
  list: (slug: string, filters: SupplierFilters) =>
    ["w", slug, "quality", "suppliers", filters] as const,
  one: (slug: string, id: string) => ["w", slug, "quality", "supplier", id] as const,
  files: (slug: string, id: string) => ["w", slug, "quality", "supplier", id, "files"] as const,
};

export const suppliersApi = {
  list: (slug: string, filters: SupplierFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<Supplier>>(w(slug, `/quality/suppliers?${listQuery({ ...filters, cursor })}`), {
      signal,
    }),
  get: (slug: string, id: string) =>
    api<{ supplier: SupplierDetail }>(w(slug, `/quality/suppliers/${id}`)),
  create: (slug: string, body: SupplierInput) =>
    api<{ supplier: SupplierDetail }>(w(slug, "/quality/suppliers"), { method: "POST", body }),
  update: (slug: string, id: string, body: Partial<SupplierInput>) =>
    api<{ supplier: SupplierDetail }>(w(slug, `/quality/suppliers/${id}`), {
      method: "PATCH",
      body,
    }),
  archive: (slug: string, id: string, archived: boolean) =>
    api<{ supplier: SupplierDetail }>(w(slug, `/quality/suppliers/${id}/archive`), {
      method: "POST",
      body: { archived },
    }),
  folder: (slug: string, id: string) =>
    api<{ folder: { id: string; spaceId: string } }>(w(slug, `/quality/suppliers/${id}/folder`), {
      method: "POST",
    }),
  files: (slug: string, id: string) =>
    api<{ items: { id: string; name: string }[] }>(w(slug, `/quality/suppliers/${id}/files`)),
  addDoc: (
    slug: string,
    id: string,
    body: { kind: SupplierDocKind; name: string; nodeId: string | null; validUntil: string | null },
  ) =>
    api<{ supplier: SupplierDetail }>(w(slug, `/quality/suppliers/${id}/docs`), {
      method: "POST",
      body,
    }),
  archiveDoc: (slug: string, docId: string) =>
    api<{ supplier: SupplierDetail }>(w(slug, `/quality/supplier-docs/${docId}/archive`), {
      method: "POST",
    }),
  review: (
    slug: string,
    id: string,
    body: {
      reviewedOn: string;
      scores: { quality: number; service: number; documents: number; incidents: number };
      result: Exclude<SupplierStatus, "PENDING">;
      note: string;
    },
  ) =>
    api<{ supplier: SupplierDetail }>(w(slug, `/quality/suppliers/${id}/reviews`), {
      method: "POST",
      body,
    }),
};

// ─── Phase 5: complaints, crisis and recall ──────────────────────────────────────────────

export const COMPLAINT_SOURCES = ["CUSTOMER", "CONSUMER", "AUTHORITY"] as const;
export const COMPLAINT_CATEGORIES = [
  "FOREIGN_BODY",
  "ALLERGEN",
  "MICROBIOLOGICAL",
  "QUALITY",
  "LABELLING",
  "PACKAGING",
  "OTHER",
] as const;
export const CRISIS_CONTACT_KINDS = [
  "AUTHORITY",
  "CUSTOMER",
  "INSURER",
  "LAB",
  "SUPPLIER",
  "OTHER",
] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export type ComplaintStatus = "OPEN" | "ANSWERED" | "CLOSED";

export interface Complaint {
  id: string;
  source: ComplaintSource;
  from: string;
  contact: string | null;
  product: string;
  lot: string | null;
  category: ComplaintCategory;
  description: string;
  receivedOn: string;
  respondBy: string;
  overdue: boolean;
  respondedOn: string | null;
  response: string | null;
  justified: boolean | null;
  status: ComplaintStatus;
  owner: Person;
  nc: { id: string; code: string; status: NcStatus } | null;
  access: "manage" | "owner" | "read";
}

export interface ComplaintFilters {
  status?: ComplaintStatus | "overdue" | "all" | undefined;
  category?: ComplaintCategory | undefined;
  source?: ComplaintSource | undefined;
}

export interface ComplaintIndicators {
  months: { month: string; complaints: number; units: number | null; perMillion: number | null }[];
  categories: { category: ComplaintCategory; complaints: number }[];
  total: { complaints: number; units: number | null; perMillion: number | null; justified: number };
}

export interface Crisis {
  team: { id: string; person: Person; role: string }[];
  contacts: {
    id: string;
    kind: (typeof CRISIS_CONTACT_KINDS)[number];
    name: string;
    organization: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  }[];
  tests: {
    id: string;
    kind: "DRILL" | "REAL";
    date: string;
    product: string;
    lot: string;
    direction: "BACKWARD" | "FORWARD" | "BOTH";
    minutes: number;
    recoveredPercent: number | null;
    result: string;
    by: Person;
  }[];
  nextTestOn: string | null;
  spaceId: string | null;
}

export const complaintKeys = {
  list: (slug: string, filters: ComplaintFilters) =>
    ["w", slug, "quality", "complaints", filters] as const,
  one: (slug: string, id: string) => ["w", slug, "quality", "complaint", id] as const,
  indicators: (slug: string, year: number) =>
    ["w", slug, "quality", "complaints", "indicators", year] as const,
  crisis: (slug: string) => ["w", slug, "quality", "crisis"] as const,
};

export const complaintsApi = {
  list: (
    slug: string,
    filters: ComplaintFilters,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    api<CursorPage<Complaint>>(
      w(slug, `/quality/complaints?${listQuery({ ...filters, cursor })}`),
      { signal },
    ),
  get: (slug: string, id: string) =>
    api<{ complaint: Complaint }>(w(slug, `/quality/complaints/${id}`)),
  create: (
    slug: string,
    body: {
      source: ComplaintSource;
      from: string;
      contact: string | null;
      product: string;
      lot: string | null;
      category: ComplaintCategory;
      description: string;
      receivedOn: string;
      ownerId: string | null;
    },
  ) => api<{ complaint: Complaint }>(w(slug, "/quality/complaints"), { method: "POST", body }),
  answer: (
    slug: string,
    id: string,
    body: { response: string; justified: boolean; respondedOn: string },
  ) =>
    api<{ complaint: Complaint }>(w(slug, `/quality/complaints/${id}/answer`), {
      method: "POST",
      body,
    }),
  close: (slug: string, id: string) =>
    api<{ complaint: Complaint }>(w(slug, `/quality/complaints/${id}/close`), { method: "POST" }),
  nc: (slug: string, id: string, body: { severity: Severity; ownerId: string | null }) =>
    api<{ complaint: Complaint }>(w(slug, `/quality/complaints/${id}/nc`), {
      method: "POST",
      body,
    }),
  indicators: (slug: string, year: number) =>
    api<ComplaintIndicators>(w(slug, `/quality/complaints/indicators?year=${String(year)}`)),
  units: (slug: string, month: string, units: number) =>
    api<undefined>(w(slug, "/quality/units"), { method: "PUT", body: { month, units } }),
  crisis: (slug: string) => api<{ crisis: Crisis }>(w(slug, "/quality/crisis")),
  addMember: (slug: string, membershipId: string, role: string) =>
    api<{ crisis: Crisis }>(w(slug, "/quality/crisis/members"), {
      method: "POST",
      body: { membershipId, role },
    }),
  removeMember: (slug: string, id: string) =>
    api<{ crisis: Crisis }>(w(slug, `/quality/crisis/members/${id}`), { method: "DELETE" }),
  addContact: (
    slug: string,
    body: {
      kind: (typeof CRISIS_CONTACT_KINDS)[number];
      name: string;
      organization: string | null;
      phone: string | null;
      email: string | null;
      notes: string | null;
    },
  ) => api<{ crisis: Crisis }>(w(slug, "/quality/crisis/contacts"), { method: "POST", body }),
  archiveContact: (slug: string, id: string) =>
    api<{ crisis: Crisis }>(w(slug, `/quality/crisis/contacts/${id}/archive`), {
      method: "POST",
    }),
  addTest: (
    slug: string,
    body: {
      kind: "DRILL" | "REAL";
      date: string;
      product: string;
      lot: string;
      direction: "BACKWARD" | "FORWARD" | "BOTH";
      minutes: number;
      recoveredPercent: number | null;
      result: string;
    },
  ) => api<{ crisis: Crisis }>(w(slug, "/quality/recall-tests"), { method: "POST", body }),
};

// Prerequisite programmes and the dashboard (docs/spec/calidad.md, «Fase 6a»).
export const PRP_KINDS = [
  "CLEANING",
  "PEST",
  "WATER",
  "CALIBRATION",
  "GLASS",
  "WASTE",
  "OTHER",
] as const;
export type PrpKind = (typeof PRP_KINDS)[number];
export type PrpState = "ok" | "due_soon" | "overdue";

export interface Prp {
  id: string;
  kind: PrpKind;
  name: string;
  location: string | null;
  everyDays: number;
  responsible: { id: string; name: string } | null;
  form: { id: string; name: string; spaceId: string } | null;
  lastDoneOn: string | null;
  nextDueOn: string;
  state: PrpState;
  notes: string | null;
  archived: boolean;
  access: "manage" | "responsible" | "read";
}

export interface PrpCheck {
  id: string;
  doneOn: string;
  conforming: boolean;
  note: string | null;
  nc: { id: string; code: string } | null;
  by: { id: string; name: string };
}

export interface PrpBody {
  kind: PrpKind;
  name: string;
  location: string | null;
  everyDays: number;
  responsibleId: string | null;
  formId: string | null;
  nextDueOn: string;
  notes: string | null;
}

export interface QualityDashboard {
  ncs: {
    bySeverity: Record<Severity, number>;
    byOrigin: { origin: (typeof NC_ORIGINS)[number]; count: number }[];
    overdueActions: number;
    verificationsDue: number;
    averageCloseDays: number | null;
  };
  haccp: { records: number; outOfLimits: number; holdsPending: number };
  suppliers: { docsExpired: number; docsExpiring: number; reviewsOverdue: number };
  complaints: { open: number; overdue: number; perMillion: number | null; year: number };
  audits: {
    upcoming: { id: string; title: string; scheme: string; plannedOn: string }[];
    coverage: { standard: "IFS8" | "BRCGS9"; covered: number; chapters: number }[];
  };
  prps: { overdue: number; dueSoon: number; nonConforming: number };
}

export const prpKeys = {
  list: (slug: string, filters: { kind?: PrpKind; archived?: boolean }) =>
    ["w", slug, "quality", "prps", filters] as const,
  checks: (slug: string, id: string) => ["w", slug, "quality", "prp", id, "checks"] as const,
  dashboard: (slug: string) => ["w", slug, "quality", "dashboard"] as const,
};

export const prpsApi = {
  list: (slug: string, filters: { kind?: PrpKind; archived?: boolean }) =>
    api<{ prps: Prp[] }>(
      w(
        slug,
        `/quality/prps?${listQuery({ kind: filters.kind, archived: filters.archived === true ? "1" : undefined })}`,
      ),
    ),
  create: (slug: string, body: PrpBody) =>
    api<{ prp: Prp }>(w(slug, "/quality/prps"), { method: "POST", body }),
  update: (slug: string, id: string, body: PrpBody) =>
    api<{ prp: Prp }>(w(slug, `/quality/prps/${id}`), { method: "PATCH", body }),
  archive: (slug: string, id: string, archived: boolean) =>
    api<{ prp: Prp }>(w(slug, `/quality/prps/${id}/${archived ? "archive" : "restore"}`), {
      method: "POST",
    }),
  checks: (slug: string, id: string) =>
    api<{ checks: PrpCheck[] }>(w(slug, `/quality/prps/${id}/checks`)),
  check: (
    slug: string,
    id: string,
    body: {
      doneOn: string;
      conforming: boolean;
      note: string | null;
      openNc: boolean;
      severity: Severity;
    },
  ) => api<{ prp: Prp }>(w(slug, `/quality/prps/${id}/checks`), { method: "POST", body }),
  dashboard: (slug: string) => api<QualityDashboard>(w(slug, "/quality/dashboard")),
};
