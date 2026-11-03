// «Sugerir con Bian» in the expiry dialog (docs/spec/vencimientos.md): Bian reads the element's text and
// proposes a date, a note and a responsible. Nothing is saved: the person reviews and saves. Same rules as
// Bian's other tasks: only for whoever can set the expiry, only the current version, a fixed prompt with
// the document as data, the company's quota (refunded if it fails) and an audit without content.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { bianTexts } from "../../i18n/index.ts";
import { AppError, forbidden } from "../../lib/errors.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertBianAvailable, bianAvailability, type BianDeps } from "../bian/ask.service.ts";
import { sourceOf } from "../bian/indexer.ts";
import { flagSuspiciousDocuments } from "../bian/injection.ts";
import { ASK_MODEL, expirySuggestSystem } from "../bian/prompts.ts";
import { getAiUsage, reserveAiQuery, type AiUsage } from "../bian/usage.service.ts";
import { whoCanSee } from "../documents/readings.core.ts";
import { loadNode } from "./node-expiries.service.ts";

/** How much of the document is sent (≈ 10.000 tokens): dates are usually near the start or the end. */
const MAX_CHARS = 40_000;

const SuggestionSchema = z.object({
  dueOn: z.string(),
  evidence: z.string(),
  note: z.string(),
  responsible: z.string(),
});

/** What the model sees (structured output): every field, empty when it doesn't apply. */
const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dueOn", "evidence", "note", "responsible"],
  properties: {
    dueOn: { type: "string" },
    evidence: { type: "string" },
    note: { type: "string" },
    responsible: { type: "string" },
  },
} as const;

export interface ExpirySuggestion {
  /** «YYYY-MM-DD», or null when the document gives no clear date. */
  dueOn: string | null;
  /** The document's words the date comes from. */
  evidence: string | null;
  note: string | null;
  /** Only when the name matches exactly one person or department of the company. */
  responsible: { type: "person" | "department"; id: string; name: string; canSee: boolean } | null;
}

const clean = (value: string) =>
  Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : char;
  }).join("");

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** A name the document gives → the one person or department it is, if exactly one. */
async function matchResponsible(
  ctx: AdminContext,
  nodeId: string,
  name: string,
): Promise<ExpirySuggestion["responsible"]> {
  const wanted = name.trim();
  if (wanted === "" || wanted.length > 120) return null;
  const departments = await ctx.db.department.findMany({
    where: { name: { equals: wanted, mode: "insensitive" } },
    select: { id: true, name: true },
    take: 2,
  });
  const people = await ctx.db.membership.findMany({
    where: { status: "ACTIVE", user: { name: { equals: wanted, mode: "insensitive" } } },
    select: { id: true, user: { select: { name: true } } },
    take: 2,
  });
  if (departments.length + people.length !== 1) return null;
  const department = departments[0];
  if (department !== undefined) return { type: "department", ...department, canSee: true };
  const person = people[0];
  if (person === undefined) return null;
  const seeing = await whoCanSee(ctx.db, nodeId, [person.id]);
  return { type: "person", id: person.id, name: person.user.name, canSee: seeing.has(person.id) };
}

export async function suggestExpiry(
  ctx: AdminContext,
  deps: BianDeps,
  nodeId: string,
  signal: AbortSignal,
): Promise<{ suggestion: ExpirySuggestion; usage: AiUsage }> {
  // Only whoever can set it (another company's element is 404), and before spending a query.
  const { node, canEdit } = await loadNode(ctx, nodeId);
  if (!canEdit) throw forbidden();
  assertBianAvailable(await bianAvailability(ctx, deps));
  const { anthropic } = deps;
  if (anthropic === null) throw new AppError("UNAVAILABLE", { message: bianTexts.unavailable });
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
  if (text === "") throw new AppError("BAD_REQUEST", { message: bianTexts.noText });
  const sent =
    text.length > MAX_CHARS
      ? `${text.slice(0, MAX_CHARS / 2)}\n\n[…]\n\n${text.slice(-MAX_CHARS / 2)}`
      : text;
  await flagSuspiciousDocuments(ctx, [
    { nodeId: node.id, title: node.name, code: null, text: sent },
  ]);
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const today = dayIn(new Date(), zoneOf(workspace?.settings));

  const reservation = await reserveAiQuery(ctx, deps);
  let raw: z.infer<typeof SuggestionSchema>;
  let inputTokens: number;
  let outputTokens: number;
  try {
    const response = await anthropic.messages.create(
      {
        model: ASK_MODEL,
        max_tokens: 600,
        system: expirySuggestSystem(today),
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: SUGGESTION_JSON_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "text", media_type: "text/plain", data: clean(sent) },
                title: clean(node.name).slice(0, 200),
              },
              { type: "text", text: "Busca el vencimiento de este documento." },
            ],
          },
        ],
      },
      { signal },
    );
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    if (response.stop_reason === "refusal") {
      throw new AppError("BAD_REQUEST", { message: bianTexts.refused });
    }
    const parsed = SuggestionSchema.safeParse(
      JSON.parse(
        response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      ),
    );
    if (!parsed.success) throw new AppError("UNAVAILABLE", { message: bianTexts.providerError });
    raw = parsed.data;
  } catch (error) {
    await reservation.refund();
    await auditAdmin(ctx, {
      action: "ai.expiry_suggest",
      entityType: "Node",
      entityId: node.id,
      metadata: { outcome: "error", model: ASK_MODEL },
    });
    if (error instanceof AppError) throw error;
    if (error instanceof Anthropic.APIError || error instanceof SyntaxError) {
      throw new AppError("UNAVAILABLE", { message: bianTexts.providerError });
    }
    throw error;
  }
  const dueOn = isDay(raw.dueOn.trim()) ? raw.dueOn.trim() : null;
  const suggestion: ExpirySuggestion = {
    dueOn,
    evidence: raw.evidence.trim() === "" ? null : raw.evidence.trim().slice(0, 300),
    note: raw.note.trim() === "" ? null : raw.note.trim().slice(0, 500),
    responsible: await matchResponsible(ctx, node.id, raw.responsible),
  };
  await auditAdmin(ctx, {
    action: "ai.expiry_suggest",
    entityType: "Node",
    entityId: node.id,
    metadata: {
      outcome: dueOn === null ? "no_evidence" : "answered",
      model: ASK_MODEL,
      inputTokens,
      outputTokens,
    },
  });
  return { suggestion, usage: await getAiUsage(ctx, deps) };
}
