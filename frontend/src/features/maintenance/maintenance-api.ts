// The maintenance module's API (docs/spec/mantenimiento.md): equipment, work orders and their actions.
// The server checks the module is on and who sees what.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

export const WORK_KINDS = [
  "CORRECTIVE",
  "PREVENTIVE",
  "CALIBRATION",
  "IMPROVEMENT",
  "SAFETY",
  "HYGIENE",
] as const;
export const PLAN_UNITS = ["DAYS", "WEEKS", "MONTHS"] as const;
export type PlanUnit = (typeof PLAN_UNITS)[number];
export type PlanKind = "PREVENTIVE" | "CALIBRATION";

/** A preventive or calibration plan (docs/spec/mantenimiento.md, section 5). */
export interface Plan {
  id: string;
  asset: { id: string; code: string; name: string } | null;
  kind: PlanKind;
  name: string;
  instructions: string;
  checklist: string[];
  every: number | null;
  everyUnit: PlanUnit | null;
  meter: { id: string; name: string; unit: string; lastValue: number | null } | null;
  meterEvery: number | null;
  nextMeterAt: number | null;
  assignedTo: { id: string; name: string } | null;
  estimatedMinutes: number | null;
  leadDays: number;
  lockout: boolean;
  nextDueOn: string | null;
  lastDoneOn: string | null;
  state: "ok" | "due_soon" | "overdue";
  openWorkOrder: { id: string; code: string } | null;
  archived: boolean;
}

export interface PlanInput {
  assetId: string;
  kind: PlanKind;
  name: string;
  instructions: string;
  checklist: string[];
  every: number | null;
  everyUnit: PlanUnit | null;
  firstDueOn: string | null;
  meterId: string | null;
  meterEvery: number | null;
  firstMeterAt: number | null;
  assignedToId: string | null;
  estimatedMinutes: number | null;
  leadDays: number;
  lockout: boolean;
}

/** A spare part of the SGA's catalogue (docs/spec/mantenimiento.md, section 6). */
export interface Part {
  id: string;
  code: string;
  description: string;
  unit: string;
  stock: number | null;
  minStock: number | null;
  location: string;
  low: boolean;
  syncedAt: string;
}

/** A token the SGA uses for the integration API (owner only). */
export interface IntegrationToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const TOKEN_SCOPES = ["parts.write", "consumption.read"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** The indicators of a period (docs/spec/mantenimiento.md, section 7). */
export interface AssetIndicators {
  id: string;
  code: string;
  name: string;
  line: string;
  breakdowns: number;
  downtimeHours: number;
  mttrHours: number | null;
  mtbfHours: number | null;
  availability: number;
}

export interface Indicators {
  from: string;
  to: string;
  days: number;
  equipment: number;
  breakdowns: number;
  downtimeHours: number;
  mttrHours: number | null;
  mtbfHours: number | null;
  availability: number | null;
  preventiveDone: number;
  correctiveDone: number;
  preventiveShare: number | null;
  open: number;
  overdue: number;
  onHold: number;
  compliance: { due: number; onTime: number; rate: number | null };
  top: AssetIndicators[];
  assets: AssetIndicators[];
}

export interface IndicatorsQuery {
  desde: string;
  hasta: string;
  equipo?: string | undefined;
}

export interface Meter {
  id: string;
  asset: { id: string; code: string; name: string } | null;
  name: string;
  unit: string;
  lastValue: number | null;
  lastReadAt: string | null;
}
export const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export const WORK_STATUSES = [
  "REPORTED",
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "DONE",
  "CLOSED",
  "CANCELLED",
] as const;
export const CRITICALITY = ["A", "B", "C"] as const;
export const ASSET_STATUSES = ["OPERATING", "STOPPED", "RETIRED"] as const;

export type WorkKind = (typeof WORK_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type WorkStatus = (typeof WORK_STATUSES)[number];
export type Criticality = (typeof CRITICALITY)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface PersonRef {
  id: string;
  name: string;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  location: string;
  manufacturer: string;
  model: string;
  serial: string;
  installedOn: string | null;
  criticality: Criticality;
  foodContact: boolean;
  status: AssetStatus;
  notes: string;
  folder: { spaceId: string; id: string } | null;
  openWorkOrders: number;
  archived: boolean;
}

export interface AssetInput {
  code: string;
  name: string;
  parentId: string | null;
  location: string;
  manufacturer: string;
  model: string;
  serial: string;
  installedOn: string | null;
  criticality: Criticality;
  foodContact: boolean;
  status: AssetStatus;
  notes: string;
  archived?: boolean;
}

export interface WorkOrderSummary {
  id: string;
  code: string;
  title: string;
  kind: WorkKind;
  priority: Priority;
  status: WorkStatus;
  asset: { id: string; code: string; name: string } | null;
  assignedTo: PersonRef | null;
  reportedBy: PersonRef;
  reportedAt: string;
  dueOn: string | null;
  source: string;
  lockout: boolean;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  description: string;
  holdReason: string;
  startedAt: string | null;
  doneAt: string | null;
  closedAt: string | null;
  closedBy: PersonRef | null;
  downtimeMinutes: number | null;
  cause: string;
  solution: string;
  needsHygiene: boolean;
  hygieneReleasedBy: PersonRef | null;
  hygieneReleasedAt: string | null;
  labor: {
    id: string;
    person: PersonRef;
    startedAt: string;
    endedAt: string | null;
    minutes: number | null;
    note: string;
  }[];
  totalMinutes: number;
  parts: { id: string; partCode: string; description: string; quantity: number; unit: string }[];
  events: { id: string; action: string; detail: string; who: string | null; createdAt: string }[];
  nc: { id: string; code: string } | null;
  plan: { id: string; name: string } | null;
  checklist: { text: string; done: boolean }[];
  suggestion: Suggestion | null;
  recordings: {
    id: string;
    purpose: "REPORT" | "CLOSE";
    who: string;
    transcript: string;
    hasAudio: boolean;
    createdAt: string;
  }[];
  can: { edit: boolean; work: boolean; close: boolean; releaseHygiene: boolean };
}

/** «Suggest a resolution» (docs/spec/mantenimiento.md, section 4). */
export interface Suggestion {
  id: string;
  causes: {
    cause: string;
    likelihood: "high" | "medium" | "low";
    steps: string[];
    sources: string[];
  }[];
  note: string;
  sources: {
    ref: string;
    kind: "work_order" | "document";
    id: string;
    label: string;
    spaceId: string | null;
    nodeType: string | null;
    parentId: string | null;
  }[];
  useful: boolean | null;
  by: string;
  createdAt: string;
}

/** Reporting and closing by talking (docs/spec/mantenimiento.md, section 3). */
export interface VoiceStatus {
  available: boolean;
  serverTranscription: boolean;
}

/** A voice note to send: the recorded audio, or the text the browser dictated. */
export type VoiceNote =
  { kind: "audio"; blob: Blob; durationMs: number } | { kind: "text"; text: string };

export interface VoiceResult<P> {
  recordingId: string;
  transcript: string;
  proposal: P | null;
}

export interface ReportProposal {
  title: string;
  description: string;
  assetId: string | null;
  priority: Priority;
  priorityReason: string;
}

export interface CloseProposal {
  cause: string;
  solution: string;
  minutes: number;
  downtimeMinutes: number | null;
  parts: { partCode: string; description: string; quantity: number; unit: string }[];
}

export interface WorkOrderInput {
  title: string;
  description: string;
  assetId: string | null;
  kind: WorkKind;
  priority: Priority;
  assignedToId: string | null;
  dueOn: string | null;
  lockout: boolean;
}

export type WorkAction =
  | { action: "take" }
  | { action: "start" }
  | { action: "stop"; note: string }
  | { action: "hold"; reason: string }
  | { action: "resume" }
  | { action: "done"; cause: string; solution: string; downtimeMinutes: number | null }
  | { action: "release_hygiene" }
  | { action: "close" }
  | { action: "reopen" }
  | { action: "cancel"; reason: string }
  | { action: "labor"; minutes: number; note: string; day: string }
  | { action: "remove_labor"; laborId: string }
  | { action: "part"; partCode: string; description: string; quantity: number; unit: string }
  | { action: "remove_part"; partId: string }
  | { action: "check"; index: number; done: boolean };

export interface WorkOrderFilters {
  estado?: "open" | WorkStatus | undefined;
  prioridad?: Priority | undefined;
  tipo?: WorkKind | undefined;
  equipo?: string | undefined;
  mias?: "1" | undefined;
  q?: string | undefined;
}

const m = (slug: string, path: string) => `/w/${slug}/maintenance${path}`;

export const maintenanceKeys = {
  all: (slug: string) => ["w", slug, "maintenance"] as const,
  settings: (slug: string) => ["w", slug, "maintenance", "settings"] as const,
  assets: (slug: string, archived: boolean) =>
    ["w", slug, "maintenance", "assets", archived] as const,
  technicians: (slug: string) => ["w", slug, "maintenance", "technicians"] as const,
  workOrders: (slug: string, filters: WorkOrderFilters) =>
    ["w", slug, "maintenance", "work-orders", filters] as const,
  workOrder: (slug: string, id: string) => ["w", slug, "maintenance", "work-order", id] as const,
  counts: (slug: string) => ["w", slug, "maintenance", "counts"] as const,
  voice: (slug: string) => ["w", slug, "maintenance", "voice"] as const,
  plans: (slug: string, archived: boolean) =>
    ["w", slug, "maintenance", "plans", archived] as const,
  meters: (slug: string) => ["w", slug, "maintenance", "meters"] as const,
  calibrations: (slug: string) => ["w", slug, "maintenance", "calibrations"] as const,
  parts: (slug: string, q: string) => ["w", slug, "maintenance", "parts", q] as const,
  tokens: (slug: string) => ["w", slug, "maintenance", "tokens"] as const,
  indicators: (slug: string, query: IndicatorsQuery) =>
    ["w", slug, "maintenance", "indicators", query] as const,
};

function voiceRequest(note: VoiceNote, query: URLSearchParams, signal?: AbortSignal) {
  if (note.kind === "audio") query.set("duracion", String(Math.round(note.durationMs)));
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const options =
    note.kind === "audio"
      ? { method: "POST" as const, file: note.blob, fileType: note.blob.type.split(";")[0] ?? "" }
      : { method: "POST" as const, body: { text: note.text } };
  return { suffix, options: signal === undefined ? options : { ...options, signal } };
}

export const maintenanceApi = {
  settings: (slug: string) =>
    api<{ maintenance: { enabled: boolean; space: { id: string; name: string } | null } }>(
      `/w/${slug}/admin/maintenance`,
    ),
  saveSettings: (slug: string, enabled: boolean) =>
    api<{ maintenance: { enabled: boolean; space: { id: string; name: string } | null } }>(
      `/w/${slug}/admin/maintenance`,
      { method: "PUT", body: { enabled } },
    ),
  assets: (slug: string, archived: boolean) =>
    api<{ assets: Asset[] }>(m(slug, `/assets${archived ? "?archivado=1" : ""}`)),
  asset: (slug: string, id: string) => api<{ asset: Asset }>(m(slug, `/assets/${id}`)),
  createAsset: (slug: string, body: AssetInput) =>
    api<{ asset: Asset }>(m(slug, "/assets"), { method: "POST", body }),
  updateAsset: (slug: string, id: string, body: AssetInput) =>
    api<{ asset: Asset }>(m(slug, `/assets/${id}`), { method: "PUT", body }),
  assetQr: (slug: string, id: string, format: "png" | "svg") =>
    apiBlob(m(slug, `/assets/${id}/qr?format=${format}`)),
  technicians: (slug: string) => api<{ technicians: PersonRef[] }>(m(slug, "/technicians")),
  workOrders: (
    slug: string,
    filters: WorkOrderFilters,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    api<CursorPage<WorkOrderSummary>>(
      m(slug, `/work-orders?${listQuery({ ...filters, cursor })}`),
      { signal },
    ),
  counts: (slug: string) =>
    api<{ mine: number; urgent: number; pending: number }>(m(slug, "/counts")),
  report: (
    slug: string,
    body: {
      title: string;
      description: string;
      assetId: string | null;
      priority: Priority;
      source: "APP" | "QR";
      recordingId: string | null;
    },
  ) => api<{ workOrder: WorkOrderDetail }>(m(slug, "/reports"), { method: "POST", body }),
  voice: (slug: string) => api<{ voice: VoiceStatus }>(m(slug, "/voice")),
  plans: (slug: string, archived: boolean) =>
    api<{ plans: Plan[] }>(m(slug, `/plans${archived ? "?archivado=1" : ""}`)),
  createPlan: (slug: string, body: PlanInput) =>
    api<{ plan: Plan }>(m(slug, "/plans"), { method: "POST", body }),
  updatePlan: (slug: string, id: string, body: PlanInput & { archived?: boolean }) =>
    api<{ plan: Plan }>(m(slug, `/plans/${id}`), { method: "PUT", body }),
  calibrations: (slug: string) => api<{ plans: Plan[] }>(m(slug, "/calibrations")),
  parts: (slug: string, q: string) =>
    api<{ parts: Part[]; total: number }>(m(slug, `/parts?q=${encodeURIComponent(q)}`)),
  tokens: (slug: string) =>
    api<{ tokens: IntegrationToken[] }>(`/w/${slug}/admin/maintenance/tokens`),
  indicators: (slug: string, query: IndicatorsQuery) =>
    api<Indicators>(m(slug, `/indicators?${listQuery({ ...query })}`)),
  indicatorsCsv: (slug: string, query: IndicatorsQuery) =>
    apiBlob(m(slug, `/indicators/export?${listQuery({ ...query })}`)),
  createToken: (slug: string, body: { name: string; scopes: TokenScope[] }) =>
    api<{ token: string; view: IntegrationToken }>(`/w/${slug}/admin/maintenance/tokens`, {
      method: "POST",
      body,
    }),
  revokeToken: (slug: string, id: string) =>
    api<{ token: IntegrationToken }>(`/w/${slug}/admin/maintenance/tokens/${id}/revoke`, {
      method: "POST",
    }),
  meters: (slug: string) => api<{ meters: Meter[] }>(m(slug, "/meters")),
  createMeter: (slug: string, body: { assetId: string; name: string; unit: string }) =>
    api<{ meter: Meter }>(m(slug, "/meters"), { method: "POST", body }),
  addReading: (slug: string, id: string, value: number) =>
    api<{ meter: Meter }>(m(slug, `/meters/${id}/readings`), {
      method: "POST",
      body: { value },
    }),
  voiceReport: (slug: string, note: VoiceNote, assetId: string | null, signal?: AbortSignal) => {
    const query = new URLSearchParams(assetId === null ? {} : { equipo: assetId });
    const { suffix, options } = voiceRequest(note, query, signal);
    return api<VoiceResult<ReportProposal>>(m(slug, `/voice/report${suffix}`), options);
  },
  voiceClose: (slug: string, id: string, note: VoiceNote, signal?: AbortSignal) => {
    const { suffix, options } = voiceRequest(note, new URLSearchParams(), signal);
    return api<VoiceResult<CloseProposal>>(m(slug, `/work-orders/${id}/voice${suffix}`), options);
  },
  recordingAudio: (slug: string, id: string) => apiBlob(m(slug, `/recordings/${id}/audio`)),
  suggest: (slug: string, id: string) =>
    api<{ suggestion: Suggestion }>(m(slug, `/work-orders/${id}/suggestion`), { method: "POST" }),
  rateSuggestion: (slug: string, id: string, suggestionId: string, useful: boolean) =>
    api<undefined>(m(slug, `/work-orders/${id}/suggestion/${suggestionId}`), {
      method: "PUT",
      body: { useful },
    }),
  createWorkOrder: (slug: string, body: WorkOrderInput) =>
    api<{ workOrder: WorkOrderDetail }>(m(slug, "/work-orders"), { method: "POST", body }),
  workOrder: (slug: string, id: string) =>
    api<{ workOrder: WorkOrderDetail }>(m(slug, `/work-orders/${id}`)),
  updateWorkOrder: (slug: string, id: string, body: WorkOrderInput) =>
    api<{ workOrder: WorkOrderDetail }>(m(slug, `/work-orders/${id}`), { method: "PUT", body }),
  act: (slug: string, id: string, body: WorkAction) =>
    api<{ workOrder: WorkOrderDetail }>(m(slug, `/work-orders/${id}/actions`), {
      method: "POST",
      body,
    }),
};
