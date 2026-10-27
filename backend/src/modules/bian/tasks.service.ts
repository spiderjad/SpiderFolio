// Tareas de Bian sobre UN documento: resumirlo y explicar qué cambió entre dos versiones.
// Mismas reglas que las preguntas: solo lo que la persona puede ver, solo la versión vigente al
// resumir, prompt fijo, el documento como dato (bloque de documento, nunca en el prompt), sin
// herramientas, consulta devuelta si falla, y auditoría sin contenido.
import Anthropic from "@anthropic-ai/sdk";
import { bianTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { compareVersions, diffBlocks, type DiffBlock } from "../documents/compare.service.ts";
import {
  assertBianAvailable,
  bianAvailability,
  type BianDeps,
  type BianDoc,
  type BianEvent,
} from "./ask.service.ts";
import { sourceOf } from "./indexer.ts";
import { flagSuspiciousDocuments } from "./injection.ts";
import { ASK_MODEL, changesSystem, summarySystem } from "./prompts.ts";
import { getAiUsage, reserveAiQuery } from "./usage.service.ts";

/** Tope de texto que se manda a resumir (≈ 20.000 tokens). */
const MAX_SUMMARY_CHARS = 80_000;
/** Tope de la lista de cambios que se manda a explicar. */
const MAX_CHANGES_CHARS = 14_000;
const MAX_LINE = 400;

type Emit = (event: BianEvent) => void;

const clean = (value: string) =>
  Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : char;
  }).join("");

interface TaskInput {
  action: "ai.summarize" | "ai.diff";
  nodeId: string;
  system: string;
  documentTitle: string;
  documentText: string;
  instruction: string;
  doc: BianDoc;
  notice?: string;
}

async function finishWithoutModel(
  ctx: AdminContext,
  deps: BianDeps,
  emit: Emit,
  task: Pick<TaskInput, "action" | "nodeId" | "doc">,
  answer: string,
): Promise<void> {
  await auditAdmin(ctx, {
    action: task.action,
    entityType: "Node",
    entityId: task.nodeId,
    metadata: { outcome: "no_evidence", model: ASK_MODEL },
  });
  emit({
    type: "done",
    outcome: "no_evidence",
    answer,
    sources: [],
    usage: await getAiUsage(ctx, deps),
    doc: task.doc,
  });
}

async function runTask(
  ctx: AdminContext,
  deps: BianDeps,
  task: TaskInput,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const { anthropic } = deps;
  if (anthropic === null) throw new AppError("UNAVAILABLE", { message: bianTexts.unavailable });
  // LIMIT_REACHED sale como excepción: todavía no se mandó ningún evento.
  const reservation = await reserveAiQuery(ctx, deps);
  let answer = "";
  let inputTokens: number;
  let outputTokens: number;
  let outcome: "answered" | "refused" = "answered";
  try {
    const stream = anthropic.messages.stream(
      {
        model: ASK_MODEL,
        max_tokens: 1200,
        system: task.system,
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "text", media_type: "text/plain", data: clean(task.documentText) },
                title: clean(task.documentTitle).slice(0, 200),
              },
              { type: "text", text: task.instruction },
            ],
          },
        ],
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        answer += event.delta.text;
        emit({ type: "delta", text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    inputTokens = final.usage.input_tokens;
    outputTokens = final.usage.output_tokens;
    if (final.stop_reason === "refusal") {
      outcome = "refused";
      answer = bianTexts.refused;
    }
  } catch (error) {
    await reservation.refund();
    await auditAdmin(ctx, {
      action: task.action,
      entityType: "Node",
      entityId: task.nodeId,
      metadata: { outcome: "error", model: ASK_MODEL },
    });
    if (signal.aborted) return;
    if (error instanceof Anthropic.APIError) {
      throw new AppError("UNAVAILABLE", { message: bianTexts.providerError });
    }
    throw error;
  }
  if (outcome === "refused") await reservation.refund();
  await auditAdmin(ctx, {
    action: task.action,
    entityType: "Node",
    entityId: task.nodeId,
    metadata: { outcome, model: ASK_MODEL, inputTokens, outputTokens },
  });
  emit({
    type: "done",
    outcome,
    answer,
    sources: [],
    usage: await getAiUsage(ctx, deps),
    doc: task.doc,
    ...(task.notice === undefined ? {} : { notice: task.notice }),
  });
}

async function nodeInfo(ctx: AdminContext, nodeId: string) {
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: {
      id: true,
      name: true,
      type: true,
      spaceId: true,
      parentId: true,
      controlled: { select: { code: true, publishedVersion: true } },
    },
  });
  if (node === null || node.type === "FOLDER") {
    throw new AppError("BAD_REQUEST", { message: bianTexts.notADocument });
  }
  return node;
}

/** Resume el documento: su versión vigente (o el texto actual si no es controlado). */
export async function summarizeDocument(
  ctx: AdminContext,
  deps: BianDeps,
  input: { nodeId: string },
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  assertBianAvailable(await bianAvailability(ctx, deps));
  const node = await nodeInfo(ctx, input.nodeId);
  const doc: BianDoc = {
    nodeId: node.id,
    nodeType: node.type,
    spaceId: node.spaceId,
    parentId: node.parentId,
    title: node.name,
    code: node.controlled?.code ?? null,
    version: node.controlled?.publishedVersion ?? null,
  };
  const source = await sourceOf(ctx.db, node.id);
  const text =
    source === null
      ? ""
      : source.sections
          .map((section) =>
            section.heading === null ? section.text : `${section.heading}\n${section.text}`,
          )
          .join("\n\n")
          .trim();
  if (text === "") {
    await finishWithoutModel(
      ctx,
      deps,
      emit,
      { action: "ai.summarize", nodeId: node.id, doc },
      bianTexts.noText,
    );
    return;
  }
  await flagSuspiciousDocuments(ctx, [
    { nodeId: node.id, title: node.name, code: doc.code, text: text.slice(0, MAX_SUMMARY_CHARS) },
  ]);
  const truncated = text.length > MAX_SUMMARY_CHARS;
  await runTask(
    ctx,
    deps,
    {
      action: "ai.summarize",
      nodeId: node.id,
      system: summarySystem(),
      documentTitle: [doc.code, doc.version === null ? null : `v${String(doc.version)}`, doc.title]
        .filter((part) => part !== null)
        .join(" · "),
      documentText: text.slice(0, MAX_SUMMARY_CHARS),
      instruction: "Resume este documento.",
      doc,
      ...(truncated ? { notice: bianTexts.summaryTruncated } : {}),
    },
    emit,
    signal,
  );
}

function wordsOf(change: Extract<DiffBlock, { kind: "changed" }>): {
  before: string;
  after: string;
} {
  let before = "";
  let after = "";
  for (const word of change.words) {
    if (word.op !== "add") before += word.text;
    if (word.op !== "remove") after += word.text;
  }
  return { before, after };
}

const shorten = (text: string) => (text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text);

/** Lista de cambios para el modelo: «+» agregado, «-» quitado, «~» antes → después. */
export function changesToText(blocks: readonly DiffBlock[]): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let size = 0;
  let truncated = false;
  for (const block of blocks) {
    if (block.kind === "same") continue;
    const line =
      block.kind === "added"
        ? `+ ${shorten(block.text)}`
        : block.kind === "removed"
          ? `- ${shorten(block.text)}`
          : (() => {
              const { before, after } = wordsOf(block);
              return `~ ${shorten(before)} → ${shorten(after)}`;
            })();
    if (size + line.length > MAX_CHANGES_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return { text: lines.join("\n"), truncated };
}

/** Explica qué cambió entre dos versiones (por defecto, la vigente contra la última). */
export async function explainChanges(
  ctx: AdminContext,
  deps: BianDeps,
  input: { nodeId: string; from?: number | undefined; to?: number | undefined },
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  assertBianAvailable(await bianAvailability(ctx, deps));
  const node = await nodeInfo(ctx, input.nodeId);
  if (node.controlled === null) {
    throw new AppError("BAD_REQUEST", { message: bianTexts.notControlled });
  }
  // compareVersions ya aplica quién puede ver cada versión (borradores solo quien edita o aprueba).
  const comparison = await compareVersions(ctx, node.id, {
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.to === undefined ? {} : { to: input.to }),
  });
  const doc: BianDoc = {
    nodeId: node.id,
    nodeType: node.type,
    spaceId: node.spaceId,
    parentId: node.parentId,
    title: node.name,
    code: node.controlled.code,
    version: comparison.to.version,
  };
  const task = { action: "ai.diff" as const, nodeId: node.id, doc };
  if (comparison.from === null) {
    await finishWithoutModel(ctx, deps, emit, task, bianTexts.singleVersion);
    return;
  }

  let blocks: readonly DiffBlock[] = comparison.blocks;
  if (comparison.type === "FILE") {
    // Archivos: se comparan los textos extraídos de cada versión del archivo.
    const versions = await ctx.db.documentVersion.findMany({
      where: { nodeId: node.id, version: { in: [comparison.from.version, comparison.to.version] } },
      select: { version: true, fileVersion: true },
    });
    const textOf = async (version: number): Promise<string[] | null> => {
      const fileVersion = versions.find((v) => v.version === version)?.fileVersion;
      if (fileVersion === null || fileVersion === undefined) return null;
      const file = await ctx.db.fileText.findFirst({
        where: { nodeId: node.id, version: fileVersion, status: "OK" },
        select: { text: true },
      });
      return file === null
        ? null
        : file.text
            .split(/\n+/)
            .map((line) => line.trim())
            .filter((line) => line !== "");
    };
    const [before, after] = await Promise.all([
      textOf(comparison.from.version),
      textOf(comparison.to.version),
    ]);
    if (before === null || after === null) {
      await finishWithoutModel(ctx, deps, emit, task, bianTexts.noText);
      return;
    }
    blocks = diffBlocks(before.slice(0, 5000), after.slice(0, 5000)).blocks;
  }

  const { text, truncated } = changesToText(blocks);
  if (text === "") {
    await finishWithoutModel(ctx, deps, emit, task, bianTexts.noChanges);
    return;
  }
  const label = [node.controlled.code, node.name].join(" · ");
  await runTask(
    ctx,
    deps,
    {
      ...task,
      system: changesSystem(),
      documentTitle: `Cambios entre v${String(comparison.from.version)} y v${String(comparison.to.version)} de ${label}`,
      documentText: text,
      instruction: `Explica qué cambió entre la versión ${String(comparison.from.version)} y la versión ${String(comparison.to.version)}.`,
      ...(truncated ? { notice: bianTexts.changesTruncated } : {}),
    },
    emit,
    signal,
  );
}
