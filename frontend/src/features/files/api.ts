// Cliente de espacios, carpetas y archivos (docs/spec/archivos.md). Los datos del servidor van
// siempre por TanStack Query con estas claves (por workspace).
import type { SharingSummary } from "@/features/sharing/shared-mark";
import { api } from "@/lib/api";

export type AccessLevel = "MANAGE" | "EDIT" | "COMMENT" | "VIEW";
export type NodeType = "FOLDER" | "FILE" | "PAGE";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  nextCursor: string | null;
}

export interface SpaceView {
  id: string;
  name: string;
  icon: string | null;
  /** Color propio (#rrggbb); null = el del departamento o el de marca. */
  color: string | null;
  description: string | null;
  isPrivate: boolean;
  /** Confidencial (implica privado): los administradores no entran solos. */
  isConfidential: boolean;
  archived: boolean;
  level: AccessLevel;
  canManage: boolean;
  /** Departamento dueño del espacio (null = de la empresa). */
  department: { id: string; name: string; color: string | null } | null;
  departmentLevel: "EDIT" | "VIEW";
  /** El acceso de miembros llega también a los subdepartamentos. */
  includeSubareas: boolean;
  /** Por qué la persona tiene ese nivel. */
  reason: SpaceReason | null;
  /** Marcado como favorito por quien mira. */
  favorite: boolean;
  /** Con quién está compartido (solo si la persona puede gestionarlo). */
  sharing: SharingSummary | null;
  /** Archivos vigentes y última modificación de cualquier elemento del espacio. */
  pageCount: number;
  fileCount: number;
  lastModifiedAt: string | null;
  createdAt: string;
}

export type ZipRequest =
  | { mode: "direct"; url: string; expiresInSeconds: number; sizeBytes: number }
  | { mode: "background"; exportId: string; sizeBytes: number };

export type SpaceFilter = "all" | "mine" | "favorites" | "private";

export type SpaceReason =
  | { kind: "owner" | "admin" | "bypass" | "grant" | "company" }
  | {
      kind: "leader";
      rank: "HEAD" | "DEPUTY";
      department: { id: string; name: string };
      /** Lidera un área por encima del departamento del espacio. */
      superior: boolean;
    }
  | { kind: "member"; department: { id: string; name: string }; subareas: boolean }
  | { kind: "visible"; department: { id: string; name: string } };

export interface NodeView {
  id: string;
  spaceId: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  icon: string | null;
  /** Portada de una página: un color predefinido. */
  cover: string | null;
  inheritAccess: boolean;
  currentVersion: number;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  level: AccessLevel;
  /** Solo en los listados: elementos dentro de la carpeta y quién la modificó. */
  childCount?: number | null;
  /** Subcarpetas directas (solo carpetas, en listados). */
  folderCount?: number | null;
  /** Con quién está compartido (solo si la persona puede gestionarlo). */
  sharing?: SharingSummary | null;
  /** Tamaño de todo lo que contiene y se puede ver (carpetas, en listados); null si no se calculó. */
  totalBytes?: number | null;
  updatedBy?: { id: string; name: string; avatarUrl: string | null } | null;
  /** The app the last change came through ("Claude"), or null. */
  updatedVia?: string | null;
}

export interface NodeDetail {
  node: NodeView;
  space: { id: string; name: string; archived: boolean };
  /** De la raíz al padre; solo se puede entrar a los `accessible`. */
  ancestors: { id: string; name: string; type: NodeType; accessible: boolean }[];
  /** Si llega por un acceso compartido: desde dónde puede navegar (null: ve todo el camino). */
  shareRoot: { id: string; name: string; type: NodeType } | null;
}

/** Algo que le compartieron a la persona, fuera de los espacios que ya ve. */
export interface SharedItem {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  level: AccessLevel;
  sharedBy: string | null;
  sharedAt: string;
  expiresAt: string | null;
  via: "person" | "department";
  /** Todavía no lo abrió. */
  isNew: boolean;
}

/** Un acceso que dio la persona (o su área), para «Compartido por mí». */
export interface SharedByMeItem {
  id: string;
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
    spaceName: string;
  };
  subject: { type: "person" | "department" | "company"; id: string; name: string };
  level: AccessLevel;
  includeSubareas: boolean;
  sharedAt: string;
  expiresAt: string | null;
  grantedBy: string | null;
  mine: boolean;
  canRemove: boolean;
}

export interface UploadTicket {
  id: string;
  nodeId: string;
  name: string;
  version: number;
  size: number;
  expiresAt: string;
  contentType: string;
  mode: "single" | "multipart";
  url: string | null;
  partSize: number | null;
  partCount: number | null;
}

export type ConflictMode = "reject" | "replace" | "keep_both";

export interface UploadResult {
  node: NodeView;
  version: { version: number; sizeBytes: number; checksum: string };
  duplicateOf: string | null;
}

export interface DownloadTicket {
  url: string;
  expiresInSeconds: number;
  fileName: string;
  contentType: string;
  version: number;
  sizeBytes: number;
}

export interface NodeQuery {
  parent: string;
  type?: NodeType | "CONTAINER" | undefined;
  /** Filtro rápido: las carpetas siempre se ven. */
  kind?: "pages" | "files" | undefined;
  q?: string | undefined;
  sort: "name" | "updatedAt";
  dir: "asc" | "desc";
  cursor?: string | undefined;
  pageSize?: number;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const filesKeys = {
  all: (slug: string) => ["w", slug, "files"] as const,
  spaces: (slug: string) => ["w", slug, "files", "spaces"] as const,
  recentSpaces: (slug: string) => ["w", slug, "files", "spaces", "recent"] as const,
  favoriteSpaces: (slug: string) => ["w", slug, "files", "spaces", "favorites"] as const,
  departmentChoices: (slug: string) => ["w", slug, "files", "department-choices"] as const,
  space: (slug: string, id: string) => ["w", slug, "files", "space", id] as const,
  nodes: (slug: string, spaceId: string) => ["w", slug, "files", "nodes", spaceId] as const,
  node: (slug: string, id: string) => ["w", slug, "files", "node", id] as const,
};

export const filesApi = {
  spaces: (
    slug: string,
    q: {
      q?: string;
      archived?: boolean;
      filter?: SpaceFilter;
      sort?: "name" | "department" | "createdAt" | "favorite";
      dir?: "asc" | "desc";
      cursor?: string;
      pageSize?: number;
    },
    signal?: AbortSignal,
  ) =>
    api<Page<SpaceView>>(
      w(
        slug,
        `/spaces?${query({
          q: q.q,
          archived: q.archived === true ? "true" : undefined,
          filter: q.filter === "all" ? undefined : q.filter,
          sort: q.sort,
          dir: q.dir,
          cursor: q.cursor,
          pageSize: q.pageSize ?? 50,
        })}`,
      ),
      signal ? { signal } : {},
    ),
  recentSpaces: (slug: string) => api<{ items: SpaceView[] }>(w(slug, "/spaces/recent")),
  reorderFavorites: (slug: string, ids: string[]) =>
    api<undefined>(w(slug, "/spaces/favorites/order"), { method: "PUT", body: { ids } }),
  setFavorite: (slug: string, id: string, favorite: boolean) =>
    api<undefined>(w(slug, `/spaces/${id}/favorite`), { method: "PUT", body: { favorite } }),
  visitSpace: (slug: string, id: string) =>
    api<undefined>(w(slug, `/spaces/${id}/visit`), { method: "POST" }),
  space: (slug: string, id: string) => api<{ space: SpaceView }>(w(slug, `/spaces/${id}`)),
  createSpace: (
    slug: string,
    body: {
      name: string;
      icon?: string;
      color?: string;
      description?: string;
      isPrivate: boolean;
      isConfidential: boolean;
      departmentId?: string;
      departmentLevel?: "EDIT" | "VIEW";
      includeSubareas?: boolean;
    },
  ) => api<{ space: SpaceView }>(w(slug, "/spaces"), { method: "POST", body }),
  /** Departamentos donde se puede crear un espacio (todos, o solo los que lidera un jefe). */
  spaceDepartmentChoices: (
    slug: string,
    q: { q?: string; cursor?: string | undefined; pageSize: number },
    signal?: AbortSignal,
  ) =>
    api<Page<{ id: string; name: string }>>(
      w(slug, `/spaces/department-options?${query({ ...q })}`),
      signal ? { signal } : {},
    ),
  updateSpace: (
    slug: string,
    id: string,
    body: {
      name?: string;
      icon?: string | null;
      color?: string | null;
      description?: string | null;
      isPrivate?: boolean;
      isConfidential?: boolean;
      includeSubareas?: boolean;
      departmentId?: string | null;
      departmentLevel?: "EDIT" | "VIEW";
    },
  ) => api<{ space: SpaceView }>(w(slug, `/spaces/${id}`), { method: "PATCH", body }),
  archiveSpace: (slug: string, id: string) =>
    api<{ space: SpaceView }>(w(slug, `/spaces/${id}/archive`), { method: "POST" }),
  restoreSpace: (slug: string, id: string) =>
    api<{ space: SpaceView }>(w(slug, `/spaces/${id}/restore`), { method: "POST" }),

  departmentOptions: (slug: string, id: string, q: string, cursor?: string, signal?: AbortSignal) =>
    api<Page<{ id: string; name: string }>>(
      w(slug, `/spaces/${id}/members/options?${query({ q, cursor, pageSize: 20 })}`),
      signal ? { signal } : {},
    ),

  sharedSummary: (slug: string) => api<{ unseen: number }>(w(slug, "/shared-with-me/summary")),
  markSeen: (slug: string, nodeId: string) =>
    api<undefined>(w(slug, `/nodes/${nodeId}/seen`), { method: "POST" }),
  sharedByMe: (slug: string, q: string, cursor?: string, signal?: AbortSignal) =>
    api<{ items: SharedByMeItem[]; nextCursor: string | null }>(
      w(slug, `/shared-by-me?${query({ q, cursor, pageSize: 25 })}`),
      signal ? { signal } : {},
    ),
  shared: (slug: string, q: string, cursor?: string, signal?: AbortSignal) =>
    api<{ items: SharedItem[]; nextCursor: string | null }>(
      w(slug, `/shared-with-me?${query({ q, cursor, pageSize: 25 })}`),
      signal ? { signal } : {},
    ),
  nodes: (slug: string, spaceId: string, q: NodeQuery, signal?: AbortSignal) =>
    api<Page<NodeView>>(
      w(
        slug,
        `/spaces/${spaceId}/nodes?${query({
          parent: q.parent,
          type: q.type,
          kind: q.kind,
          q: q.q,
          sort: q.sort,
          dir: q.dir,
          cursor: q.cursor,
          pageSize: q.pageSize ?? 50,
        })}`,
      ),
      signal ? { signal } : {},
    ),
  node: (slug: string, id: string) => api<NodeDetail>(w(slug, `/nodes/${id}`)),
  createFolder: (slug: string, spaceId: string, body: { parentId: string | null; name: string }) =>
    api<{ node: NodeView }>(w(slug, `/spaces/${spaceId}/folders`), { method: "POST", body }),
  updateNode: (
    slug: string,
    id: string,
    body: { name?: string; icon?: string | null; cover?: string | null },
  ) => api<{ node: NodeView }>(w(slug, `/nodes/${id}`), { method: "PATCH", body }),
  /**
   * Pide el ZIP de una selección. Hasta 500 MB devuelve una URL de un solo uso y corta duración
   * (se abre como un enlace normal: el navegador lo baja directo a disco); más grande se genera
   * en segundo plano y se avisa por email.
   */
  requestZip: (slug: string, spaceId: string, nodeIds: string[]) =>
    api<ZipRequest>(w(slug, `/spaces/${spaceId}/download-zip`), {
      method: "POST",
      body: { nodeIds },
    }),
  /** Mueve (también a otro espacio). Ante un nombre repetido: FAIL, REPLACE o KEEP_BOTH. */
  moveNode: (
    slug: string,
    id: string,
    parentId: string | null,
    options: { spaceId?: string; onConflict?: "FAIL" | "REPLACE" | "KEEP_BOTH" } = {},
  ) =>
    api<{ node: NodeView }>(w(slug, `/nodes/${id}/move`), {
      method: "POST",
      body: { parentId, ...options },
    }),

  startUpload: (
    slug: string,
    spaceId: string,
    body: { parentId: string | null; name: string; size: number; onConflict: ConflictMode },
  ) =>
    api<{ upload: UploadTicket }>(w(slug, `/spaces/${spaceId}/uploads`), { method: "POST", body }),
  uploadStatus: (slug: string, id: string) =>
    api<{ ticket: UploadTicket; uploadedParts: { partNumber: number; size: number }[] }>(
      w(slug, `/uploads/${id}`),
    ),
  partUrls: (slug: string, id: string, partNumbers: number[]) =>
    api<{ parts: { partNumber: number; url: string }[] }>(w(slug, `/uploads/${id}/parts`), {
      method: "POST",
      body: { partNumbers },
    }),
  completeUpload: (slug: string, id: string) =>
    api<UploadResult>(w(slug, `/uploads/${id}/complete`), { method: "POST" }),
  abortUpload: (slug: string, id: string) =>
    api<undefined>(w(slug, `/uploads/${id}`), { method: "DELETE" }),
  download: (slug: string, id: string, options: { inline?: boolean; version?: number } = {}) =>
    api<DownloadTicket>(
      w(
        slug,
        `/files/${id}/download?${query({ inline: options.inline === true ? "true" : undefined, version: options.version })}`,
      ),
    ),
};

export interface VersionView {
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
  uploadedBy: string | null;
  current: boolean;
}

export interface TrashItemView {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  trashedAt: string;
  purgeAt: string;
  items: number;
  sizeBytes: number | null;
}

export interface PageDetail extends NodeDetail {
  /** Si es un documento controlado: código, estado y qué versión se está mostrando. */
  controlled: {
    code: string;
    status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "OBSOLETE" | "REJECTED";
    publishedVersion: number | null;
    showing: "published" | "draft";
    /** Está revisando el documento: ve lo que se revisa y puede comentarlo. */
    reviewer: boolean;
  } | null;
  /** Documento Tiptap (JSON); lo valida el servidor con packages/content. */
  content: unknown;
  /** Revisión sobre la que se edita: se devuelve al guardar (control de conflictos). */
  revision: number;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
  updatedVia: string | null;
}

export interface MentionCandidate {
  id: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  hasAccess: boolean;
}

/** Personas mencionadas que no ven la página (no recibieron el aviso). */
export type WithoutAccess = { id: string; name: string }[];

export interface SaveResult {
  revision: number;
  updatedAt: string;
  withoutAccess: WithoutAccess;
}

export const pagesApi = {
  create: (
    slug: string,
    spaceId: string,
    body: { parentId?: string | null; name?: string; content?: unknown },
  ) => api<{ page: PageDetail }>(w(slug, `/spaces/${spaceId}/pages`), { method: "POST", body }),
  get: (slug: string, id: string) => api<{ page: PageDetail }>(w(slug, `/pages/${id}`)),
  /** Pide subir una imagen (reserva cuota): devuelve su id y la URL prefirmada de subida. */
  startImage: (
    slug: string,
    id: string,
    body: { contentType: "image/webp" | "image/jpeg" | "image/png"; size: number },
  ) =>
    api<{ imageId: string; url: string }>(w(slug, `/pages/${id}/images`), { method: "POST", body }),
  confirmImage: (slug: string, id: string, imageId: string) =>
    api<{ imageId: string }>(w(slug, `/pages/${id}/images/${imageId}/confirm`), { method: "POST" }),
  /** Dirección de lectura de una imagen (dura un minuto). */
  imageUrl: (slug: string, id: string, imageId: string) =>
    api<{ url: string }>(w(slug, `/pages/${id}/images/${imageId}`)),
  /** Personas que se pueden mencionar, con si ya ven la página. */
  mentionCandidates: (slug: string, id: string, q: string) =>
    api<{ items: MentionCandidate[] }>(w(slug, `/pages/${id}/mention-candidates?${query({ q })}`)),
  save: (slug: string, id: string, body: { baseRevision: number; content: unknown }) =>
    api<SaveResult>(w(slug, `/pages/${id}/content`), {
      method: "PUT",
      body,
    }),
};

export interface CommentView {
  id: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  body: string;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
  canDelete: boolean;
}

export interface ThreadView {
  id: string;
  /** Texto del fragmento comentado (null: comentario general). */
  quote: string | null;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  mine: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  canResolve: boolean;
  comments: CommentView[];
}

export interface ThreadResult {
  thread: ThreadView;
  withoutAccess: WithoutAccess;
}

export const commentsApi = {
  list: (
    slug: string,
    pageId: string,
    q: { status: "open" | "resolved" | "all"; mine?: boolean; cursor?: string; pageSize?: number },
  ) =>
    api<Page<ThreadView>>(
      w(
        slug,
        `/pages/${pageId}/comments?${query({
          status: q.status,
          mine: q.mine === true ? "true" : undefined,
          dir: "desc",
          cursor: q.cursor,
          pageSize: q.pageSize ?? 25,
        })}`,
      ),
    ),
  create: (slug: string, pageId: string, body: { body: string; quote?: string }) =>
    api<ThreadResult>(w(slug, `/pages/${pageId}/comments`), { method: "POST", body }),
  reply: (slug: string, pageId: string, threadId: string, body: string) =>
    api<ThreadResult>(w(slug, `/pages/${pageId}/comments/${threadId}/replies`), {
      method: "POST",
      body: { body },
    }),
  resolve: (slug: string, pageId: string, threadId: string, resolved: boolean) =>
    api<{ thread: ThreadView }>(
      w(slug, `/pages/${pageId}/comments/${threadId}/${resolved ? "resolve" : "reopen"}`),
      { method: "POST" },
    ),
  edit: (slug: string, pageId: string, threadId: string, commentId: string, body: string) =>
    api<ThreadResult>(w(slug, `/pages/${pageId}/comments/${threadId}/messages/${commentId}`), {
      method: "PATCH",
      body: { body },
    }),
  remove: (slug: string, pageId: string, threadId: string, commentId: string) =>
    api<{ threadDeleted: boolean; thread: ThreadView | null }>(
      w(slug, `/pages/${pageId}/comments/${threadId}/messages/${commentId}`),
      { method: "DELETE" },
    ),
};

export const trashApi = {
  versions: (slug: string, id: string, cursor?: string) =>
    api<Page<VersionView>>(w(slug, `/files/${id}/versions?${query({ cursor, pageSize: 50 })}`)),
  restoreVersion: (slug: string, id: string, version: number) =>
    api<{ node: NodeView }>(w(slug, `/files/${id}/versions/${String(version)}/restore`), {
      method: "POST",
    }),
  trashNode: (slug: string, id: string) =>
    api<undefined>(w(slug, `/nodes/${id}`), { method: "DELETE" }),
  trash: (slug: string, spaceId: string, cursor?: string) =>
    api<Page<TrashItemView>>(
      w(slug, `/spaces/${spaceId}/trash?${query({ cursor, pageSize: 50 })}`),
    ),
  restoreNode: (slug: string, id: string) =>
    api<{ node: { id: string; parentId: string | null; name: string } }>(
      w(slug, `/nodes/${id}/restore`),
      { method: "POST" },
    ),
  purgeNode: (slug: string, id: string) =>
    api<undefined>(w(slug, `/nodes/${id}/purge`), { method: "DELETE" }),
};

/** Se puede ver en el navegador (PDF, imágenes y texto): el mismo criterio que el servidor. */
export function previewKind(mimeType: string | null): "pdf" | "image" | "text" | null {
  if (mimeType === null) return null;
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
    return "image";
  }
  if (mimeType.startsWith("text/plain") || mimeType.startsWith("text/csv")) return "text";
  return null;
}

export const levelRank: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, MANAGE: 4 };
export const canEdit = (level: AccessLevel): boolean => levelRank[level] >= levelRank.EDIT;
export const canManage = (level: AccessLevel): boolean => level === "MANAGE";

export type ImportSkipReason =
  | "invalidPath"
  | "tooDeep"
  | "systemFile"
  | "unsupportedType"
  | "empty"
  | "tooLarge"
  | "nameTaken"
  | "noPermission"
  | "encrypted"
  | "symlink"
  | "suspiciousRatio"
  | "sizeMismatch"
  | "contentMismatch"
  | "overQuota"
  | "tooMany";

export interface ImportSkipped {
  path: string;
  reason: ImportSkipReason;
}

export interface ImportPlan {
  folders: { created: number; reused: number };
  accepted: { path: string; parentId: string | null; name: string; size: number }[];
  skipped: ImportSkipped[];
  totalBytes: number;
}

export interface ZipImportSummary {
  imported: number;
  skippedCount: number;
  skipped: ImportSkipped[];
  duplicates: number;
  folders: number;
  bytes: number;
}

export interface ZipImportView {
  id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  summary: ZipImportSummary | null;
  error: string | null;
}

export const importsApi = {
  plan: (
    slug: string,
    spaceId: string,
    body: { parentId: string | null; entries: { path: string; size: number }[] },
  ) => api<ImportPlan>(w(slug, `/spaces/${spaceId}/import-plan`), { method: "POST", body }),
  startZip: (slug: string, nodeId: string, newFolder: boolean) =>
    api<{ import: ZipImportView }>(w(slug, `/files/${nodeId}/import-zip`), {
      method: "POST",
      body: { newFolder },
    }),
  get: (slug: string, id: string) => api<{ import: ZipImportView }>(w(slug, `/imports/${id}`)),
};
