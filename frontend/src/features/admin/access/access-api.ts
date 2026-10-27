// Cliente de la auditoría de accesos (/admin/access/*, capacidad permissions.audit).
import type { AccessLevel, NodeType, Page } from "@/features/files/api";
import type { AccessExplanation, Reason } from "@/features/sharing/api";
import { api, apiText } from "@/lib/api";

export interface MatrixView {
  departments: Page<{ id: string; name: string; parentId: string | null; depth: number }>;
  spaces: Page<{ id: string; name: string; isPrivate: boolean; isConfidential: boolean }>;
  cells: {
    departmentId: string;
    spaceId: string;
    /** Nivel de un miembro del departamento (null: los miembros no entran). */
    level: AccessLevel | null;
    reason: Reason | null;
    /** Nivel de quien jefa el departamento (null: tampoco). */
    leaderLevel: AccessLevel | null;
  }[];
  /** Sin acceso al espacio entero, pero con carpetas o archivos compartidos adentro. */
  partials: { departmentId: string; spaceId: string; count: number }[];
}

export interface MatrixCellDetail {
  department: { id: string; name: string };
  space: { id: string; name: string };
  spaceAccess: {
    level: AccessLevel;
    reasons: { level: AccessLevel; reason: Reason; departmentName: string | null }[];
  } | null;
  items: Page<{
    id: string;
    node: { id: string; name: string; type: NodeType };
    level: AccessLevel;
    via: { departmentId: string; departmentName: string; inherited: boolean };
    sharedBy: string | null;
    sharedAt: string;
    expiresAt: string | null;
  }>;
}

export interface PersonRef {
  membershipId: string;
  name: string;
  avatarUrl: string | null;
}

export type OverviewEntry =
  | { type: "person"; person: PersonRef; reason: Reason; departmentName: string | null }
  | {
      type: "group";
      key: string;
      label: string;
      count: number;
      people: PersonRef[];
      reason: Reason;
    };

export interface SpaceOverview {
  id: string;
  name: string;
  isPrivate: boolean;
  isConfidential: boolean;
  department: { id: string; name: string } | null;
  groups: { level: AccessLevel; entries: OverviewEntry[]; people: number }[];
  sharedInside: {
    items: {
      node: { id: string; name: string; type: NodeType };
      grants: {
        subject: { type: "person" | "department" | "company"; name: string };
        level: AccessLevel;
        expiresAt: string | null;
      }[];
    }[];
    more: number;
  };
}

export interface PersonItem {
  node: { id: string; name: string; type: NodeType; spaceId: string; spaceName: string };
  level: AccessLevel;
  reason: Reason;
  departmentName: string | null;
  sharedBy: string | null;
  sharedAt: string | null;
  expiresAt: string | null;
}

export interface TargetOption {
  type: "space" | "node";
  id: string;
  name: string;
  nodeType: NodeType | null;
  spaceId: string;
  spaceName: string;
}

export interface PersonSpaceAccess {
  space: { id: string; name: string; isPrivate: boolean };
  level: AccessLevel;
  reasons: AccessExplanation["people"]["items"][number]["reasons"];
}

export interface PersonAccessReport {
  person: { membershipId: string; name: string; jobTitle: string | null; role: string };
  spaces: Page<PersonSpaceAccess>;
  truncated: boolean;
}

export type ReportKind = "cut-inheritance" | "direct-people" | "guests" | "expiring";
export const REPORT_KINDS: readonly ReportKind[] = [
  "cut-inheritance",
  "direct-people",
  "guests",
  "expiring",
];

export interface ReportRow {
  id: string;
  target: TargetOption;
  subject: { type: "person" | "department" | "company"; id: string; name: string } | null;
  level: AccessLevel | null;
  expiresAt: string | null;
  createdAt: string;
}

const base = (slug: string, path: string) => `/w/${slug}/admin/access${path}`;

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const accessAuditKeys = {
  all: (slug: string) => ["w", slug, "admin", "access"] as const,
};

export const accessAuditApi = {
  matrix: (
    slug: string,
    q: { q: string; cursor?: string; spaceCursor?: string },
    signal?: AbortSignal,
  ) =>
    api<MatrixView>(
      base(
        slug,
        `/matrix?${query({ q: q.q, cursor: q.cursor, spaceCursor: q.spaceCursor, pageSize: 25 })}`,
      ),
      signal === undefined ? {} : { signal },
    ),
  spaces: (slug: string, q: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<SpaceOverview> & { truncated: boolean }>(
      base(slug, `/spaces?${query({ q, cursor, pageSize: 10 })}`),
      signal === undefined ? {} : { signal },
    ),
  personItems: (slug: string, membershipId: string, cursor?: string, signal?: AbortSignal) =>
    api<{ items: PersonItem[]; nextCursor: string | null }>(
      base(slug, `/people/${membershipId}/items?${query({ cursor, pageSize: 25 })}`),
      signal === undefined ? {} : { signal },
    ),
  matrixCell: (
    slug: string,
    target: { departmentId: string; spaceId: string },
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    api<MatrixCellDetail>(
      base(
        slug,
        `/matrix/cell?${query({ departmentId: target.departmentId, spaceId: target.spaceId, cursor, pageSize: 25 })}`,
      ),
      signal === undefined ? {} : { signal },
    ),
  targets: (
    slug: string,
    kind: "space" | "node",
    q: string,
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    api<Page<TargetOption>>(
      base(slug, `/targets?${query({ kind, q, cursor, pageSize: 20 })}`),
      signal === undefined ? {} : { signal },
    ),
  who: (
    slug: string,
    target: { type: "space" | "node"; id: string },
    q: string,
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    api<AccessExplanation>(
      base(slug, `/who?${query({ type: target.type, id: target.id, q, cursor, pageSize: 25 })}`),
      signal === undefined ? {} : { signal },
    ),
  whoCsv: (slug: string, target: { type: "space" | "node"; id: string }) =>
    apiText(base(slug, `/who/export?${query({ type: target.type, id: target.id })}`)),
  person: (slug: string, membershipId: string, cursor?: string, signal?: AbortSignal) =>
    api<PersonAccessReport>(
      base(slug, `/people/${membershipId}?${query({ cursor, pageSize: 25 })}`),
      signal === undefined ? {} : { signal },
    ),
  report: (
    slug: string,
    kind: ReportKind,
    q: { membershipId?: string; cursor?: string },
    signal?: AbortSignal,
  ) =>
    api<Page<ReportRow>>(
      base(
        slug,
        `/reports/${kind}?${query({ membershipId: q.membershipId, cursor: q.cursor, pageSize: 25 })}`,
      ),
      signal === undefined ? {} : { signal },
    ),
  reportCsv: (slug: string, kind: ReportKind, membershipId?: string) =>
    apiText(base(slug, `/reports/${kind}/export?${query({ membershipId })}`)),
};
