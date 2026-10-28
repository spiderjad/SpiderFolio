// Cliente de Licencia y plugins (/w/:slug/admin/license), Límites y uso (/w/:slug/admin/limits) y del
// backoffice de la instalación (/internal).
import type { CursorPage } from "@/components/ui/infinite";
import { api } from "@/lib/api";

export interface LicenseView {
  state: "none" | "invalid" | "expired" | "valid";
  reason?: "format" | "signature" | "payload" | "workspace";
  id?: string;
  customer?: string;
  plugins?: string[];
  issuedAt?: string;
  expiresAt?: string | null;
}

export interface InstalledPluginView {
  id: string;
  name: string;
  description: string;
  version: string;
  /** «community»: de terceros, sin licencia ni verificación; lo activa el propietario. */
  distribution: "commercial" | "community";
  licensed: boolean;
  active: boolean;
}

export interface PluginServerView {
  uploadEnabled: boolean;
  ownMfa: boolean;
  multiCompany: boolean;
  restartSupported: boolean;
  restartAt: string | null;
  /** Installed on disk, loaded on the next restart. */
  waiting: { id: string; version: string }[];
}

export interface LicenseOverview {
  license: LicenseView;
  installed: InstalledPluginView[];
  /** This company's id: the license is issued for it. */
  workspaceId: string;
  server: PluginServerView;
}

export const limitKeys = [
  "storageGb",
  "maxFileMb",
  "fileVersionsKept",
  "auditRetentionDays",
  "aiQueriesPerMonth",
] as const;
export type LimitKey = (typeof limitKeys)[number];
export type Limits = Record<LimitKey, number | null>;

export interface LimitsOverview {
  limits: Limits;
  usage: {
    storageBytes: number;
    storageMaxBytes: number | null;
    members: { FULL: number; READER: number };
    aiQueriesThisMonth: number;
  };
}

export interface InternalWorkspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  limits: Limits;
  usage: LimitsOverview["usage"];
  licensed: boolean;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const licenseKeys = {
  license: (slug: string) => ["w", slug, "admin", "license"] as const,
  limits: (slug: string) => ["w", slug, "admin", "limits"] as const,
  companies: () => ["internal", "companies"] as const,
};

export const licenseApi = {
  overview: (slug: string) => api<LicenseOverview>(w(slug, "/admin/license")),
  save: (slug: string, token: string) =>
    api<LicenseOverview>(w(slug, "/admin/license"), { method: "PUT", body: { token } }),
  remove: (slug: string) => api<undefined>(w(slug, "/admin/license"), { method: "DELETE" }),
  setCommunity: (slug: string, pluginId: string, enabled: boolean) =>
    api<LicenseOverview>(w(slug, `/admin/plugins/${encodeURIComponent(pluginId)}/activation`), {
      method: "PUT",
      body: enabled ? { enabled, acceptRisk: true } : { enabled },
    }),
  uploadPlugin: (slug: string, file: Blob) =>
    api<
      LicenseOverview & {
        uploaded: { id: string; version: string; previousVersion: string | null };
      }
    >(w(slug, "/admin/plugins/packages"), { method: "POST", file }),
  restart: (slug: string) =>
    api<{ restartAt: string }>(w(slug, "/admin/server/restart"), { method: "POST" }),
  limits: (slug: string) => api<LimitsOverview>(w(slug, "/admin/limits")),
  updateLimits: (slug: string, changes: Partial<Limits>) =>
    api<LimitsOverview>(w(slug, "/admin/limits"), { method: "PATCH", body: changes }),
};

export const internalApi = {
  companies: (q: string, cursor: string | undefined, signal: AbortSignal) => {
    const search = new URLSearchParams();
    if (q !== "") search.set("q", q);
    if (cursor !== undefined) search.set("cursor", cursor);
    return api<CursorPage<InternalWorkspace>>(`/internal/workspaces?${search.toString()}`, {
      signal,
    });
  },
};
