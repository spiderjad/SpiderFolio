// Preguntas a Bian: recuperar fragmentos que la persona puede ver, responder SOLO con ellos y citar.
//
// Seguridad (el contenido de los documentos es dato no confiable):
//   · el prompt de sistema es fijo (prompts.ts) y los documentos van solo como bloques de documento;
//   · el modelo no recibe herramientas: no puede actuar ni leer más de lo recuperado;
//   · la conversación previa solo sirve para reescribir la pregunta (modelo liviano); a Sonnet le llega
//     la pregunta sola y los fragmentos, así un turno falsificado en el historial no lo gobierna;
//   · toda cita se valida contra los fragmentos recuperados; una respuesta sin citas válidas se
//     reemplaza por «No encontré esto en tus documentos.»;
//   · la auditoría guarda solo ids, tamaños y resultado: nunca la pregunta ni la respuesta.
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../../config/env.ts";
import type { NodeType } from "../../generated/prisma/client.ts";
import { bianTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { readBianEnabled, readBianGuests } from "../workspaces/settings.ts";
import { ASK_MODEL, askSystem, LIGHT_MODEL, rewriteSystem } from "./prompts.ts";
import { tableExcerpt, type TableExcerpt } from "./excerpt.ts";
import { flagSuspiciousDocuments } from "./injection.ts";
import { fuzzyWords } from "./query-terms.ts";
import { retrieveFragments, type Fragment } from "./retrieval.ts";
import { getAiUsage, reserveAiQuery, type AiUsage } from "./usage.service.ts";

export interface BianDeps {
  env: Pick<Env, "BIAN_ENABLED">;
  prisma: PrismaClient;
  /** null si Bian no está habilitado en el servidor. */
  anthropic: Anthropic | null;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BianSource {
  /** Número que aparece en el texto como [n]. */
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
  /** Lo citado, recortado. */
  quote: string;
  /** «Ficha del documento»: los datos de control, no un pasaje de su texto. */
  card?: boolean;
  /** Si lo citado es una tabla: el encabezado y solo las filas que importan para la pregunta. */
  table?: TableExcerpt;
}

/** Documento sobre el que trabajó Bian (resumir, qué cambió). */
export interface BianDoc {
  nodeId: string;
  nodeType: NodeType;
  spaceId: string;
  parentId: string | null;
  title: string;
  code: string | null;
  version: number | null;
}

export type BianOutcome = "answered" | "no_evidence" | "refused" | "error";

export type BianEvent =
  | { type: "delta"; text: string }
  /** La búsqueda terminó: ahora Bian redacta (antes del primer texto). */
  | { type: "status"; phase: "writing" }
  /** Falló después de empezar a responder: ya no se puede cambiar el estado HTTP, viaja como evento. */
  | { type: "error"; code: string; message: string }
  | {
      type: "done";
      outcome: BianOutcome;
      /** Texto final (puede reemplazar al que se fue mostrando). */
      answer: string;
      sources: BianSource[];
      usage: AiUsage;
      /** Documento sobre el que trabajó (resumir, qué cambió). */
      doc?: BianDoc;
      /** Aviso que acompaña a la respuesta (ej. el documento era muy largo). */
      notice?: string;
    };

export type BianAvailability =
  { available: true } | { available: false; reason: "server" | "workspace" | "guests" };

/** ¿Puede esta persona usar a Bian hoy? (servidor, ajuste del propietario, invitados). */
export async function bianAvailability(
  ctx: AdminContext,
  deps: Pick<BianDeps, "anthropic">,
): Promise<BianAvailability> {
  if (deps.anthropic === null) return { available: false, reason: "server" };
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  if (!readBianEnabled(workspace?.settings)) return { available: false, reason: "workspace" };
  if (ctx.tenant.role.base === "GUEST" && !readBianGuests(workspace?.settings)) {
    return { available: false, reason: "guests" };
  }
  return { available: true };
}

export function assertBianAvailable(availability: BianAvailability): void {
  if (availability.available) return;
  const message =
    availability.reason === "workspace"
      ? bianTexts.workspaceOff
      : availability.reason === "guests"
        ? bianTexts.guestsOff
        : bianTexts.unavailable;
  throw new AppError(availability.reason === "server" ? "UNAVAILABLE" : "FORBIDDEN", { message });
}

const MAX_QUOTE = 240;
/** Quita caracteres de control (menos salto de línea y tabulación): no tienen lugar en un prompt. */
const clean = (value: string) =>
  Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : char;
  }).join("");

/** Título del bloque de documento: lo que el modelo ve de cada fragmento. */
function documentTitle(fragment: Fragment): string {
  const parts = [
    fragment.code === null ? null : fragment.code,
    fragment.version === null ? null : `v${String(fragment.version)}`,
    fragment.title,
    fragment.heading,
  ].filter((part): part is string => part !== null && part !== "");
  return clean(parts.join(" · ")).slice(0, 200);
}

/** Reescribe la pregunta para que se entienda sola (solo si hay conversación previa). */
async function standaloneQuestion(
  anthropic: Anthropic,
  question: string,
  history: readonly HistoryTurn[],
  signal: AbortSignal,
): Promise<string> {
  if (history.length === 0) return question;
  const transcript = history
    .map((turn) => `${turn.role === "user" ? "Persona" : "Bian"}: ${clean(turn.content)}`)
    .join("\n");
  try {
    const response = await anthropic.messages.create(
      {
        model: LIGHT_MODEL,
        max_tokens: 300,
        system: rewriteSystem(),
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: `${transcript}\n\nPregunta nueva: ${clean(question)}`,
          },
        ],
      },
      { signal },
    );
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join(" ")
      .trim();
    return text === "" || text.length > 600 ? question : text;
  } catch {
    return question;
  }
}

interface AuditInfo {
  outcome: BianOutcome | "limit";
  inputTokens?: number;
  outputTokens?: number;
  fragments: number;
  nodeIds: string[];
  reformulated: boolean;
}

async function auditAsk(ctx: AdminContext, info: AuditInfo): Promise<void> {
  await auditAdmin(ctx, {
    action: "ai.ask",
    entityType: "Workspace",
    entityId: ctx.tenant.workspaceId,
    metadata: {
      outcome: info.outcome,
      model: ASK_MODEL,
      ...(info.inputTokens === undefined ? {} : { inputTokens: info.inputTokens }),
      ...(info.outputTokens === undefined ? {} : { outputTokens: info.outputTokens }),
      fragments: info.fragments,
      nodeIds: info.nodeIds,
      reformulated: info.reformulated,
    },
  });
}

/** Pregunta a Bian. Los errores previos al primer evento salen como excepción (JSON normal). */
export async function askBian(
  ctx: AdminContext,
  deps: BianDeps,
  input: { question: string; history: readonly HistoryTurn[] },
  emit: (event: BianEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const availability = await bianAvailability(ctx, deps);
  assertBianAvailable(availability);
  const { anthropic } = deps;
  if (anthropic === null) throw new AppError("UNAVAILABLE", { message: bianTexts.unavailable });

  const standalone = await standaloneQuestion(anthropic, input.question, input.history, signal);
  const reformulated = standalone !== input.question;
  const fragments = await retrieveFragments(ctx, deps, standalone);
  // Instrucciones para el asistente dentro de los documentos: se ignoran y queda un aviso en la auditoría.
  await flagSuspiciousDocuments(ctx, fragments);

  if (fragments.length === 0) {
    // Sin evidencia no se llama al modelo ni se descuenta la consulta.
    await auditAsk(ctx, { outcome: "no_evidence", fragments: 0, nodeIds: [], reformulated });
    emit({
      type: "done",
      outcome: "no_evidence",
      answer: bianTexts.noEvidence,
      sources: [],
      usage: await getAiUsage(ctx, deps),
    });
    return;
  }

  // LIMIT_REACHED sale como excepción: todavía no se mandó ningún evento.
  const reservation = await reserveAiQuery(ctx, deps);
  emit({ type: "status", phase: "writing" });
  const nodeIds = [...new Set(fragments.map((fragment) => fragment.nodeId))];
  let answer = "";
  // Cada pasaje citado (no cada fragmento) es una fuente: si una respuesta cita varios pasos de una
  // misma sección, cada paso apunta a su propio texto y el enlace resalta ese texto.
  const passages: { index: number; key: string; quote: string }[] = [];
  let inputTokens: number;
  let outputTokens: number;
  let outcome: BianOutcome = "answered";

  try {
    const stream = anthropic.messages.stream(
      {
        model: ASK_MODEL,
        max_tokens: 1500,
        system: askSystem(),
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              ...fragments.map((fragment): Anthropic.DocumentBlockParam => ({
                type: "document",
                source: { type: "text", media_type: "text/plain", data: clean(fragment.text) },
                title: documentTitle(fragment),
                citations: { enabled: true },
              })),
              { type: "text", text: `Pregunta de la persona: ${clean(standalone)}` },
            ],
          },
        ],
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        answer += event.delta.text;
        emit({ type: "delta", text: event.delta.text });
      } else if (event.delta.type === "citations_delta") {
        const citation: unknown = event.delta.citation;
        const index =
          typeof citation === "object" && citation !== null && "document_index" in citation
            ? citation.document_index
            : undefined;
        if (typeof index === "number" && index >= 0 && index < fragments.length) {
          const detail = citation as {
            cited_text?: unknown;
            start_char_index?: unknown;
            end_char_index?: unknown;
          };
          const cited = typeof detail.cited_text === "string" ? detail.cited_text : "";
          const range =
            typeof detail.start_char_index === "number" && typeof detail.end_char_index === "number"
              ? `${String(detail.start_char_index)}-${String(detail.end_char_index)}`
              : cited.trim();
          const key = `${String(index)}:${range}`;
          let position = passages.findIndex((passage) => passage.key === key);
          if (position === -1) {
            passages.push({ index, key, quote: cited.slice(0, MAX_QUOTE) });
            position = passages.length - 1;
          }
          const marker = ` [${String(position + 1)}]`;
          answer += marker;
          emit({ type: "delta", text: marker });
        }
      }
    }
    const final = await stream.finalMessage();
    inputTokens = final.usage.input_tokens;
    outputTokens = final.usage.output_tokens;
    if (final.stop_reason === "refusal") {
      outcome = "refused";
      answer = bianTexts.refused;
    } else if (answer.includes(bianTexts.noEvidence) || passages.length === 0) {
      // Sin evidencia, o una respuesta sin una sola cita válida: nunca se muestra como respuesta.
      outcome = "no_evidence";
      answer = bianTexts.noEvidence;
      passages.length = 0;
    }
  } catch (error) {
    await reservation.refund();
    await auditAsk(ctx, { outcome: "error", fragments: fragments.length, nodeIds, reformulated });
    if (signal.aborted) return;
    if (error instanceof Anthropic.APIError) {
      throw new AppError("UNAVAILABLE", { message: bianTexts.providerError });
    }
    throw error;
  }

  if (outcome !== "answered") await reservation.refund();
  const sources = passages.flatMap((passage, position): BianSource[] => {
    const fragment = fragments[passage.index];
    if (fragment === undefined) return [];
    const excerpt = tableExcerpt(fragment.text, passage.quote, fuzzyWords(standalone));
    return [
      {
        n: position + 1,
        chunkId: fragment.chunkId,
        nodeId: fragment.nodeId,
        nodeType: fragment.nodeType,
        title: fragment.title,
        code: fragment.code,
        version: fragment.version,
        heading: fragment.heading,
        seq: fragment.seq,
        spaceId: fragment.spaceId,
        parentId: fragment.parentId,
        quote: passage.quote,
        ...(fragment.card === true ? { card: true } : {}),
        ...(excerpt === null ? {} : { table: excerpt }),
      },
    ];
  });
  await auditAsk(ctx, {
    outcome,
    inputTokens,
    outputTokens,
    fragments: fragments.length,
    nodeIds: sources.map((source) => source.nodeId),
    reformulated,
  });
  emit({ type: "done", outcome, answer, sources, usage: await getAiUsage(ctx, deps) });
}
