// Audit rooms (docs/spec/salas-de-auditoria.md): whoever builds them (audit.share) and the external
// auditor, who has no account (guestApi: no token, only the room's own cookie).
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, guestApi } from "@/lib/api";

export type RoomState = "open" | "expired" | "revoked";

export interface Room {
  id: string;
  name: string;
  auditorEmail: string;
  expiresAt: string;
  allowDownload: boolean;
  state: RoomState;
  createdBy: { id: string; name: string };
  createdAt: string;
  items: number;
  lastAccessAt: string | null;
}

export interface RoomDetail extends Room {
  shared: { id: string; kind: string; report: string | null; title: string; createdAt: string }[];
  accesses: { id: string; action: string; what: string | null; ip: string | null; at: string }[];
}

export type RoomItemInput =
  | { kind: "node"; nodeId: string }
  | { kind: "space"; spaceId: string }
  | { kind: "readings"; nodeId: string }
  | { kind: "approvals"; nodeId: string }
  | { kind: "form-records"; formId: string; from: string; to: string }
  | { kind: "training"; courseId: string }
  | { kind: "ppe"; from: string; to: string }
  | { kind: "audit-log"; from: string; to: string; action?: string };

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const roomsKeys = {
  all: (slug: string) => ["w", slug, "audit-rooms"] as const,
  list: (slug: string) => ["w", slug, "audit-rooms", "list"] as const,
  one: (slug: string, id: string) => ["w", slug, "audit-rooms", "one", id] as const,
};

export const roomsApi = {
  list: (slug: string, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<Room>>(w(slug, `/admin/audit-rooms?${listQuery({ cursor })}`), { signal }),
  create: (
    slug: string,
    body: { name: string; auditorEmail: string; expiresOn: string; allowDownload: boolean },
  ) => api<{ room: RoomDetail }>(w(slug, "/admin/audit-rooms"), { method: "POST", body }),
  get: (slug: string, id: string) => api<{ room: RoomDetail }>(w(slug, `/admin/audit-rooms/${id}`)),
  add: (slug: string, id: string, body: RoomItemInput) =>
    api<{ room: RoomDetail }>(w(slug, `/admin/audit-rooms/${id}/items`), { method: "POST", body }),
  remove: (slug: string, id: string, itemId: string) =>
    api<{ room: RoomDetail }>(w(slug, `/admin/audit-rooms/${id}/items/${itemId}`), {
      method: "DELETE",
    }),
  revoke: (slug: string, id: string) =>
    api<{ room: RoomDetail }>(w(slug, `/admin/audit-rooms/${id}/revoke`), { method: "POST" }),
  resend: (slug: string, id: string) =>
    api<undefined>(w(slug, `/admin/audit-rooms/${id}/resend`), { method: "POST" }),
};

// ─── The auditor ─────────────────────────────────────────────────────────────────────────

export interface AuditorItem {
  id: string;
  kind: "NODE" | "SPACE" | "REPORT";
  title: string;
  documents: { id: string; name: string; type: string; path: string }[];
  unavailable: boolean;
}

export const auditorKeys = {
  cover: (roomId: string) => ["auditor", roomId] as const,
  items: (roomId: string) => ["auditor", roomId, "items"] as const,
};

export const auditorApi = {
  cover: (roomId: string) =>
    guestApi<{
      room: { company: string; name: string; open: boolean; expiresAt: string };
      signedIn: boolean;
    }>(`/auditor/${roomId}`),
  requestCode: (roomId: string) =>
    guestApi<undefined>(`/auditor/${roomId}/code`, { method: "POST" }),
  enter: (roomId: string, code: string) =>
    guestApi<undefined>(`/auditor/${roomId}/session`, { method: "POST", body: { code } }),
  leave: (roomId: string) => guestApi<undefined>(`/auditor/${roomId}/logout`, { method: "POST" }),
  items: (roomId: string) =>
    guestApi<{
      room: { name: string; expiresAt: string; allowDownload: boolean; auditorEmail: string };
      items: AuditorItem[];
    }>(`/auditor/${roomId}/items`),
};

/** Where an item's PDF opens (inline in the viewer, or as a download when the room allows it). */
export function auditorPdfUrl(
  roomId: string,
  itemId: string,
  options: { nodeId?: string | undefined; download?: boolean } = {},
): string {
  const query = listQuery({
    node: options.nodeId,
    download: options.download === true ? "1" : undefined,
  });
  return `/api/v1/auditor/${roomId}/items/${itemId}/pdf${query === "" ? "" : `?${query}`}`;
}
