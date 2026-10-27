// Cliente de Administración › Registro de auditoría (/w/:slug/admin/audit).
import type { CursorPage } from "@/components/ui/infinite";
import { api, apiText } from "@/lib/api";

export interface AuditEvent {
  id: string;
  createdAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  /** null: el sistema. `staff`: el equipo de SpiderFolio. */
  actor: { id: string; name: string | null; email: string | null; staff: boolean } | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
}

export interface AuditFilters {
  memberId: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
}

const params = (filters: AuditFilters, extra: Record<string, string | undefined> = {}): string => {
  const search = new URLSearchParams();
  const all: Record<string, string | undefined> = { ...filters, ...extra };
  for (const [key, value] of Object.entries(all)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  return search.toString();
};

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const auditKeys = {
  list: (slug: string, filters: AuditFilters) => ["w", slug, "admin", "audit", filters] as const,
};

export const auditApi = {
  list: (slug: string, filters: AuditFilters, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<AuditEvent>>(w(slug, `/admin/audit?${params(filters, { cursor })}`), { signal }),
  csv: (slug: string, filters: AuditFilters) =>
    apiText(w(slug, `/admin/audit/export?${params(filters)}`)),
};
