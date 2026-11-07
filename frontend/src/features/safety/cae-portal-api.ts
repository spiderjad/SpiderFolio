// The contractor's portal (docs/spec/cae.md, «Portal de contratas»): the host's side (issue, see and
// revoke the access, with the member's session) and the contractor's (guestApi: no token, only the
// access's own cookie, scoped to /api/v1/contratas/:accessId).
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api, guestApi } from "@/lib/api";

export interface CaePortalAccess {
  id: string;
  url: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  expiresAt: string;
  lastUsedAt: string | null;
  locked: boolean;
  expired: boolean;
  email: string | null;
}

const w = (slug: string, path: string) => `/w/${slug}/cae${path}`;

export const portalHostKeys = {
  access: (slug: string, companyId: string) => ["w", slug, "cae", "portal", companyId] as const,
};

export const portalHostApi = {
  access: (slug: string, companyId: string) =>
    api<{ access: CaePortalAccess | null }>(w(slug, `/companies/${companyId}/portal`)),
  issue: (slug: string, companyId: string, body: { days: number; email: string | null }) =>
    api<{ access: CaePortalAccess; code: string }>(w(slug, `/companies/${companyId}/portal`), {
      method: "POST",
      body,
    }),
  revoke: (slug: string, companyId: string) =>
    api<undefined>(w(slug, `/companies/${companyId}/portal/revoke`), { method: "POST" }),
};

// ─── The contractor ──────────────────────────────────────────────────────────────────────

export interface PortalRequirement {
  id: string;
  name: string;
  required: boolean;
  validityMonths: number | null;
  state: "ok" | "due_soon" | "expired" | "pending" | "rejected" | "missing";
  validUntil: string | null;
  latest: {
    status: "PENDING" | "ACCEPTED" | "REJECTED";
    rejectReason: string | null;
    createdAt: string;
  } | null;
}

export interface PortalOverview {
  host: string;
  terms: "es" | "latam";
  company: {
    name: string;
    kind: "CONTRACTOR" | "SUBCONTRACTOR" | "CONCURRENT";
    startsOn: string | null;
    endsOn: string | null;
    responsible: string | null;
    authorized: boolean;
    state: "authorized" | "incomplete" | "blocked" | "archived";
    reasons: string[];
  };
  requirements: PortalRequirement[];
  info: { nodeId: string; code: string; title: string; version: number; delivered: boolean }[];
  accessExpiresAt: string | null;
}

export interface PortalWorker {
  id: string;
  name: string;
  idNumber: string | null;
  task: string | null;
  archived: boolean;
  authorized: boolean;
  reasons: string[];
  requirements: PortalRequirement[];
}

export interface PortalPermit {
  id: string;
  type: "HOT_WORK" | "HEIGHT" | "CONFINED_SPACE" | "ELECTRICAL" | "OTHER";
  customName: string | null;
  location: string;
  description: string;
  validFrom: string;
  validTo: string;
  state: "draft" | "scheduled" | "active" | "expired" | "closed" | "cancelled";
  workers: { id: string; name: string }[];
  ownStaff: number;
  precautions: { label: string; done: boolean }[];
}

const p = (accessId: string, path = "") => `/contratas/${accessId}${path}`;

export const portalKeys = {
  cover: (accessId: string) => ["portal", accessId] as const,
  overview: (accessId: string) => ["portal", accessId, "overview"] as const,
  workers: (accessId: string, archived: boolean) =>
    ["portal", accessId, "workers", archived] as const,
  permits: (accessId: string) => ["portal", accessId, "permits"] as const,
  all: (accessId: string) => ["portal", accessId] as const,
};

export const portalApi = {
  cover: (accessId: string) => guestApi<{ signedIn: boolean }>(p(accessId)),
  enter: (accessId: string, code: string) =>
    guestApi<undefined>(p(accessId, "/session"), { method: "POST", body: { code } }),
  leave: (accessId: string) => guestApi<undefined>(p(accessId, "/logout"), { method: "POST" }),
  overview: (accessId: string) => guestApi<PortalOverview>(p(accessId, "/overview")),
  workers: (
    accessId: string,
    archived: boolean,
    cursor: string | undefined,
    signal?: AbortSignal,
  ) =>
    guestApi<CursorPage<PortalWorker>>(
      p(accessId, `/workers?${listQuery({ archived: archived ? "1" : undefined, cursor })}`),
      signal === undefined ? {} : { signal },
    ),
  createWorker: (
    accessId: string,
    body: { name: string; idNumber: string | null; task: string | null },
  ) => guestApi<{ worker: { id: string } }>(p(accessId, "/workers"), { method: "POST", body }),
  updateWorker: (
    accessId: string,
    workerId: string,
    body: { name?: string; idNumber?: string | null; task?: string | null },
  ) => guestApi<undefined>(p(accessId, `/workers/${workerId}`), { method: "PATCH", body }),
  archiveWorker: (accessId: string, workerId: string) =>
    guestApi<undefined>(p(accessId, `/workers/${workerId}/archive`), { method: "POST" }),
  permits: (accessId: string, cursor: string | undefined, signal?: AbortSignal) =>
    guestApi<CursorPage<PortalPermit>>(
      p(accessId, `/permits?${listQuery({ cursor })}`),
      signal === undefined ? {} : { signal },
    ),
  startUpload: (
    accessId: string,
    body: { requirementId: string; workerId: string | null; name: string; size: number },
  ) =>
    guestApi<{ upload: { id: string; url: string; contentType: string } }>(
      p(accessId, "/uploads"),
      { method: "POST", body },
    ),
  completeUpload: (accessId: string, uploadId: string, validUntil: string | null) =>
    guestApi<{ documentId: string }>(p(accessId, `/uploads/${uploadId}/complete`), {
      method: "POST",
      body: { validUntil },
    }),
};

/** Where a site information document opens (the portal's own scoped endpoint). */
export const portalInfoUrl = (accessId: string, nodeId: string): string =>
  `/api/v1${p(accessId, `/info/${nodeId}`)}`;

/** Uploads a file for a requirement: ticket, PUT straight to storage, then the same checks. */
export async function portalUpload(
  accessId: string,
  file: File,
  target: { requirementId: string; workerId: string | null; validUntil: string | null },
): Promise<void> {
  const { upload } = await portalApi.startUpload(accessId, {
    requirementId: target.requirementId,
    workerId: target.workerId,
    name: file.name,
    size: file.size,
  });
  const put = await fetch(upload.url, {
    method: "PUT",
    headers: { "Content-Type": upload.contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`upload ${String(put.status)}`);
  await portalApi.completeUpload(accessId, upload.id, target.validUntil);
}
