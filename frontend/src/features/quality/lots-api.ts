// Traceability (docs/spec/calidad.md, «Fase 7»): lots, what went into each one, what went out to
// customers, the trace both ways and the CSV import.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const LOT_KINDS = ["RAW", "INTERMEDIATE", "FINISHED"] as const;
export type LotKind = (typeof LOT_KINDS)[number];
export type TraceDirection = "backward" | "forward";
export type TraceSource = "MANUAL" | "CSV" | "PLUGIN";
export const IMPORT_KINDS = ["lots", "links", "shipments"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface Lot {
  id: string;
  kind: LotKind;
  code: string;
  product: { id: string; name: string } | null;
  material: string | null;
  supplier: { id: string; name: string } | null;
  supplierLot: string | null;
  origin: string | null;
  quantity: number | null;
  unit: string | null;
  date: string;
  expiresOn: string | null;
  source: TraceSource;
  editable: boolean;
}

export interface LotLink {
  id: string;
  lot: Lot;
  quantity: number | null;
  unit: string | null;
  editable: boolean;
}

export interface Shipment {
  id: string;
  customer: string;
  document: string | null;
  shippedOn: string;
  quantity: number | null;
  unit: string | null;
  editable: boolean;
}

export interface LotDetail extends Lot {
  inputs: LotLink[];
  outputs: LotLink[];
  shipments: Shipment[];
  holds: { id: string; product: string; status: string }[];
  complaints: { id: string; from: string; product: string; status: string }[];
  recallTests: { id: string; date: string; kind: string; minutes: number }[];
}

export interface Trace {
  root: Lot;
  direction: TraceDirection;
  lots: (Lot & { depth: number })[];
  links: { inputId: string; outputId: string; quantity: number | null; unit: string | null }[];
  shipments: (Shipment & { lotId: string })[];
  totals: {
    lots: number;
    rawMaterials: number;
    suppliers: number;
    customers: number;
    shipped: { unit: string; quantity: number }[];
  };
  truncated: boolean;
  ms: number;
}

export interface LotFilters {
  q?: string | undefined;
  kind?: LotKind | undefined;
}

export interface LotBody {
  kind: LotKind;
  code: string;
  productId: string | null;
  material: string | null;
  supplierId: string | null;
  supplierLot: string | null;
  origin: string | null;
  quantity: number | null;
  unit: string | null;
  date: string;
  expiresOn: string | null;
}

export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
  errorCount: number;
}

export const lotKeys = {
  all: (slug: string) => ["w", slug, "quality", "lots"] as const,
  list: (slug: string, filters: LotFilters) => ["w", slug, "quality", "lots", "list", filters] as const,
  one: (slug: string, id: string) => ["w", slug, "quality", "lots", "one", id] as const,
  trace: (slug: string, id: string, direction: TraceDirection) =>
    ["w", slug, "quality", "lots", "trace", id, direction] as const,
};

export const lotsApi = {
  list: (slug: string, filters: LotFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<Lot>>(
      w(slug, `/quality/lots?${listQuery({ ...filters, dir: "desc", cursor })}`),
      { signal },
    ),
  search: (slug: string, q: string, ids?: string[]) =>
    api<CursorPage<Lot>>(
      w(
        slug,
        `/quality/lots?${listQuery({ q, ids: ids?.join(","), sort: "date", dir: "desc", pageSize: 25 })}`,
      ),
    ),
  get: (slug: string, id: string) => api<{ lot: LotDetail }>(w(slug, `/quality/lots/${id}`)),
  create: (slug: string, body: LotBody) =>
    api<{ lot: LotDetail }>(w(slug, "/quality/lots"), { method: "POST", body }),
  update: (slug: string, id: string, body: Partial<Omit<LotBody, "kind">>) =>
    api<{ lot: LotDetail }>(w(slug, `/quality/lots/${id}`), { method: "PATCH", body }),
  remove: (slug: string, id: string) =>
    api<{ deleted: true }>(w(slug, `/quality/lots/${id}`), { method: "DELETE" }),
  addInput: (
    slug: string,
    id: string,
    body: { inputId: string; quantity: number | null; unit: string | null },
  ) => api<{ lot: LotDetail }>(w(slug, `/quality/lots/${id}/inputs`), { method: "POST", body }),
  removeLink: (slug: string, id: string) =>
    api<{ deleted: true }>(w(slug, `/quality/lot-links/${id}`), { method: "DELETE" }),
  addShipment: (
    slug: string,
    id: string,
    body: {
      customer: string;
      document: string | null;
      shippedOn: string;
      quantity: number | null;
      unit: string | null;
    },
  ) => api<{ lot: LotDetail }>(w(slug, `/quality/lots/${id}/shipments`), { method: "POST", body }),
  removeShipment: (slug: string, id: string) =>
    api<{ deleted: true }>(w(slug, `/quality/shipments/${id}`), { method: "DELETE" }),
  trace: (slug: string, id: string, direction: TraceDirection) =>
    api<Trace>(w(slug, `/quality/lots/${id}/trace?direction=${direction}`)),
  exportTrace: (slug: string, id: string, direction: TraceDirection, format: "csv" | "pdf") =>
    apiBlob(w(slug, `/quality/lots/${id}/trace/export/${format}?direction=${direction}`)),
  template: (slug: string, kind: ImportKind) =>
    apiBlob(w(slug, `/quality/lots/template/${kind}`)),
  import: (slug: string, body: { kind: ImportKind; csv: string; dryRun: boolean }) =>
    api<ImportResult>(w(slug, "/quality/lots/import"), { method: "POST", body }),
};
