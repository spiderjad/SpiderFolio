// Hoja de etiquetas A4 en PDF: el mismo QR repetido en una grilla, con el código, el título y el área
// debajo de cada uno, en tamaño chico, mediano o grande. El QR se dibuja como vectores (nítido al
// imprimir) con el recuadro blanco y la telaraña del centro.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { safe, wrap } from "../documents/pdf.ts";
import { logoBox, qrMatrix, QUIET_MODULES, webInModules } from "./qr-render.ts";

export const LABEL_SIZES = ["small", "medium", "large"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 28.35; // 10 mm

/** Columnas, filas y tamaños de letra de cada formato. */
const LAYOUT: Record<
  LabelSize,
  { columns: number; rows: number; code: number; title: number; area: number }
> = {
  small: { columns: 4, rows: 6, code: 8, title: 6.5, area: 6 },
  medium: { columns: 2, rows: 3, code: 13, title: 10, area: 8.5 },
  large: { columns: 1, rows: 2, code: 20, title: 15, area: 12 },
};

export interface LabelInput {
  url: string;
  /** Código del documento controlado (PRC-001); null si no es controlado. */
  code: string | null;
  title: string;
  area: string | null;
  size: LabelSize;
}

export async function renderLabelsPdf(input: LabelInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([A4.width, A4.height]);
  const layout = LAYOUT[input.size];
  const cellWidth = (A4.width - MARGIN * 2) / layout.columns;
  const cellHeight = (A4.height - MARGIN * 2) / layout.rows;
  const pad = Math.max(4, cellWidth * 0.04);
  const matrix = qrMatrix(input.url);
  const total = matrix.size + QUIET_MODULES * 2;
  const box = logoBox(matrix.size);
  const web = webInModules(matrix.size);
  const textHeight = layout.code * 1.3 + layout.title * 1.25 * 2 + layout.area * 1.3 + pad;
  const qr = Math.min(cellWidth - pad * 2, cellHeight - textHeight - pad * 2);

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const left = MARGIN + column * cellWidth;
      const top = A4.height - MARGIN - row * cellHeight;
      // Marco fino: guía de corte.
      page.drawRectangle({
        x: left,
        y: top - cellHeight,
        width: cellWidth,
        height: cellHeight,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.4,
      });
      const unit = qr / total;
      const originX = left + (cellWidth - qr) / 2;
      const originY = top - pad - qr;
      page.drawRectangle({ x: originX, y: originY, width: qr, height: qr, color: rgb(1, 1, 1) });
      for (let y = 0; y < matrix.size; y += 1) {
        let x = 0;
        while (x < matrix.size) {
          const hidden = (cx: number) =>
            cx >= box.x && cx < box.x + box.side && y >= box.y && y < box.y + box.side;
          if (matrix.dark(x, y) && !hidden(x)) {
            const start = x;
            while (x < matrix.size && matrix.dark(x, y) && !hidden(x)) x += 1;
            page.drawRectangle({
              x: originX + (start + QUIET_MODULES) * unit,
              y: originY + qr - (y + QUIET_MODULES + 1) * unit,
              width: (x - start) * unit,
              height: unit,
              color: rgb(0, 0, 0),
            });
          } else {
            x += 1;
          }
        }
      }
      page.drawRectangle({
        x: originX + (box.x + QUIET_MODULES) * unit,
        y: originY + qr - (box.y + QUIET_MODULES + box.side) * unit,
        width: box.side * unit,
        height: box.side * unit,
        color: rgb(1, 1, 1),
      });
      for (const s of web.segments) {
        page.drawLine({
          start: {
            x: originX + (s.x1 + QUIET_MODULES) * unit,
            y: originY + qr - (s.y1 + QUIET_MODULES) * unit,
          },
          end: {
            x: originX + (s.x2 + QUIET_MODULES) * unit,
            y: originY + qr - (s.y2 + QUIET_MODULES) * unit,
          },
          thickness: web.width * unit,
          color: rgb(0, 0, 0),
        });
      }

      // Texto centrado debajo.
      let y = originY - pad;
      const centered = (text: string, size: number, useBold: boolean, gray = 0) => {
        const f = useBold ? bold : font;
        const clean = safe(text, f);
        y -= size * 1.15;
        page.drawText(clean, {
          x: left + (cellWidth - f.widthOfTextAtSize(clean, size)) / 2,
          y,
          size,
          font: f,
          color: rgb(gray, gray, gray),
        });
        y -= size * 0.15;
      };
      if (input.code !== null) centered(input.code, layout.code, true);
      const lines = wrap(safe(input.title, bold), bold, layout.title, cellWidth - pad * 2).slice(
        0,
        2,
      );
      for (const line of lines) centered(line, layout.title, true);
      if (input.area !== null) centered(input.area, layout.area, false, 0.35);
    }
  }
  return await pdf.save();
}
