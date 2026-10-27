// Cliente de los códigos QR de documentos.
import { api, apiBlob } from "@/lib/api";

export type LabelSize = "small" | "medium" | "large";

export interface QrView {
  id: string;
  isPublic: boolean;
  url: string;
  scans: number;
  lastScanAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface QrList {
  items: QrView[];
  canPublic: boolean;
}

export type ScanResult =
  | {
      kind: "private";
      workspaceSlug: string;
      spaceId: string;
      nodeId: string;
      nodeType: "PAGE" | "FILE";
    }
  | { kind: "public-page"; title: string; html: string }
  | { kind: "public-file"; title: string; fileName: string; contentType: string; url: string };

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const qrKeys = {
  node: (slug: string, nodeId: string) => ["w", slug, "qr", nodeId] as const,
};

export const qrApi = {
  list: (slug: string, nodeId: string) => api<QrList>(w(slug, `/nodes/${nodeId}/qr`)),
  create: (slug: string, nodeId: string, isPublic: boolean) =>
    api<QrView>(w(slug, `/nodes/${nodeId}/qr`), { method: "POST", body: { public: isPublic } }),
  revoke: (slug: string, qrId: string) =>
    api<undefined>(w(slug, `/qr/${qrId}`), { method: "DELETE" }),
  image: (slug: string, qrId: string, format: "png" | "svg") =>
    apiBlob(w(slug, `/qr/${qrId}/image?format=${format}`)),
  labels: (slug: string, qrId: string, size: LabelSize) =>
    apiBlob(w(slug, `/qr/${qrId}/labels?size=${size}`)),
  scan: (token: string) => api<ScanResult>(`/qr/${token}`),
};
