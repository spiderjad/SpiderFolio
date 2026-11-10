// The maintenance module's API (docs/spec/mantenimiento.md): equipment, work orders and their actions.
// The server checks the module is on and who sees what.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

export const WORK_KINDS = ["CORRECTIVE", "PREVENTIVE", "IMPROVEMENT", "SAFETY", "HYGIENE"] as const;
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
  | { action: "remove_part"; partId: string };

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
