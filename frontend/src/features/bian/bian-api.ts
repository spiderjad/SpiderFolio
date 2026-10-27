// Cliente de Bian: preguntas con respuesta en streaming (SSE), uso del período y valoraciones.
import { api, ApiError, apiStream, apiText } from "@/lib/api";
import type { Page } from "@/features/files/api";

export type NodeType = "PAGE" | "FILE" | "FOLDER";

export interface BianSource {
  n: number;
  chunkId: string;
  nodeId: string;
  nodeType: NodeType;
  title: string;
  code: string | null;
  version: number | null;
  heading: string | null;
  seq: number;
  spaceId: string;
  parentId: string | null;
  quote: string;
  /** «Ficha del documento»: los datos de control, no un pasaje de su texto. */
  card?: boolean;
  /** Si lo citado es una tabla: el encabezado y solo las filas que importan para la pregunta. */
  table?: { headers: string[]; rows: string[][]; omitted: number };
}

export interface AiUsage {
  /** Consultas usadas en la empresa este período. */
  used: number;
  /** Total de la empresa (plan + extras); null: sin límite. */
  limit: number | null;
  periodStart: string;
  periodEnd: string;
  /** Lo de quien pregunta. */
  personal: {
    used: number;
    /** null: sin tope propio. */
    limit: number | null;
    blocked: boolean;
    source: "person" | "department" | "general" | "none";
  };
  /** Lo que de verdad le queda (el menor entre lo suyo y lo de la empresa); null: sin tope. */
  remaining: number | null;
}

export type BianAvailability =
  { available: true } | { available: false; reason: "server" | "workspace" | "guests" };

export interface BianUsageResponse {
  availability: BianAvailability;
  usage: AiUsage;
}

export type BianOutcome = "answered" | "no_evidence" | "refused" | "error";

export interface BianDone {
  outcome: BianOutcome;
  answer: string;
  sources: BianSource[];
  usage: AiUsage;
  /** Documento sobre el que trabajó (resumir, qué cambió). */
  doc?: {
    nodeId: string;
    nodeType: NodeType;
    spaceId: string;
    parentId: string | null;
    title: string;
    code: string | null;
    version: number | null;
  };
  /** Aviso que acompaña a la respuesta (ej. el documento era muy largo). */
  notice?: string;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const FEEDBACK_REASONS = ["INCORRECT", "INCOMPLETE", "WRONG_SOURCE", "OTHER"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export interface FeedbackDocument {
  node: { id: string; name: string; spaceName: string };
  code: string | null;
  up: number;
  down: number;
  reasons: Record<FeedbackReason | "NONE", number>;
}

export interface FeedbackStats {
  /** Los números de lo filtrado (no solo de la página). */
  total: number;
  up: number;
  down: number;
  percentUp: number | null;
  since: string;
  until: string | null;
  documents: Page<FeedbackDocument>;
}

export interface FeedbackQuery {
  rating?: "UP" | "DOWN";
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  pageSize?: number;
}

export type LimitMode = "LIMIT" | "UNLIMITED" | "BLOCKED";

export interface LimitView {
  id: string;
  mode: LimitMode;
  limit: number | null;
}

export interface BianOverview {
  settings: { enabled: boolean; guests: boolean };
  usage: {
    used: number;
    total: number | null;
    periodStart: string;
    renewsAt: string;
  };
  limits: {
    general: LimitView | null;
    departments: (LimitView & { department: { id: string; name: string } })[];
    people: (LimitView & { person: { id: string; name: string } })[];
  };
}

export type UsageView = "people" | "departments";
export type UsageSort = "name" | "used" | "limit";

export interface PersonUsageRow {
  membershipId: string;
  name: string;
  departments: string[];
  used: number;
  mode: LimitMode;
  limit: number | null;
  source: "person" | "department" | "general" | "none";
}

export interface DepartmentUsageRow {
  departmentId: string;
  name: string;
  people: number;
  used: number;
  mode: LimitMode;
  limit: number | null;
  source: "person" | "department" | "general" | "none";
}

export interface UsageQuery {
  view: UsageView;
  q: string;
  sort: UsageSort;
  dir: "asc" | "desc";
  cursor?: string;
  pageSize?: number;
}

const params = (values: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
};

export const bianKeys = {
  usage: (slug: string) => ["w", slug, "bian", "usage"] as const,
  feedbackStats: (slug: string) => ["w", slug, "bian", "feedback-stats"] as const,
  overview: (slug: string) => ["w", slug, "bian", "overview"] as const,
  usageTable: (slug: string) => ["w", slug, "bian", "usage-table"] as const,
};

export const bianApi = {
  usage: (slug: string) => api<BianUsageResponse>(w(slug, "/bian/usage")),
  /** Crea una página en borrador con lo que Bian redacta (exige permiso de edición en el destino). */
  draft: (
    slug: string,
    body: { spaceId: string; parentId: string | null; templateId: string; notes: string },
  ) =>
    api<{ page: { node: { id: string } }; usage: AiUsage }>(w(slug, "/bian/draft"), {
      method: "POST",
      body,
    }),
  /** Guarda la valoración y devuelve su id, para poder cambiarla o quitarla. */
  feedback: (slug: string, rating: "UP" | "DOWN", nodeIds: string[]) =>
    api<{ id: string }>(w(slug, "/bian/feedback"), { method: "POST", body: { rating, nodeIds } }),
  feedbackUpdate: (
    slug: string,
    id: string,
    body: { rating?: "UP" | "DOWN"; reason?: FeedbackReason | null },
  ) => api<undefined>(w(slug, `/bian/feedback/${id}`), { method: "PATCH", body }),
  feedbackRemove: (slug: string, id: string) =>
    api<undefined>(w(slug, `/bian/feedback/${id}`), { method: "DELETE" }),
  /** Administración: valoraciones por documento citado (con filtros y cursor). */
  feedbackStats: (slug: string, query: FeedbackQuery, signal?: AbortSignal) =>
    api<FeedbackStats>(w(slug, `/admin/bian/feedback?${params({ ...query })}`), {
      ...(signal === undefined ? {} : { signal }),
    }),
  /** «Pedir más consultas»: avisa a los administradores. */
  requestMore: (slug: string) =>
    api<{ notified: number }>(w(slug, "/bian/request-more"), { method: "POST" }),
  overview: (slug: string) => api<BianOverview>(w(slug, "/admin/bian/overview")),
  /** Total de consultas por mes de toda la empresa (null: sin límite). */
  setTotal: (slug: string, total: number | null) =>
    api<BianOverview>(w(slug, "/admin/bian/total"), { method: "PUT", body: { total } }),
  updateSettings: (slug: string, body: { enabled?: boolean; guests?: boolean }) =>
    api<{ settings: BianOverview["settings"] }>(w(slug, "/admin/bian/settings"), {
      method: "PATCH",
      body,
    }),
  setLimit: (
    slug: string,
    body: {
      scope: "GENERAL" | "DEPARTMENT" | "PERSON";
      subjectId?: string;
      mode: LimitMode;
      limit?: number;
    },
  ) => api<{ limit: LimitView }>(w(slug, "/admin/bian/limits"), { method: "PUT", body }),
  removeLimit: (slug: string, id: string) =>
    api<undefined>(w(slug, `/admin/bian/limits/${id}`), { method: "DELETE" }),
  usageRows: (slug: string, query: UsageQuery, signal?: AbortSignal) =>
    api<Page<PersonUsageRow | DepartmentUsageRow>>(
      w(slug, `/admin/bian/usage?${params({ ...query })}`),
      { ...(signal === undefined ? {} : { signal }) },
    ),
  usageCsv: (slug: string, query: Omit<UsageQuery, "cursor" | "pageSize">) =>
    apiText(w(slug, `/admin/bian/usage/export?${params({ ...query })}`)),
};

/** Ruta de un documento (un archivo se abre en su carpeta). */
export function docPath(
  slug: string,
  doc: { nodeId: string; nodeType: NodeType; spaceId: string; parentId: string | null },
): string {
  const base = `/app/${slug}/files/${doc.spaceId}`;
  if (doc.nodeType === "PAGE") return `${base}/p/${doc.nodeId}`;
  return doc.parentId === null ? base : `${base}/f/${doc.parentId}`;
}

/**
 * Ruta de la fuente citada: igual que el documento y, en las páginas, con el comienzo del fragmento
 * citado (`cita`) para que se abra con ese texto resaltado y a la vista.
 */
export function sourcePath(slug: string, source: BianSource): string {
  const path = docPath(slug, source);
  const quote = source.quote.trim().slice(0, 140);
  return source.nodeType === "PAGE" && source.card !== true && quote !== ""
    ? `${path}?cita=${encodeURIComponent(quote)}`
    : path;
}

/**
 * Pide algo a Bian (pregunta, resumen, qué cambió) y entrega el texto a medida que llega. Los errores
 * previos al stream (límite, permisos) llegan como ApiError, igual que cualquier otra llamada.
 */
async function streamBian(
  slug: string,
  path: string,
  body: unknown,
  handlers: { onDelta: (text: string) => void; onStatus?: (phase: "writing") => void },
  signal: AbortSignal,
): Promise<BianDone> {
  const res = await apiStream(w(slug, path), { method: "POST", body, signal });
  if (res.body === null) throw new Error("Respuesta sin cuerpo");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: BianDone | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (data !== undefined) {
        const event = JSON.parse(data) as
          | { type: "delta"; text: string }
          | { type: "status"; phase: "writing" }
          | { type: "error"; code: string; message: string }
          | ({ type: "done" } & BianDone);
        // Falló después de empezar a responder: se muestra como cualquier otro error de la API.
        if (event.type === "error") throw new ApiError(200, event.code, event.message);
        if (event.type === "delta") handlers.onDelta(event.text);
        else if (event.type === "status") handlers.onStatus?.(event.phase);
        else done = event;
      }
      end = buffer.indexOf("\n\n");
    }
  }
  if (done === null) throw new Error("La respuesta se cortó");
  return done;
}

export function askBian(
  slug: string,
  body: { question: string; history: HistoryTurn[] },
  handlers: { onDelta: (text: string) => void; onStatus?: (phase: "writing") => void },
  signal: AbortSignal,
): Promise<BianDone> {
  return streamBian(slug, "/bian/ask", body, handlers, signal);
}

export type BianTask =
  | { kind: "summarize"; nodeId: string; name: string }
  | { kind: "changes"; nodeId: string; name: string };

/** Resumir un documento o explicar qué cambió entre sus versiones. */
export function runBianTask(
  slug: string,
  task: BianTask,
  handlers: { onDelta: (text: string) => void },
  signal: AbortSignal,
): Promise<BianDone> {
  return streamBian(
    slug,
    task.kind === "summarize" ? "/bian/summarize" : "/bian/changes",
    { nodeId: task.nodeId },
    handlers,
    signal,
  );
}

/** Lo que otras pantallas le piden a Bian: preguntar (con texto o sin él) o una tarea. */
export type BianRequest = { kind: "ask"; question: string } | BianTask;
