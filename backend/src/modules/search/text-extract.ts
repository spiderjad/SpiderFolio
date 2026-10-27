// Texto de los PDF y DOCX subidos, para buscar adentro. Se extrae en el worker (nunca en el pedido
// de quien sube): un archivo raro o enorme no frena a nadie ni tumba la API.
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const EXTRACTABLE_MIMES = [PDF_MIME, DOCX_MIME] as const;

/** Tamaño máximo de archivo que se analiza, y de texto que se guarda. */
export const MAX_EXTRACT_BYTES = 30 * 1024 * 1024;
export const MAX_TEXT_CHARS = 300_000;

export const isExtractable = (mimeType: string | null): boolean =>
  mimeType !== null && (EXTRACTABLE_MIMES as readonly string[]).includes(mimeType);

/** Los caracteres de control (menos el salto de línea y el tabulador) no sirven para buscar. */
function isControl(code: number): boolean {
  return (code < 32 && code !== 9 && code !== 10) || code === 127;
}

/** Espacios y saltos de línea normalizados, sin caracteres de control, con tope de largo. */
export function cleanText(raw: string): string {
  let text = "";
  for (const char of raw) text += isControl(char.codePointAt(0) ?? 0) ? " " : char;
  return text
    .replace(/[\t\p{Zs}]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export async function extractText(mimeType: string, data: Buffer): Promise<string> {
  if (mimeType === PDF_MIME) {
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const result = await parser.getText();
      return cleanText(result.text);
    } finally {
      await parser.destroy();
    }
  }
  if (mimeType === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer: data });
    return cleanText(result.value);
  }
  return "";
}
