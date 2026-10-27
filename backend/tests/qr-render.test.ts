// Códigos QR: el PNG que se descarga se tiene que poder leer, con el logo en el centro, y el recuadro
// del logo no puede pasar del 20 % del área.
import { inflateSync } from "node:zlib";
import jsqrModule from "jsqr";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderLabelsPdf } from "../src/modules/qr/labels.ts";
import {
  logoBox,
  qrMatrix,
  QUIET_MODULES,
  renderPixels,
  renderPng,
  renderSvg,
} from "../src/modules/qr/qr-render.ts";

type Decode = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
// Según cómo se cargue el módulo, la función llega como `default` o es el propio módulo.
const jsQR =
  (jsqrModule as unknown as { default?: Decode }).default ?? (jsqrModule as unknown as Decode);

const URLS = [
  "https://app.ejemplo.com/q/AbCdEfGhIjKlMnOpQrStUv",
  // Más larga: un símbolo más grande, con más módulos tapados por el logo.
  "https://app.subdominio-largo.ejemplo-empresa.com/q/AbCdEfGhIjKlMnOpQrStUv?origen=etiqueta-planta-1",
];

/** Lee un PNG de escala de grises de 8 bits sin filtros (el que produce renderPng). */
function decodeGrayPng(png: Buffer): { width: number; rgba: Uint8ClampedArray } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let offset = 8;
  let width = 0;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      expect(body[8]).toBe(8);
      expect(body[9]).toBe(0);
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    expect(raw[y * (width + 1)]).toBe(0);
    for (let x = 0; x < width; x += 1) {
      const gray = raw[y * (width + 1) + 1 + x] ?? 0;
      const at = (y * width + x) * 4;
      rgba[at] = gray;
      rgba[at + 1] = gray;
      rgba[at + 2] = gray;
      rgba[at + 3] = 255;
    }
  }
  return { width, rgba };
}

describe("QR con logo", () => {
  it.each(URLS)("el PNG con el logo se lee: %s", (url) => {
    const { width, rgba } = decodeGrayPng(renderPng(url));
    const read = jsQR(rgba, width, width);
    expect(read?.data).toBe(url);
  });

  it("también se lee con otros tamaños de módulo", () => {
    for (const scale of [6, 8, 20]) {
      const { width, pixels } = renderPixels(URLS[0] ?? "", scale);
      const rgba = new Uint8ClampedArray(width * width * 4);
      pixels.forEach((gray, index) => {
        rgba.fill(gray, index * 4, index * 4 + 3);
        rgba[index * 4 + 3] = 255;
      });
      expect(jsQR(rgba, width, width)?.data).toBe(URLS[0]);
    }
  });

  it("el recuadro del logo ocupa como máximo el 20 % del área y queda centrado", () => {
    for (const url of URLS) {
      const { size } = qrMatrix(url);
      const box = logoBox(size);
      expect((box.side * box.side) / (size * size)).toBeLessThanOrEqual(0.2);
      expect(box.x).toBe(size - box.side - box.x);
      expect(box.side).toBeGreaterThanOrEqual(7);
    }
  });

  it("deja zona de silencio blanca alrededor", () => {
    const scale = 10;
    const { width, pixels } = renderPixels(URLS[0] ?? "", scale);
    const margin = QUIET_MODULES * scale;
    for (let i = 0; i < width; i += 1) {
      for (let k = 0; k < margin; k += 1) {
        expect(pixels[k * width + i]).toBe(255);
        expect(pixels[(width - 1 - k) * width + i]).toBe(255);
        expect(pixels[i * width + k]).toBe(255);
        expect(pixels[i * width + (width - 1 - k)]).toBe(255);
      }
    }
  });

  it("el SVG trae el logo y la zona de silencio", () => {
    const svg = renderSvg(URLS[0] ?? "");
    const { size } = qrMatrix(URLS[0] ?? "");
    expect(svg).toContain(
      `viewBox="0 0 ${String(size + QUIET_MODULES * 2)} ${String(size + QUIET_MODULES * 2)}"`,
    );
    expect(svg).toContain('stroke="#000"');
    expect(svg).not.toContain("<script");
  });
});

describe("hoja de etiquetas", () => {
  it.each(["small", "medium", "large"] as const)("%s: una hoja A4", async (size) => {
    const bytes = await renderLabelsPdf({
      url: URLS[0] ?? "",
      code: "PRC-001",
      title: "Procedimiento de limpieza de la línea de envasado, con un título largo que se corta",
      area: "Producción ñandú",
      size,
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  });
});
