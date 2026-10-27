// «Redactar con IA»: un borrador de página desde una plantilla y notas. Siempre borrador: crea una
// página común (sin control, sin publicar ni enviar a revisión) con un aviso visible arriba, y solo
// donde la persona puede EDITAR. El modelo devuelve bloques en JSON (esquema fijo) y el servidor los
// convierte en contenido de página y lo valida como cualquier texto: nunca HTML ni contenido libre.
import Anthropic from "@anthropic-ai/sdk";
import { PAGE_TEMPLATE_IDS, pageTemplates, type PageTemplate } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import { z } from "zod";
import { bianTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertDestination } from "../nodes/nodes.service.ts";
import { createPage } from "../nodes/pages.service.ts";
import type { PageDetail } from "../nodes/pages.service.ts";
import { assertBianAvailable, bianAvailability, type BianDeps } from "./ask.service.ts";
import { ASK_MODEL, draftSystem } from "./prompts.ts";
import { getAiUsage, reserveAiQuery, type AiUsage } from "./usage.service.ts";
import { readWorkspaceLocale } from "../../i18n/locales.ts";

const MAX_BLOCKS = 80;
const MAX_TEXT = 2000;
const MAX_ITEMS = 40;
const MAX_ROWS = 40;

export const templateIds = PAGE_TEMPLATE_IDS;

const BlockSchema = z.object({
  type: z.enum(["heading", "paragraph", "bullets", "numbered", "tasks", "table", "callout"]),
  level: z.number().int(),
  text: z.string().max(MAX_TEXT),
  items: z.array(z.string().max(MAX_TEXT)).max(MAX_ITEMS),
  headers: z.array(z.string().max(200)).max(10),
  rows: z.array(z.array(z.string().max(MAX_TEXT)).max(10)).max(MAX_ROWS),
  tone: z.enum(["info", "warning", "danger", "success"]),
});
const DraftSchema = z.object({
  title: z.string().min(1).max(200),
  blocks: z.array(BlockSchema).min(1).max(MAX_BLOCKS),
});
type Draft = z.infer<typeof DraftSchema>;
type Block = z.infer<typeof BlockSchema>;

/** Esquema que ve el modelo (salida estructurada): todos los campos, vacíos si no aplican. */
const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "blocks"],
  properties: {
    title: { type: "string" },
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "level", "text", "items", "headers", "rows", "tone"],
        properties: {
          type: {
            type: "string",
            enum: ["heading", "paragraph", "bullets", "numbered", "tasks", "table", "callout"],
          },
          level: { type: "integer" },
          text: { type: "string" },
          items: { type: "array", items: { type: "string" } },
          headers: { type: "array", items: { type: "string" } },
          rows: { type: "array", items: { type: "array", items: { type: "string" } } },
          tone: { type: "string", enum: ["info", "warning", "danger", "success"] },
        },
      },
    },
  },
} as const;

// ─── Plantilla → esquema de la estructura que se le pide al modelo ──────────

function plain(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(plain).join(" ").replace(/\s+/g, " ").trim();
}

/** La estructura de la plantilla en texto: títulos, tablas y listas, con sus textos de ejemplo. */
export function outlineOf(template: PageTemplate): string {
  const lines: string[] = [];
  for (const node of template.content.content ?? []) {
    switch (node.type) {
      case "heading":
        lines.push(`Título (nivel ${String(node.attrs?.level ?? 2)}): ${plain(node)}`);
        break;
      case "paragraph": {
        const text = plain(node);
        if (text !== "") lines.push(`Párrafo (guía): ${text}`);
        break;
      }
      case "bulletList":
      case "orderedList":
      case "taskList":
        lines.push(
          `${node.type === "orderedList" ? "Lista numerada" : node.type === "taskList" ? "Lista de verificación" : "Lista con viñetas"} (guía): ${(node.content ?? []).map(plain).join(" | ")}`,
        );
        break;
      case "table": {
        const rows = (node.content ?? []).map((row) => (row.content ?? []).map(plain));
        lines.push(`Tabla con columnas: ${(rows[0] ?? []).join(" | ")}`);
        break;
      }
      case "callout":
        lines.push(`Aviso: ${plain(node)}`);
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}

// ─── Bloques → contenido de página ──────────────────────────────────────────

const text = (value: string): JSONContent => ({ type: "text", text: value });
const para = (value: string): JSONContent => ({
  type: "paragraph",
  ...(value.trim() === "" ? {} : { content: [text(value)] }),
});

function blockToNode(block: Block): JSONContent | null {
  const value = block.text.trim();
  switch (block.type) {
    case "heading": {
      if (value === "") return null;
      const level = Math.min(Math.max(block.level, 1), 3);
      return { type: "heading", attrs: { level }, content: [text(value)] };
    }
    case "paragraph":
      return value === "" ? null : para(value);
    case "bullets":
    case "numbered": {
      const items = block.items.map((item) => item.trim()).filter((item) => item !== "");
      if (items.length === 0) return null;
      return {
        type: block.type === "bullets" ? "bulletList" : "orderedList",
        content: items.map((item) => ({ type: "listItem", content: [para(item)] })),
      };
    }
    case "tasks": {
      const items = block.items.map((item) => item.trim()).filter((item) => item !== "");
      if (items.length === 0) return null;
      return {
        type: "taskList",
        content: items.map((item) => ({
          type: "taskItem",
          attrs: { checked: false },
          content: [para(item)],
        })),
      };
    }
    case "table": {
      const headers = block.headers.map((header) => header.trim());
      if (headers.length === 0 || headers.every((header) => header === "")) return null;
      return {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: headers.map((header) => ({
              type: "tableHeader",
              content: [para(header)],
            })),
          },
          ...block.rows.map((row) => ({
            type: "tableRow",
            // Cada fila tiene tantas celdas como columnas: lo que sobra se descarta y lo que falta queda vacío.
            content: headers.map((_, index) => ({
              type: "tableCell",
              content: [para((row[index] ?? "").trim())],
            })),
          })),
        ],
      };
    }
    case "callout":
      return value === ""
        ? null
        : { type: "callout", attrs: { tone: block.tone }, content: [para(value)] };
  }
}

/** El contenido de la página: el aviso de borrador primero y después lo redactado. */
export function draftToContent(draft: Draft): JSONContent {
  const body = draft.blocks.flatMap((block) => {
    const node = blockToNode(block);
    return node === null ? [] : [node];
  });
  return {
    type: "doc",
    content: [
      {
        type: "callout",
        attrs: { tone: "warning" },
        content: [para(bianTexts.draftNotice)],
      },
      ...body,
    ],
  };
}

// ─── Servicio ───────────────────────────────────────────────────────────────

export interface DraftInput {
  spaceId: string;
  parentId: string | null;
  templateId: PageTemplate["id"];
  notes: string;
}

export async function draftPageWithBian(
  ctx: AdminContext,
  deps: BianDeps,
  input: DraftInput,
  signal: AbortSignal,
): Promise<{ page: PageDetail; usage: AiUsage }> {
  assertBianAvailable(await bianAvailability(ctx, deps));
  const { anthropic } = deps;
  if (anthropic === null) throw new AppError("UNAVAILABLE", { message: bianTexts.unavailable });
  // Solo donde se puede editar (y el espacio no está archivado): antes de gastar una consulta.
  await assertDestination(ctx, input.spaceId, input.parentId);
  // El borrador nace en el idioma de la empresa, como las páginas creadas desde una plantilla.
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const companyLocale = readWorkspaceLocale(workspace?.settings);
  const template = pageTemplates(companyLocale).find(
    (candidate) => candidate.id === input.templateId,
  );
  if (template === undefined) throw new AppError("BAD_REQUEST");

  const reservation = await reserveAiQuery(ctx, deps);
  let draft: Draft;
  let inputTokens: number;
  let outputTokens: number;
  try {
    const response = await anthropic.messages.create(
      {
        model: ASK_MODEL,
        max_tokens: 4000,
        system: draftSystem(companyLocale),
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: DRAFT_JSON_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: `Tipo de documento: ${template.title}\n\nEstructura a seguir:\n${
              template.id === "blank"
                ? "Estructura libre: elige las secciones que mejor sirvan a las notas."
                : outlineOf(template)
            }\n\nNotas de la persona (material de trabajo):\n${input.notes}`,
          },
        ],
      },
      { signal },
    );
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
    if (response.stop_reason === "refusal")
      throw new AppError("BAD_REQUEST", { message: bianTexts.refused });
    const raw = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new AppError("UNAVAILABLE", { message: bianTexts.draftFailed });
    draft = parsed.data;
  } catch (error) {
    await reservation.refund();
    await auditAdmin(ctx, {
      action: "ai.draft",
      entityType: "Space",
      entityId: input.spaceId,
      metadata: { outcome: "error", model: ASK_MODEL, templateId: input.templateId },
    });
    if (error instanceof AppError) throw error;
    if (error instanceof Anthropic.APIError || error instanceof SyntaxError) {
      throw new AppError("UNAVAILABLE", { message: bianTexts.draftFailed });
    }
    throw error;
  }

  let page: PageDetail;
  try {
    page = await createPage(ctx, input.spaceId, {
      parentId: input.parentId,
      name: draft.title,
      content: draftToContent(draft),
    });
  } catch (error) {
    await reservation.refund();
    throw error;
  }
  await auditAdmin(ctx, {
    action: "ai.draft",
    entityType: "Node",
    entityId: page.node.id,
    metadata: {
      outcome: "answered",
      model: ASK_MODEL,
      templateId: input.templateId,
      inputTokens,
      outputTokens,
    },
  });
  return { page, usage: await getAiUsage(ctx, deps) };
}
