// Tipos de archivo permitidos (docs/spec/archivos.md, sección 11): PDF, DOCX, XLSX, PPTX, ODT,
// ODS, TXT, CSV, PNG, JPG, WEBP y ZIP. La extensión elige el tipo; el contenido real (magic bytes
// con file-type) tiene que coincidir. Lo demás se rechaza: ejecutables, scripts y, sobre todo,
// HTML y SVG (riesgo de XSS), aunque vengan con otra extensión.
import { fileTypeFromBuffer } from "file-type";

export interface FileKind {
  /** Extensión en minúsculas, sin punto. */
  ext: string;
  /** Tipos que puede detectar file-type para esta extensión. */
  detected: readonly string[];
  /** Tipo con que se guarda y se sirve. */
  contentType: string;
  /** Texto plano: no tiene firma, se valida el contenido. */
  text: boolean;
  /** Se puede ver en el navegador (PDF, imágenes y texto). */
  preview: "pdf" | "image" | "text" | null;
}

const ZIP = "application/zip";
const OOXML = "application/vnd.openxmlformats-officedocument";
const ODF = "application/vnd.oasis.opendocument";

const kinds: readonly FileKind[] = [
  {
    ext: "pdf",
    detected: ["application/pdf"],
    contentType: "application/pdf",
    text: false,
    preview: "pdf",
  },
  {
    ext: "docx",
    detected: [`${OOXML}.wordprocessingml.document`, ZIP],
    contentType: `${OOXML}.wordprocessingml.document`,
    text: false,
    preview: null,
  },
  {
    ext: "xlsx",
    detected: [`${OOXML}.spreadsheetml.sheet`, ZIP],
    contentType: `${OOXML}.spreadsheetml.sheet`,
    text: false,
    preview: null,
  },
  {
    ext: "pptx",
    detected: [`${OOXML}.presentationml.presentation`, ZIP],
    contentType: `${OOXML}.presentationml.presentation`,
    text: false,
    preview: null,
  },
  {
    ext: "odt",
    detected: [`${ODF}.text`, ZIP],
    contentType: `${ODF}.text`,
    text: false,
    preview: null,
  },
  {
    ext: "ods",
    detected: [`${ODF}.spreadsheet`, ZIP],
    contentType: `${ODF}.spreadsheet`,
    text: false,
    preview: null,
  },
  {
    ext: "txt",
    detected: [],
    contentType: "text/plain; charset=utf-8",
    text: true,
    preview: "text",
  },
  {
    ext: "csv",
    detected: [],
    contentType: "text/csv; charset=utf-8",
    text: true,
    preview: "text",
  },
  { ext: "png", detected: ["image/png"], contentType: "image/png", text: false, preview: "image" },
  {
    ext: "jpg",
    detected: ["image/jpeg"],
    contentType: "image/jpeg",
    text: false,
    preview: "image",
  },
  {
    ext: "jpeg",
    detected: ["image/jpeg"],
    contentType: "image/jpeg",
    text: false,
    preview: "image",
  },
  {
    ext: "webp",
    detected: ["image/webp"],
    contentType: "image/webp",
    text: false,
    preview: "image",
  },
  { ext: "zip", detected: [ZIP], contentType: ZIP, text: false, preview: null },
];

/** Cuánto del principio del archivo se mira para detectar el tipo. */
export const INSPECT_BYTES = 256 * 1024;

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** El tipo permitido para ese nombre, o null si la extensión no está permitida. */
export function kindOfFileName(fileName: string): FileKind | null {
  const ext = extensionOf(fileName);
  return kinds.find((kind) => kind.ext === ext) ?? null;
}

/** Tipo con que se sirve una versión guardada (null si el valor no es uno de los nuestros). */
export function kindOfContentType(contentType: string): FileKind | null {
  return kinds.find((kind) => kind.contentType === contentType) ?? null;
}

export type InspectResult = { ok: true } | { ok: false; reason: "mismatch" | "binary" | "markup" };

// HTML, SVG, XML y scripts disfrazados de texto.
const BOM = String.fromCharCode(0xfeff);
const MARKUP = new RegExp(
  String.raw`^[\s${BOM}]*(?:<!doctype\s+html|<html|<svg|<\?xml|<script|<iframe|<body|<head)`,
  "i",
);

/** Verifica que el principio del archivo sea de verdad lo que dice su extensión. */
export async function inspectContent(kind: FileKind, head: Buffer): Promise<InspectResult> {
  const detected = await fileTypeFromBuffer(head);
  if (kind.text) {
    // Los textos no tienen firma: si se detecta algo (un PDF, un ejecutable), no es texto.
    if (detected !== undefined) return { ok: false, reason: "mismatch" };
    if (head.subarray(0, 8192).includes(0)) return { ok: false, reason: "binary" };
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
      if (MARKUP.test(text)) return { ok: false, reason: "markup" };
    } catch {
      return { ok: false, reason: "binary" };
    }
    return { ok: true };
  }
  if (detected === undefined || !kind.detected.includes(detected.mime)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/** Extensiones permitidas, para mostrarlas en mensajes y en la interfaz. */
export const allowedExtensions: readonly string[] = kinds.map((kind) => kind.ext);
