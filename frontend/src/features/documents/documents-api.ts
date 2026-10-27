// Cliente de documentos controlados (módulo 6).
import type { NodeType, Page } from "@/features/files/api";
import { api, apiBlob, apiText } from "@/lib/api";

export type DocStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "OBSOLETE" | "REJECTED";

export type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export interface DocumentTypeView {
  code: string;
  name: string;
  prefix: string;
  reviewMonths: number;
  padding: number;
  nextNumber: number;
}

export interface ApprovalView {
  approver: { id: string; name: string };
  decision: Decision | null;
  comment: string | null;
  /** Cuándo se envió la ronda y quién la envió. */
  round: string;
  submittedBy: string | null;
  /** Comentarios que dejó en el texto durante la ronda. */
  commentCount: number;
  decidedAt: string | null;
  selfApproved: boolean;
  /** Del envío actual (no de uno anterior que se rechazó). */
  current: boolean;
}

export interface DocumentVersionView {
  id: string;
  version: number;
  status: DocStatus;
  title: string;
  changeNote: string | null;
  minorChange: boolean;
  changeReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  obsoletedAt: string | null;
  submittedBy: string | null;
  approvals: ApprovalView[];
}

export interface ControlledActions {
  canSubmit: boolean;
  canDecide: boolean;
  canPublish: boolean;
  canWithdraw: boolean;
}

export interface ReadingMine {
  required: boolean;
  acknowledged: boolean;
  dueAt: string | null;
  readVersion: number | null;
  changeReason: string | null;
}

export interface AccessGaps {
  total: number;
  people: { membershipId: string; name: string }[];
  canGrant: boolean;
}

export type ReadingStatus = "read" | "pending" | "overdue" | "noAccess";

export interface ReadingPerson {
  membershipId: string;
  name: string;
  status: ReadingStatus;
  readAt: string | null;
  dueAt: string | null;
}

export interface ReadingsOverview {
  version: number | null;
  requirements: {
    id: string;
    subject: { type: "person" | "department"; id: string; name: string };
    includeSubareas: boolean;
    dueAt: string | null;
  }[];
  summary: { total: number; read: number; pending: number; overdue: number; noAccess: number };
  people: Page<ReadingPerson>;
}

export interface MyReading {
  node: { id: string; name: string; type: NodeType; spaceId: string; spaceName: string };
  code: string;
  version: number;
  dueAt: string | null;
  overdue: boolean;
}

export interface ControlledView {
  code: string;
  docType: string;
  typeName: string;
  status: DocStatus;
  publishedVersion: number | null;
  ownerDepartment: { id: string; name: string } | null;
  reviewDueAt: string | null;
  versions: DocumentVersionView[];
  actions: ControlledActions;
  /** Solo para quien tiene la aprobación pendiente. */
  review: { openComments: number; resolvedComments: number; hasPreviousReview: boolean } | null;
  reading: { mine: ReadingMine | null; canManage: boolean };
}

export interface ControlledInfo {
  controlled: ControlledView | null;
  types: DocumentTypeView[];
  canConvert: boolean;
}

export interface ApproverOption {
  id: string;
  name: string;
  jobTitle: string | null;
  via: "owner" | "admin" | "capability" | "head" | "deputy";
  department: string | null;
  departmentId: string | null;
  canView: boolean;
}

export interface ApproverOptions {
  suggested: ApproverOption[];
  others: ApproverOption[];
  allowSelf: boolean;
  department: { id: string; name: string } | null;
  canChangeDepartment: boolean;
  canGrantAccess: boolean;
}

export interface MyApproval {
  node: {
    id: string;
    name: string;
    type: NodeType;
    spaceId: string;
    spaceName: string;
    parentId: string | null;
    mimeType: string | null;
  };
  code: string;
  version: number;
  submittedAt: string;
  submittedBy: string | null;
  changeNote: string | null;
}

export interface NewsItem {
  node: { id: string; name: string; type: NodeType; spaceId: string; spaceName: string };
  code: string;
  version: number;
  publishedAt: string;
  changeNote: string | null;
  department: { id: string; name: string } | null;
}

export interface RecentItem {
  node: {
    id: string;
    name: string;
    type: NodeType;
    spaceId: string;
    spaceName: string;
    mimeType: string | null;
  };
  code: string | null;
  visitedAt: string;
}

export interface NodeRef {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
}

export interface AdminDocumentRow {
  node: NodeRef;
  code: string;
  docType: string;
  status: DocStatus;
  publishedVersion: number | null;
  ownerDepartment: { id: string; name: string } | null;
  reviewDueAt: string | null;
}

export interface AdminApprovalRow {
  node: NodeRef;
  code: string;
  version: number;
  submittedAt: string;
  submittedBy: string | null;
  approvers: { name: string; decision: Decision | null }[];
}

export interface ComplianceCounts {
  total: number;
  read: number;
  pending: number;
  overdue: number;
}

export interface DocumentCompliance extends ComplianceCounts {
  node: NodeRef;
  code: string;
  version: number;
}

export interface DepartmentCompliance extends ComplianceCounts {
  department: { id: string; name: string };
}

export interface DocumentTypeAdmin extends DocumentTypeView {
  padding: number;
  nextNumber: number;
  example: string;
  documents: number;
}

export type DiffBlock =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "changed"; words: { op: "same" | "add" | "remove"; text: string }[] };

export interface FileSide {
  fileName: string;
  sizeBytes: number;
  checksum: string;
  uploadedAt: string;
}

export interface Comparison {
  type: NodeType;
  from: { version: number; status: DocStatus; title: string; at: string | null } | null;
  to: { version: number; status: DocStatus; title: string; at: string | null };
  blocks: DiffBlock[];
  stats: { added: number; removed: number; changed: number };
  truncated: boolean;
  files: { from: FileSide | null; to: FileSide | null } | null;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  return params.toString();
}

export const documentsKeys = {
  all: (slug: string) => ["w", slug, "documents"] as const,
  node: (slug: string, nodeId: string) => ["w", slug, "documents", "node", nodeId] as const,
  approvals: (slug: string) => ["w", slug, "documents", "approvals"] as const,
  readings: (slug: string) => ["w", slug, "documents", "readings"] as const,
  recent: (slug: string) => ["w", slug, "documents", "recent"] as const,
};

export const documentsApi = {
  controlled: (slug: string, nodeId: string) =>
    api<ControlledInfo>(w(slug, `/nodes/${nodeId}/controlled`)),
  convert: (
    slug: string,
    nodeId: string,
    body: { docType: string; ownerDepartmentId?: string | null },
  ) => api<ControlledInfo>(w(slug, `/nodes/${nodeId}/controlled`), { method: "POST", body }),
  compare: (
    slug: string,
    nodeId: string,
    versions: {
      from?: number | undefined;
      to?: number | undefined;
      since?: "review" | undefined;
    },
  ) =>
    api<Comparison>(
      w(
        slug,
        `/nodes/${nodeId}/controlled/compare?${query({
          from: versions.from === undefined ? undefined : String(versions.from),
          to: versions.to === undefined ? undefined : String(versions.to),
          since: versions.since,
        })}`,
      ),
    ),
  readings: (slug: string, nodeId: string, status: ReadingStatus | undefined, cursor?: string) =>
    api<ReadingsOverview>(
      w(slug, `/nodes/${nodeId}/controlled/readings?${query({ status, cursor, pageSize: "25" })}`),
    ),
  addReading: (
    slug: string,
    nodeId: string,
    body: {
      departmentId?: string;
      membershipId?: string;
      includeSubareas?: boolean;
      dueAt?: string | null;
    },
  ) => api<undefined>(w(slug, `/nodes/${nodeId}/controlled/readings`), { method: "PUT", body }),
  removeReading: (slug: string, nodeId: string, requirementId: string) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled/readings/${requirementId}`), {
      method: "DELETE",
    }),
  accessGaps: (
    slug: string,
    nodeId: string,
    subject?: { departmentId?: string; membershipId?: string; includeSubareas?: boolean },
  ) =>
    api<AccessGaps>(
      w(
        slug,
        `/nodes/${nodeId}/controlled/readings/access-gaps?${query({
          departmentId: subject?.departmentId,
          membershipId: subject?.membershipId,
          includeSubareas:
            subject?.departmentId === undefined
              ? undefined
              : String(subject.includeSubareas === true),
        })}`,
      ),
    ),
  grantReadingAccess: (
    slug: string,
    nodeId: string,
    body: { departmentId?: string; membershipId?: string; includeSubareas?: boolean },
  ) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled/readings/grant-access`), {
      method: "POST",
      body,
    }),
  remindReaders: (slug: string, nodeId: string, membershipIds?: string[]) =>
    api<{ sent: number }>(w(slug, `/nodes/${nodeId}/controlled/readings/remind`), {
      method: "POST",
      body: membershipIds === undefined ? {} : { membershipIds },
    }),
  acknowledge: (slug: string, nodeId: string) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled/acknowledge`), { method: "POST" }),
  readingsCsv: (slug: string, nodeId: string) =>
    apiText(w(slug, `/nodes/${nodeId}/controlled/readings/export`)),
  myReadings: (slug: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<MyReading>>(
      w(slug, `/documents/readings?${query({ cursor, pageSize: "25" })}`),
      signal === undefined ? {} : { signal },
    ),
  pdf: (slug: string, nodeId: string, version: number) =>
    apiBlob(w(slug, `/nodes/${nodeId}/controlled/pdf?${query({ version: String(version) })}`)),
  recent: (slug: string, pageSize = 10) =>
    api<Page<RecentItem>>(w(slug, `/documents/recent?${query({ pageSize: String(pageSize) })}`)),
  adminDocuments: (
    slug: string,
    q: {
      q: string;
      status?: DocStatus | undefined;
      review?: "due" | undefined;
      departmentId?: string | undefined;
      cursor?: string | undefined;
    },
    signal?: AbortSignal,
  ) =>
    api<Page<AdminDocumentRow>>(
      w(
        slug,
        `/admin/documents?${query({ q: q.q, status: q.status, review: q.review, departmentId: q.departmentId, cursor: q.cursor, pageSize: "25" })}`,
      ),
      signal === undefined ? {} : { signal },
    ),
  adminApprovals: (slug: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<AdminApprovalRow>>(
      w(slug, `/admin/documents/approvals?${query({ cursor, pageSize: "25" })}`),
      signal === undefined ? {} : { signal },
    ),
  complianceByDocument: (slug: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<DocumentCompliance>>(
      w(slug, `/admin/documents/compliance?${query({ cursor, pageSize: "25" })}`),
      signal === undefined ? {} : { signal },
    ),
  complianceByDepartment: (slug: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<DepartmentCompliance>>(
      w(slug, `/admin/documents/compliance/departments?${query({ cursor, pageSize: "25" })}`),
      signal === undefined ? {} : { signal },
    ),
  adminTypes: (slug: string) =>
    api<{ items: DocumentTypeAdmin[] }>(w(slug, "/admin/documents/types")),
  createType: (
    slug: string,
    body: { code: string; name: string; prefix?: string; padding?: number; reviewMonths?: number },
  ) =>
    api<{ items: DocumentTypeAdmin[] }>(w(slug, "/admin/documents/types"), {
      method: "POST",
      body,
    }),
  updateType: (
    slug: string,
    code: string,
    body: {
      name?: string;
      prefix?: string;
      padding?: number;
      reviewMonths?: number;
      nextNumber?: number;
    },
  ) =>
    api<{ items: DocumentTypeAdmin[] }>(w(slug, `/admin/documents/types/${code}`), {
      method: "PATCH",
      body,
    }),
  news: (slug: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<NewsItem>>(
      w(slug, `/documents/news?${query({ cursor, pageSize: "10" })}`),
      signal === undefined ? {} : { signal },
    ),
  approvers: (slug: string, nodeId: string, q: string) =>
    api<ApproverOptions>(w(slug, `/nodes/${nodeId}/controlled/approvers?${query({ q })}`)),
  setDepartment: (slug: string, nodeId: string, ownerDepartmentId: string | null) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled`), {
      method: "PATCH",
      body: { ownerDepartmentId },
    }),
  submit: (slug: string, nodeId: string, body: { approverIds: string[]; changeNote?: string }) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled/submit`), { method: "POST", body }),
  decide: (slug: string, nodeId: string, body: { decision: Decision; comment?: string }) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled/decision`), { method: "POST", body }),
  withdraw: (slug: string, nodeId: string) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/controlled/withdraw`), { method: "POST" }),
  publish: (
    slug: string,
    nodeId: string,
    body: { requestReading?: boolean; reason?: string } = {},
  ) => api<undefined>(w(slug, `/nodes/${nodeId}/controlled/publish`), { method: "POST", body }),
  myApprovals: (slug: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<MyApproval>>(
      w(slug, `/documents/approvals?${query({ cursor, pageSize: "25" })}`),
      signal === undefined ? {} : { signal },
    ),
};
