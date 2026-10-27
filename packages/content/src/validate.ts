// Validación del contenido de una página en el servidor: es la única defensa contra documentos
// arbitrarios. Se reconstruye el documento con el schema del producto (lo desconocido no entra),
// se revisan enlaces e identificadores y se devuelve la forma canónica, lista para guardar.
import type { JSONContent } from "@tiptap/core";
import { ALLOWED_LINK, contentSchema } from "./extensions.ts";

/** Tamaño máximo del documento serializado, en caracteres (el cuerpo de la API ya se limita a 1 MB). */
export const MAX_CONTENT_CHARS = 900_000;
const MAX_TEXT_CHARS = 300_000;

export const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

export type ContentIssue = "too_large" | "invalid" | "unsafe_link";

export interface ValidContent {
  ok: true;
  /** El documento en su forma canónica (sin atributos ni nodos desconocidos). */
  content: JSONContent;
  /** Texto plano, para búsquedas futuras. */
  text: string;
  /** Imágenes que referencia (deben ser de la misma página). */
  imageIds: string[];
  /** Personas mencionadas (membresías). */
  mentionIds: string[];
  /** Hilos de comentario anclados. */
  threadIds: string[];
}

export type ContentResult = ValidContent | { ok: false; issue: ContentIssue };

export function validateContent(input: unknown): ContentResult {
  if (input === undefined) return { ok: false, issue: "invalid" };
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return { ok: false, issue: "invalid" };
  }
  if (serialized.length > MAX_CONTENT_CHARS) return { ok: false, issue: "too_large" };

  const schema = contentSchema();
  let doc;
  try {
    doc = schema.nodeFromJSON(input);
    if (doc.type.name !== "doc") return { ok: false, issue: "invalid" };
    doc.check();
  } catch {
    return { ok: false, issue: "invalid" };
  }

  const imageIds = new Set<string>();
  const mentionIds = new Set<string>();
  const threadIds = new Set<string>();
  const state = { unsafe: false };
  doc.descendants((node) => {
    if (node.type.name === "pageImage") {
      const id: unknown = node.attrs.imageId;
      if (typeof id !== "string" || id === "") state.unsafe = true;
      else imageIds.add(id);
    }
    if (node.type.name === "pageLink" || node.type.name === "fileEmbed") {
      const id: unknown = node.attrs.nodeId;
      if (typeof id !== "string" || id === "") state.unsafe = true;
    }
    if (node.type.name === "mention") {
      const id: unknown = node.attrs.membershipId;
      if (typeof id !== "string" || id === "") state.unsafe = true;
      else mentionIds.add(id);
    }
    for (const mark of node.marks) {
      if (mark.type.name === "link") {
        const href: unknown = mark.attrs.href;
        if (typeof href !== "string" || !ALLOWED_LINK.test(href)) state.unsafe = true;
      }
      if (mark.type.name === "commentThread") {
        const id: unknown = mark.attrs.threadId;
        if (typeof id !== "string" || id === "") state.unsafe = true;
        else threadIds.add(id);
      }
    }
    return true;
  });
  if (state.unsafe) return { ok: false, issue: "unsafe_link" };

  return {
    ok: true,
    content: doc.toJSON() as JSONContent,
    text: doc.textBetween(0, doc.content.size, "\n", " ").slice(0, MAX_TEXT_CHARS),
    imageIds: [...imageIds],
    mentionIds: [...mentionIds],
    threadIds: [...threadIds],
  };
}

/**
 * El documento sin las marcas de hilos de comentarios (forma canónica ya validada). Sirve para saber
 * si un cambio solo agrega o quita comentarios anclados: quien solo puede comentar (nivel COMMENT)
 * puede guardar esos cambios y ningún otro.
 */
export function withoutThreadMarks(node: JSONContent): JSONContent {
  const { marks, content, ...rest } = node;
  const kept = marks?.filter((mark) => mark.type !== "commentThread");
  return {
    ...rest,
    ...(kept !== undefined && kept.length > 0 ? { marks: kept } : {}),
    ...(content === undefined ? {} : { content: content.map(withoutThreadMarks) }),
  };
}
