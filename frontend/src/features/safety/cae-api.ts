// CAE, coordination of business activities (docs/spec/cae.md): contractors, their workers and the
// catalog of required documents. The server checks CAE is on and who sees and changes what.
import type { CursorPage } from "@/components/ui/infinite";
import { listQuery } from "@/features/admin/api";
import { api } from "@/lib/api";

export type CaeKind = "CONTRACTOR" | "SUBCONTRACTOR" | "CONCURRENT";
export type CaeState = "authorized" | "incomplete" | "blocked" | "archived";
export type CaeRequirementState =
  "ok" | "due_soon" | "expired" | "pending" | "rejected" | "missing";
export type CaeScope = "COMPANY" | "WORKER";
export type CaeAppliesTo = "ALL" | "CONTRACTOR" | "CONCURRENT";

export const CAE_KINDS: readonly CaeKind[] = ["CONTRACTOR", "SUBCONTRACTOR", "CONCURRENT"];
export const CAE_STATES: readonly CaeState[] = ["authorized", "incomplete", "blocked", "archived"];

export interface CaeStatusSummary {
  authorized: boolean;
  state: CaeState;
  /** Readable, in the person's language: «Falta: …». */
  reasons: string[];
}

export type CaeDocumentStatus = "PENDING" | "ACCEPTED" | "REJECTED";

/** A document as the status shows it. */
export interface CaeDocumentRef {
  id: string;
  nodeId: string;
  /** null once the file went to the trash. */
  fileName: string | null;
  status: CaeDocumentStatus;
  validUntil: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface CaeRequirementStatus {
  requirement: { id: string; name: string; required: boolean; validityMonths: number | null };
  state: CaeRequirementState;
  validUntil: string | null;
  /** The current (accepted) document. */
  current: CaeDocumentRef | null;
  /** A newer one, pending or rejected. */
  latest: CaeDocumentRef | null;
}

/** A document with who gave it and who reviewed it (history, «Por revisar»). */
export interface CaeDocument {
  id: string;
  status: CaeDocumentStatus;
  validUntil: string | null;
  rejectReason: string | null;
  superseded: boolean;
  createdAt: string;
  createdBy: { id: string; name: string };
  reviewed: { at: string; by: { id: string; name: string } } | null;
  file: { id: string; name: string | null; spaceId: string | null };
  requirement: { id: string; name: string; scope: CaeScope };
  company: { id: string; name: string };
  worker: { id: string; name: string } | null;
}

export interface CaeDocumentFilters {
  status?: "pending" | "accepted" | "rejected" | undefined;
  requirementId?: string | undefined;
  companyId?: string | undefined;
  workerId?: string | undefined;
}

export interface CaeCompanyRow {
  id: string;
  name: string;
  kind: CaeKind;
  parent: { id: string; name: string } | null;
  /** null for whoever only checks. */
  responsible: { id: string; name: string } | null;
  activity: string | null;
  workers: number | null;
  /** Documents waiting for review (null for whoever only checks). */
  pending: number | null;
  status: CaeStatusSummary;
}

export interface CaeCompany extends CaeCompanyRow {
  /** false: only the authorization (cae.check). */
  full: boolean;
  canManage: boolean;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** «YYYY-MM-DD». */
  startsOn: string | null;
  endsOn: string | null;
  blocked: { at: string; reason: string } | null;
  archivedAt: string | null;
  folder: { id: string; spaceId: string; name: string } | null;
  requirements: CaeRequirementStatus[];
}

export interface CaeCompanyInput {
  name: string;
  taxId: string | null;
  kind: CaeKind;
  parentId: string | null;
  activity: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  responsibleId: string;
  startsOn: string | null;
  endsOn: string | null;
}

export interface CaeWorkerRow {
  id: string;
  name: string;
  idNumber: string | null;
  task: string | null;
  company: { id: string; name: string; kind: CaeKind };
  status: CaeStatusSummary;
}

export interface CaeWorker extends CaeWorkerRow {
  full: boolean;
  canManage: boolean;
  blocked: { at: string; reason: string } | null;
  archivedAt: string | null;
  requirements: CaeRequirementStatus[];
}

export interface CaeWorkerInput {
  name: string;
  idNumber: string | null;
  task: string | null;
}

export interface CaeRequirement {
  id: string;
  name: string;
  scope: CaeScope;
  validityMonths: number | null;
  appliesTo: CaeAppliesTo;
  required: boolean;
  archived: boolean;
  position: number;
}

export interface CaeRequirementInput {
  name: string;
  validityMonths: number | null;
  appliesTo: CaeAppliesTo;
  required: boolean;
}

export interface CaeCompanyFilters {
  q?: string | undefined;
  kind?: CaeKind | undefined;
  status?: CaeState | undefined;
  ids?: readonly string[] | undefined;
}

export interface CaeWorkerFilters {
  q?: string | undefined;
  status?: CaeState | undefined;
}

const w = (slug: string, path: string) => `/w/${slug}/cae${path}`;
const withSignal = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

export const caeKeys = {
  all: (slug: string) => ["w", slug, "cae"] as const,
  companies: (slug: string, filters: CaeCompanyFilters) =>
    ["w", slug, "cae", "companies", filters] as const,
  company: (slug: string, id: string) => ["w", slug, "cae", "company", id] as const,
  workers: (slug: string, companyId: string, filters: CaeWorkerFilters) =>
    ["w", slug, "cae", "workers", companyId, filters] as const,
  worker: (slug: string, id: string) => ["w", slug, "cae", "worker", id] as const,
  documents: (slug: string, filters: CaeDocumentFilters) =>
    ["w", slug, "cae", "documents", filters] as const,
  requirements: (slug: string, scope: CaeScope, archived: boolean) =>
    ["w", slug, "cae", "requirements", scope, archived] as const,
};

export const caeApi = {
  companyFolder: (slug: string, id: string) =>
    api<{ target: { spaceId: string; folderId: string } }>(w(slug, `/companies/${id}/folder`), {
      method: "POST",
    }),
  workerFolder: (slug: string, id: string) =>
    api<{ target: { spaceId: string; folderId: string } }>(w(slug, `/workers/${id}/folder`), {
      method: "POST",
    }),
  documents: (
    slug: string,
    filters: CaeDocumentFilters,
    cursor: string | undefined,
    signal?: AbortSignal,
    pageSize?: number,
  ) =>
    api<CursorPage<CaeDocument>>(
      w(
        slug,
        `/documents?${listQuery({
          status: filters.status,
          requirementId: filters.requirementId,
          companyId: filters.companyId,
          workerId: filters.workerId,
          cursor,
          pageSize,
        })}`,
      ),
      withSignal(signal),
    ),
  createDocument: (
    slug: string,
    body: {
      requirementId: string;
      companyId: string;
      workerId: string | null;
      nodeId: string;
      validUntil: string | null;
      accept: boolean;
    },
  ) => api<{ document: CaeDocument }>(w(slug, "/documents"), { method: "POST", body }),
  acceptDocument: (slug: string, id: string, validUntil: string | null) =>
    api<{ document: CaeDocument }>(w(slug, `/documents/${id}/accept`), {
      method: "POST",
      body: { validUntil },
    }),
  rejectDocument: (slug: string, id: string, reason: string) =>
    api<{ document: CaeDocument }>(w(slug, `/documents/${id}/reject`), {
      method: "POST",
      body: { reason },
    }),
  companies: (
    slug: string,
    filters: CaeCompanyFilters,
    cursor: string | undefined,
    signal?: AbortSignal,
    pageSize?: number,
  ) =>
    api<CursorPage<CaeCompanyRow>>(
      w(
        slug,
        `/companies?${listQuery({
          q: filters.q,
          kind: filters.kind,
          status: filters.status,
          ids: filters.ids?.join(","),
          cursor,
          pageSize,
        })}`,
      ),
      withSignal(signal),
    ),
  company: (slug: string, id: string) => api<{ company: CaeCompany }>(w(slug, `/companies/${id}`)),
  createCompany: (slug: string, body: CaeCompanyInput) =>
    api<{ company: CaeCompany }>(w(slug, "/companies"), { method: "POST", body }),
  updateCompany: (slug: string, id: string, body: Partial<CaeCompanyInput>) =>
    api<{ company: CaeCompany }>(w(slug, `/companies/${id}`), { method: "PATCH", body }),
  blockCompany: (slug: string, id: string, reason: string) =>
    api<{ company: CaeCompany }>(w(slug, `/companies/${id}/block`), {
      method: "POST",
      body: { reason },
    }),
  unblockCompany: (slug: string, id: string) =>
    api<{ company: CaeCompany }>(w(slug, `/companies/${id}/unblock`), { method: "POST" }),
  archiveCompany: (slug: string, id: string) =>
    api<{ company: CaeCompany }>(w(slug, `/companies/${id}/archive`), { method: "POST" }),
  workers: (
    slug: string,
    companyId: string,
    filters: CaeWorkerFilters,
    cursor: string | undefined,
    signal?: AbortSignal,
  ) =>
    api<CursorPage<CaeWorkerRow>>(
      w(
        slug,
        `/companies/${companyId}/workers?${listQuery({
          q: filters.q,
          status: filters.status,
          cursor,
        })}`,
      ),
      withSignal(signal),
    ),
  worker: (slug: string, id: string) => api<{ worker: CaeWorker }>(w(slug, `/workers/${id}`)),
  createWorker: (slug: string, companyId: string, body: CaeWorkerInput) =>
    api<{ worker: CaeWorker }>(w(slug, `/companies/${companyId}/workers`), {
      method: "POST",
      body,
    }),
  updateWorker: (slug: string, id: string, body: Partial<CaeWorkerInput>) =>
    api<{ worker: CaeWorker }>(w(slug, `/workers/${id}`), { method: "PATCH", body }),
  blockWorker: (slug: string, id: string, reason: string) =>
    api<{ worker: CaeWorker }>(w(slug, `/workers/${id}/block`), {
      method: "POST",
      body: { reason },
    }),
  unblockWorker: (slug: string, id: string) =>
    api<{ worker: CaeWorker }>(w(slug, `/workers/${id}/unblock`), { method: "POST" }),
  archiveWorker: (slug: string, id: string) =>
    api<{ worker: CaeWorker }>(w(slug, `/workers/${id}/archive`), { method: "POST" }),
  requirements: (
    slug: string,
    scope: CaeScope,
    archived: boolean,
    cursor: string | undefined,
    signal?: AbortSignal,
  ) =>
    api<CursorPage<CaeRequirement>>(
      w(
        slug,
        `/requirements?${listQuery({
          scope,
          status: archived ? "all" : "active",
          cursor,
          pageSize: 100,
        })}`,
      ),
      withSignal(signal),
    ),
  createRequirement: (slug: string, body: CaeRequirementInput & { scope: CaeScope }) =>
    api<{ requirement: CaeRequirement }>(w(slug, "/requirements"), { method: "POST", body }),
  updateRequirement: (
    slug: string,
    id: string,
    body: Partial<CaeRequirementInput> & { archived?: false },
  ) =>
    api<{ requirement: CaeRequirement }>(w(slug, `/requirements/${id}`), {
      method: "PATCH",
      body,
    }),
  archiveRequirement: (slug: string, id: string) =>
    api<{ requirement: CaeRequirement }>(w(slug, `/requirements/${id}/archive`), {
      method: "POST",
    }),
  orderRequirements: (slug: string, scope: CaeScope, ids: readonly string[]) =>
    api<{ items: CaeRequirement[] }>(w(slug, "/requirements/order"), {
      method: "PUT",
      body: { scope, ids },
    }),
};
