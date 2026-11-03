// Expiries of files and pages (docs/spec/vencimientos.md). The server checks who sees and sets what.
import { useQuery } from "@tanstack/react-query";
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, apiBlob } from "@/lib/api";

export type ExpiryState = "valid" | "due_soon" | "expired";

export interface Responsible {
  type: "person" | "department";
  id: string;
  name: string;
}

export interface NodeExpiry {
  /** «YYYY-MM-DD», a company day. */
  dueOn: string;
  state: ExpiryState;
  responsible: Responsible | null;
  noticeDays: number[];
  note: string | null;
  /** When it was last set: the new-version prompt proposes the same term from today. */
  setAt: string;
  responsibleCantSee: boolean;
}

export interface NodeExpiryResponse {
  expiry: NodeExpiry | null;
  canEdit: boolean;
}

export interface NodeExpiryInput {
  dueOn: string;
  responsible: { type: "person" | "department"; id: string } | null;
  noticeDays: number[];
  note: string | null;
}

export interface ExpiryRow {
  node: {
    id: string;
    name: string;
    type: string;
    spaceId: string;
    spaceName: string;
    parentId: string | null;
  };
  dueOn: string;
  state: ExpiryState;
  responsible: Responsible | null;
  note: string | null;
}

export interface ExpiryFilters {
  space?: string | undefined;
  department?: string | undefined;
  responsible?: string | undefined;
  status?: "all" | ExpiryState | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ResponsibleOptions {
  people: { id: string; name: string; canSee: boolean }[];
  departments: { id: string; name: string }[];
}

interface Named {
  id: string;
  name: string;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const expiriesKeys = {
  all: (slug: string) => ["w", slug, "expiries"] as const,
  node: (slug: string, id: string) => ["w", slug, "expiries", "node", id] as const,
  space: (slug: string, id: string) => ["w", slug, "expiries", "space", id] as const,
  list: (slug: string, filters: ExpiryFilters) => ["w", slug, "expiries", "list", filters] as const,
  filters: (slug: string) => ["w", slug, "expiries", "filters"] as const,
  mine: (slug: string) => ["w", slug, "expiries", "mine"] as const,
  myCount: (slug: string) => ["w", slug, "expiries", "mine", "count"] as const,
};

export const expiriesApi = {
  ofNode: (slug: string, id: string) => api<NodeExpiryResponse>(w(slug, `/nodes/${id}/expiry`)),
  set: (slug: string, id: string, body: NodeExpiryInput) =>
    api<NodeExpiryResponse>(w(slug, `/nodes/${id}/expiry`), { method: "PUT", body }),
  remove: (slug: string, id: string) =>
    api<undefined>(w(slug, `/nodes/${id}/expiry`), { method: "DELETE" }),
  responsibleOptions: (slug: string, id: string, q: string, signal?: AbortSignal) =>
    api<ResponsibleOptions>(
      w(slug, `/nodes/${id}/expiry/responsible-options?${listQuery({ q })}`),
      signal === undefined ? {} : { signal },
    ),
  list: (
    slug: string,
    filters: ExpiryFilters,
    cursor: string | undefined,
    signal: AbortSignal,
    pageSize?: number,
  ) =>
    api<CursorPage<ExpiryRow>>(
      w(slug, `/expiries?${listQuery({ ...filters, cursor, pageSize })}`),
      { signal },
    ),
  csv: (slug: string, filters: ExpiryFilters) =>
    apiBlob(w(slug, `/expiries/export?${listQuery({ ...filters })}`)),
  filters: (slug: string) =>
    api<{ spaces: Named[]; departments: Named[]; people: Named[] }>(w(slug, "/expiries/filters")),
  space: (slug: string, id: string) =>
    api<{ items: { nodeId: string; dueOn: string; state: ExpiryState }[] }>(
      w(slug, `/expiries/space/${id}`),
    ),
  mine: (slug: string) => api<{ items: ExpiryRow[]; total: number }>(w(slug, "/expiries/mine")),
  myCount: (slug: string) => api<{ count: number }>(w(slug, "/expiries/mine/count")),
};

/** A space's expiries by node, for the explorer's badges. */
export function useSpaceExpiries(slug: string, spaceId: string | undefined) {
  return useQuery({
    queryKey: expiriesKeys.space(slug, spaceId ?? ""),
    queryFn: () => expiriesApi.space(slug, spaceId ?? ""),
    select: (data) => new Map(data.items.map((item) => [item.nodeId, item])),
    staleTime: 60_000,
    enabled: spaceId !== undefined && spaceId !== "",
  });
}

/** «YYYY-MM-DD» plus some days (calendar arithmetic, in UTC so no clock change moves it). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Days from one «YYYY-MM-DD» to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
