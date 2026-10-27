// Datos del Inicio (GET /w/:slug/overview): una sola respuesta por alcance, ya filtrada por el servidor.
// Se refresca al volver a la pestaña, cada 60 s y tras aprobar, leer, publicar, subir o compartir
// (el cliente de consultas invalida esta clave tras cada mutación; ver lib/query-client.ts).
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type NodeType = "PAGE" | "FILE" | "FOLDER";

export interface NodeRef {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
}

export interface PendingReading {
  node: NodeRef;
  code: string;
  version: number;
  dueAt: string | null;
  overdue: boolean;
}

export interface PendingApproval {
  node: NodeRef;
  code: string;
  version: number;
  submittedAt: string;
  submittedBy: string | null;
  changeNote: string | null;
}

export interface LeaderCompliance {
  node: NodeRef;
  code: string;
  total: number;
  read: number;
  pending: number;
  overdue: number;
  /** Deben leerlo pero no ven el documento (aparte; no cuentan para el cumplimiento). */
  noAccess: number;
}

export interface LeaderDocument {
  node: NodeRef;
  code: string;
  at: string;
}

export interface CompanyHome {
  kpis: {
    publishedDocuments: number;
    inReview: number;
    drafts: number;
    readingCompliance: number | null;
    activePeople: number;
  };
  storage: { usedBytes: number; limitBytes: number | null };
  activity: { date: string; uploads: number; publications: number; reads: number }[];
  topDocuments: { node: NodeRef; code: string | null; people: number }[];
}

export interface HomeOverview {
  scope: { leader: boolean; company: boolean };
  mine: {
    readings: { total: number; items: PendingReading[] };
    approvals: { total: number; items: PendingApproval[] };
  };
  shared: { node: NodeRef; sharedBy: string | null; sharedAt: string }[];
  leader: {
    compliance: LeaderCompliance[];
    reviewDue: { total: number; items: LeaderDocument[] };
    inReview: { total: number; items: LeaderDocument[] };
  } | null;
  company: CompanyHome | null;
}

export const overviewKey = (slug: string) => ["w", slug, "overview"] as const;

/** ¿Es una consulta del Inicio? (para invalidarlas todas tras una mutación, de cualquier empresa). */
export const isOverviewKey = (key: readonly unknown[]): boolean =>
  key[0] === "w" && key[2] === "overview";

export function useHome(slug: string) {
  return useQuery({
    queryKey: overviewKey(slug),
    queryFn: ({ signal }) => api<HomeOverview>(`/w/${slug}/overview`, { signal }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
  });
}
