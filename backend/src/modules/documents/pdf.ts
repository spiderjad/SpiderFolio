// PDF controlado (9C.5): el HTML de una página con su hoja de control, la llamada a Gotenberg y, en
// cada descarga, la marca de agua «Copia no controlada» (y «OBSOLETO» en diagonal) con pdf-lib.
// La hoja de control de un PDF subido se agrega también al descargarlo; el original no se toca.
import { escapeHtml } from "@spiderfolio/content";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import { AppError } from "../../lib/errors.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { contentMessages, controlledPdfTexts } from "../../i18n/index.ts";

export interface ControlInfo {
  workspaceName: string;
  code: string;
  title: string;
  version: number;
  /** Fecha de entrada en vigor, ya escrita («23 de octubre de 2026»). */
  effective: string;
  elaboratedBy: string | null;
  approvedBy: { name: string; at: string }[];
}

const STYLE = `
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 1.2em 0 .4em; } h2 { font-size: 15pt; margin: 1.1em 0 .4em; } h3 { font-size: 12.5pt; margin: 1em 0 .3em; }
  p { margin: .4em 0; } ul, ol { margin: .4em 0; padding-left: 1.4em; } ul.tasks { list-style: none; padding-left: 0; }
  blockquote { margin: .6em 0; padding-left: 1em; border-left: 3px solid #bbb; color: #444; }
  pre { background: #f3f3f3; padding: 8px; white-space: pre-wrap; font-size: 9.5pt; } code { font-family: monospace; }
  table { border-collapse: collapse; width: 100%; margin: .6em 0; } td, th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; } th { background: #eee; text-align: left; }
  .callout { margin: .6em 0; padding: 6px 12px; border-left: 4px solid #6d28d9; background: #f5f0ff; }
  .callout.warning { border-color: #d97706; background: #fff7e6; } .callout.danger { border-color: #dc2626; background: #fdecec; } .callout.success { border-color: #16a34a; background: #eaf7ee; }
  figure { margin: .8em 0; text-align: center; } img { max-width: 100%; } .missing { color: #777; font-style: italic; }
  .columns { display: flex; gap: 16px; } .column { flex: 1; min-width: 0; } .summary { font-weight: bold; }
  table.control { margin: 0 0 1.2em; font-size: 10pt; } table.control th { width: 28%; }
`;

/** Las filas de la hoja de control, en el idioma activo. */
function controlRows(info: ControlInfo): [string, string][] {
  const t = controlledPdfTexts;
  return [
    [t.code, info.code],
    [t.title, info.title],
    [t.version, String(info.version)],
    [t.effective, info.effective],
    [t.elaboratedBy, info.elaboratedBy ?? "—"],
    [
      t.approvedBy,
      info.approvedBy.length === 0
        ? "—"
        : info.approvedBy.map((a) => `${a.name} (${a.at})`).join(", "),
    ],
  ];
}

/** La página lista para Gotenberg: hoja de control al principio y después el texto. */
export function controlledHtml(
  info: ControlInfo,
  body: string,
): {
  html: string;
  header: string;
  footer: string;
} {
  const rows = controlRows(info);
  const control = `<table class="control">${rows
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("")}</table>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  return {
    html: `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${control}${body}</body></html>`,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} display:flex; justify-content:space-between;"><span>${escapeHtml(info.workspaceName)}</span><span>${escapeHtml(info.code)} · v${String(info.version)} · ${escapeHtml(info.title)}</span></div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${controlledPdfTexts.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  };
}

/** Pide el PDF a Gotenberg (solo red interna). */
export async function renderWithGotenberg(
  baseUrl: string,
  parts: { html: string; header: string; footer: string },
): Promise<Uint8Array> {
  const form = new FormData();
  form.append("files", new Blob([parts.html], { type: "text/html" }), "index.html");
  form.append("files", new Blob([parts.header], { type: "text/html" }), "header.html");
  form.append("files", new Blob([parts.footer], { type: "text/html" }), "footer.html");
  for (const [key, value] of Object.entries({
    paperWidth: "8.27",
    paperHeight: "11.7",
    marginTop: "0.9",
    marginBottom: "0.8",
    marginLeft: "0.7",
    marginRight: "0.7",
    printBackground: "true",
  })) {
    form.append(key, value);
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError("UNAVAILABLE");
  }
  if (!response.ok) throw new AppError("UNAVAILABLE");
  return new Uint8Array(await response.arrayBuffer());
}

/** Solo los caracteres que la fuente estándar puede escribir (lo demás se cambia por «?»). */
export function safe(text: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(text, (char) => (set.has(char.codePointAt(0) ?? 0) ? char : "?")).join("");
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u)) {
    const next = line === "" ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(next, size) > width && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Hoja de control al principio de un PDF subido. */
async function addControlSheet(pdf: PDFDocument, info: ControlInfo): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.insertPage(0, [595.28, 841.89]);
  let y = 780;
  page.drawText(safe(controlledPdfTexts.sheetTitle, bold), { x: 56, y, size: 18, font: bold });
  y -= 14;
  page.drawText(safe(info.workspaceName, font), {
    x: 56,
    y,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 36;
  const rows = controlRows(info);
  for (const [key, value] of rows) {
    page.drawText(safe(key, bold), { x: 56, y, size: 11, font: bold });
    for (const line of wrap(safe(value, font), font, 11, 360)) {
      page.drawText(line, { x: 170, y, size: 11, font });
      y -= 16;
    }
    y -= 6;
  }
  y -= 20;
  for (const line of wrap(
    safe(controlledPdfTexts.sheetNote, font),
    font,
    9,
    480,
  )) {
    page.drawText(line, { x: 56, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 12;
  }
}

/**
 * Estampa «Copia no controlada · descargada por …» al pie de cada página y, si el documento es
 * obsoleto, «OBSOLETO» en diagonal. Con `info`, agrega antes la hoja de control (PDF subidos).
 */
export async function stampPdf(
  bytes: Uint8Array,
  options: { watermark: string; obsolete: boolean; controlSheet?: ControlInfo },
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new AppError("BAD_REQUEST", { message: contentMessages.pdfUnreadable });
  }
  if (options.controlSheet !== undefined) await addControlSheet(pdf, options.controlSheet);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = safe(options.watermark, font);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(text, { x: 28, y: 14, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
    if (options.obsolete) {
      const size = Math.min(width, height) / 6;
      page.drawText(safe(controlledPdfTexts.obsolete, bold), {
        x: width * 0.16,
        y: height * 0.28,
        size,
        font: bold,
        color: rgb(0.85, 0.1, 0.1),
        opacity: 0.28,
        rotate: degrees(45),
      });
    }
  }
  return await pdf.save();
}
