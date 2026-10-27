// Cliente de la búsqueda (paleta Ctrl+K y resultados de texto completo).
import type { NodeType } from "@/features/files/api";
import { api } from "@/lib/api";

export interface QuickNodeHit {
  id: string;
  name: string;
  type: NodeType;
  icon: string | null;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
  code: string | null;
}

/** Un trozo de texto; `match` marca la palabra encontrada. */
export interface Segment {
  text: string;
  match: boolean;
}

export interface FullTextHit {
  id: string;
  type: NodeType;
  name: Segment[];
  snippet: Segment[];
  code: string | null;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
}

export interface QuickResults {
  documents: QuickNodeHit[];
  folders: QuickNodeHit[];
  spaces: { id: string; name: string; icon: string | null }[];
  people: { id: string; name: string; jobTitle: string | null; departments: string[] }[];
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const searchKeys = {
  quick: (slug: string, q: string, spaces?: "writable") =>
    ["w", slug, "search", "quick", q, spaces ?? ""] as const,
  full: (slug: string, q: string) => ["w", slug, "search", "full", q] as const,
};

export const searchApi = {
  full: (slug: string, q: string, cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, pageSize: "20" });
    if (cursor !== undefined) params.set("cursor", cursor);
    return api<{ items: FullTextHit[]; nextCursor: string | null }>(
      w(slug, `/search?${params.toString()}`),
      { ...(signal === undefined ? {} : { signal }) },
    );
  },
  quick: (slug: string, q: string, spaces?: "writable", signal?: AbortSignal) => {
    const params = new URLSearchParams({ q });
    if (spaces !== undefined) params.set("spaces", spaces);
    return api<QuickResults>(w(slug, `/search/quick?${params.toString()}`), {
      ...(signal === undefined ? {} : { signal }),
    });
  },
};
