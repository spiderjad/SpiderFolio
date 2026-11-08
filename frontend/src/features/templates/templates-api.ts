// Company templates API (docs/spec/plantillas.md). Off without the templates plugin: the server answers
// 404 and the plugin doesn't show these screens.
import { api } from "@/lib/api";
import type { CursorPage } from "@/components/ui/infinite";

export type TemplateKind = "PAGE" | "FOLDER";

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string | null;
  kind: TemplateKind;
  nodeCount: number;
  skippedFiles: number;
  packKey: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface OutlineNode {
  type: TemplateKind;
  name: string;
  controlled: boolean;
  children: OutlineNode[];
}

export interface TemplateDetail extends TemplateSummary {
  outline: OutlineNode | null;
  images: number;
}

export interface CreatedTree {
  node: { id: string; type: TemplateKind; spaceId: string; name: string };
  controlledSkipped: number;
}

export interface PackView {
  pluginId: string;
  id: string;
  name: string;
  description: string;
  folders: number;
  pages: number;
  controlled: number;
  documentTypes: { code: string; name: string; exists: boolean }[];
  departments: { name: string; exists: boolean }[];
  templates: number;
  installedAt: string | null;
  outline: OutlineNode;
}

export interface TemplatesFilter {
  q?: string;
  category?: string;
  kind?: TemplateKind;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  return search.toString();
}

export const templateKeys = {
  all: (slug: string) => ["w", slug, "templates"] as const,
  list: (slug: string, filter: TemplatesFilter) =>
    ["w", slug, "templates", "list", filter] as const,
  categories: (slug: string) => ["w", slug, "templates", "categories"] as const,
  detail: (slug: string, id: string) => ["w", slug, "templates", "detail", id] as const,
  packs: (slug: string) => ["w", slug, "templates", "packs"] as const,
};

export const templatesApi = {
  list: (slug: string, filter: TemplatesFilter, cursor: string | undefined, signal?: AbortSignal) =>
    api<CursorPage<TemplateSummary> & { canManage: boolean }>(
      w(
        slug,
        `/templates?${query({
          q: filter.q,
          category: filter.category,
          kind: filter.kind,
          cursor,
          pageSize: "50",
        })}`,
      ),
      signal === undefined ? {} : { signal },
    ),
  categories: (slug: string) => api<{ categories: string[] }>(w(slug, "/templates/categories")),
  get: (slug: string, id: string) => api<{ template: TemplateDetail }>(w(slug, `/templates/${id}`)),
  save: (
    slug: string,
    nodeId: string,
    body: { name: string; description: string; category: string },
  ) =>
    api<{ template: TemplateDetail }>(w(slug, `/nodes/${nodeId}/template`), {
      method: "POST",
      body,
    }),
  update: (
    slug: string,
    id: string,
    body: { name?: string; description?: string; category?: string },
  ) => api<{ template: TemplateDetail }>(w(slug, `/templates/${id}`), { method: "PATCH", body }),
  remove: (slug: string, id: string) =>
    api<undefined>(w(slug, `/templates/${id}`), { method: "DELETE" }),
  use: (slug: string, id: string, body: { spaceId: string; parentId: string | null }) =>
    api<CreatedTree>(w(slug, `/templates/${id}/use`), { method: "POST", body }),
  packs: (slug: string) => api<{ packs: PackView[] }>(w(slug, "/templates/packs")),
  install: (
    slug: string,
    pack: { pluginId: string; id: string },
    body: { spaceId: string; parentId: null; departments: string[] },
  ) =>
    api<CreatedTree & { templatesAdded: number; departmentsAdded: number; typesAdded: number }>(
      w(slug, `/templates/packs/${pack.pluginId}/${pack.id}/install`),
      { method: "POST", body },
    ),
};

/** Where a created page or folder opens. */
export function createdPath(slug: string, node: CreatedTree["node"]): string {
  return node.type === "PAGE"
    ? `/app/${slug}/files/${node.spaceId}/p/${node.id}`
    : `/app/${slug}/files/${node.spaceId}/f/${node.id}`;
}
