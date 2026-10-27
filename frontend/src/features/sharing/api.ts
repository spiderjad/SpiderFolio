// Cliente de «Compartir» y «quién accede y por qué» (docs/spec/acceso-a-contenido.md, 8.1 a 8.3).
import { api } from "@/lib/api";
import type { AccessLevel, NodeType, Page } from "@/features/files/api";

export type ShareTarget = { type: "space" | "node"; id: string };

export type Origin = { type: "space" | "node"; id: string; name: string };

/** Un motivo del servidor (ver AccessReason en el backend). */
export type Reason =
  | { kind: "owner" | "admin" | "bypass" | "company" }
  | { kind: "leader"; rank: "HEAD" | "DEPUTY"; departmentId: string }
  | { kind: "member"; departmentId: string; subareas: boolean }
  | { kind: "visible"; departmentId: string }
  | {
      kind: "grant";
      via?: "person" | "department" | "company";
      departmentId?: string | null;
      expiresAt?: string | null;
    };

export interface ReasonView {
  level: AccessLevel;
  reason: Reason;
  departmentName: string | null;
  from: Origin | null;
}

export interface GrantView {
  id: string;
  subject: { type: "person" | "department" | "company"; id: string; name: string };
  level: AccessLevel;
  expiresAt: string | null;
  /** Solo en accesos a un departamento: llega también a sus subdepartamentos. */
  includeSubareas: boolean;
  grantedBy: string | null;
  from: Origin | null;
}

export interface PersonAccessView {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  level: AccessLevel;
  reasons: ReasonView[];
}

export interface AccessExplanation {
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
  };
  inheritance: { inherits: boolean; from: Origin } | null;
  grants: GrantView[];
  people: Page<PersonAccessView> & { truncated: boolean };
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;
const base = (target: ShareTarget) =>
  target.type === "space" ? `/spaces/${target.id}` : `/nodes/${target.id}`;

export const sharingKeys = {
  all: (slug: string) => ["w", slug, "sharing"] as const,
  target: (slug: string, target: ShareTarget) =>
    ["w", slug, "sharing", target.type, target.id] as const,
};

export const sharingApi = {
  explain: (
    slug: string,
    target: ShareTarget,
    q: string,
    cursor?: string,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ pageSize: "25", sort: "level" });
    if (q !== "") params.set("q", q);
    if (cursor !== undefined) params.set("cursor", cursor);
    return api<AccessExplanation>(w(slug, `${base(target)}/access?${params.toString()}`), {
      ...(signal === undefined ? {} : { signal }),
    });
  },
  set: (
    slug: string,
    target: ShareTarget,
    body: {
      membershipId?: string;
      departmentId?: string;
      /** Toda la empresa (los miembros activos; sin invitados externos). */
      everyone?: boolean;
      level: AccessLevel;
      expiresAt?: string | null;
      includeSubareas?: boolean;
    },
  ) => api<unknown>(w(slug, `${base(target)}/permissions`), { method: "PUT", body }),
  remove: (slug: string, permissionId: string) =>
    api<undefined>(w(slug, `/permissions/${permissionId}`), { method: "DELETE" }),
  setInheritance: (slug: string, nodeId: string, inheritAccess: boolean) =>
    api<{ inheritAccess: boolean; keptAccess: boolean }>(w(slug, `/nodes/${nodeId}/inheritance`), {
      method: "PATCH",
      body: { inheritAccess },
    }),
};
