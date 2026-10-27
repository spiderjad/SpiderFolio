// Troceado del texto para Bian (funciones puras). Cada fragmento es lo que se busca, se cita y se
// manda al modelo: unos 1.800 caracteres (≈ 450 tokens), siempre dentro de una sección, con el
// encabezado como ancla para el enlace. El `contentHash` deja reindexar solo lo que cambió.
import { contentToBlocks } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import { sha256 } from "../../lib/crypto.ts";

export const CHUNK_MAX_CHARS = 1800;
/** Un fragmento más corto que esto se une al anterior de su sección (si cabe). */
export const CHUNK_MIN_CHARS = 200;

export interface Section {
  /** Encabezado de la sección; null para lo que va antes del primero. */
  heading: string | null;
  text: string;
}

export interface Chunk {
  seq: number;
  heading: string | null;
  text: string;
  contentHash: string;
  /** Estimación (caracteres / 4); sirve para armar el contexto, no para facturar. */
  tokens: number;
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const normalize = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Parte un texto largo sin cortar palabras: primero por oraciones y, si hace falta, por espacios. */
function splitLong(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentence = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
      window.lastIndexOf("\n"),
    );
    const cut = sentence > max * 0.4 ? sentence + 1 : Math.max(window.lastIndexOf(" "), max * 0.6);
    const at = Math.floor(cut);
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}

/** Fragmentos de una sección: se juntan párrafos hasta `max` caracteres. */
function chunkSection(section: Section, max: number): string[] {
  const paragraphs = normalize(section.text)
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .flatMap((p) => (p.length > max ? splitLong(p, max) : [p]));
  const out: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current !== "" && current.length + paragraph.length + 1 > max) {
      out.push(current);
      current = paragraph;
    } else {
      current = current === "" ? paragraph : `${current}\n${paragraph}`;
    }
  }
  if (current !== "") out.push(current);
  // Un resto muy corto se pega al fragmento anterior si cabe.
  const last = out.at(-1);
  const prev = out.at(-2);
  if (last !== undefined && prev !== undefined && last.length < CHUNK_MIN_CHARS) {
    if (prev.length + last.length + 1 <= max) {
      out.splice(-2, 2, `${prev}\n${last}`);
    }
  }
  return out;
}

/** Trocea las secciones en orden; `seq` es correlativo en todo el documento. */
export function chunkSections(sections: readonly Section[], max = CHUNK_MAX_CHARS): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const text of chunkSection(section, max)) {
      chunks.push({
        seq: chunks.length,
        heading: section.heading,
        text,
        // El hash incluye el encabezado: cambiar el título de la sección cambia el ancla.
        contentHash: sha256(`${section.heading ?? ""}\n${text}`),
        tokens: estimateTokens(text),
      });
    }
  }
  return chunks;
}

/** Texto plano (archivos, PDF, DOCX): una sola sección sin encabezado. */
export function sectionsOfPlainText(text: string): Section[] {
  return [{ heading: null, text }];
}

/** El texto corrido de un nodo, sin marcas de formato. */
function plainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(plainText).join(" ").replace(/\s+/g, " ").trim();
}

const headingText = plainText;

/**
 * Una tabla como texto que se lee solo, sin las barras del Markdown: con encabezado, cada fila es
 * «Columna: valor; Columna: valor»; sin encabezado, los valores van separados por « · ».
 */
export function tableLines(table: JSONContent): string[] {
  const rows = (table.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      header: cell.type === "tableHeader",
      text: plainText(cell),
    })),
  );
  const first = rows[0];
  const hasHeader = first !== undefined && first.length > 0 && first.every((cell) => cell.header);
  const headers = hasHeader ? first.map((cell) => cell.text) : [];
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((row) => {
      const cells = row.map((cell, index) => ({ label: headers[index] ?? "", text: cell.text }));
      return hasHeader
        ? cells
            .filter((cell) => cell.text !== "")
            .map((cell) => (cell.label === "" ? cell.text : `${cell.label}: ${cell.text}`))
            .join("; ")
        : cells
            .map((cell) => cell.text)
            .filter((text) => text !== "")
            .join(" · ");
    })
    .filter((line) => line !== "");
}

/** Las líneas de un bloque para Bian: tablas y avisos legibles; lo demás, como en la búsqueda. */
function linesOf(node: JSONContent): string[] {
  switch (node.type) {
    case "table":
      return tableLines(node);
    case "callout": {
      const text = plainText(node);
      return text === "" ? [] : [text];
    }
    case "columns":
    case "column":
    case "toggle":
      return (node.content ?? []).flatMap(linesOf);
    default:
      return contentToBlocks({ type: "doc", content: [node] });
  }
}

/** Secciones de un documento Tiptap: cada título abre una sección nueva. */
export function sectionsOfDoc(doc: JSONContent): Section[] {
  const sections: Section[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  const flush = () => {
    const text = current.lines.join("\n").trim();
    if (text !== "") sections.push({ heading: current.heading, text });
  };
  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      flush();
      const heading = headingText(node);
      current = { heading: heading === "" ? null : heading, lines: [] };
    } else {
      current.lines.push(...linesOf(node));
    }
  }
  flush();
  return sections;
}

/** Huella de un documento troceado: dice qué fragmentos hay que reescribir (cambió el hash). */
export function diffChunks(
  existing: readonly { seq: number; contentHash: string }[],
  next: readonly Chunk[],
): { write: Chunk[]; deleteFromSeq: number | null } {
  const byseq = new Map(existing.map((chunk) => [chunk.seq, chunk.contentHash]));
  const write = next.filter((chunk) => byseq.get(chunk.seq) !== chunk.contentHash);
  const deleteFromSeq = existing.some((chunk) => chunk.seq >= next.length) ? next.length : null;
  return { write, deleteFromSeq };
}
