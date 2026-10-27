// Códigos QR con la telaraña de SpiderFolio al centro (9C.6). Todo se dibuja a partir de la matriz de
// módulos de la librería `qrcode`, con corrección de errores nivel H: así el recuadro blanco del
// centro tapa módulos sin que deje de leerse. El recuadro ocupa como máximo el 20 % del área del
// símbolo, y alrededor hay una zona de silencio de 4 módulos. SVG, PNG y PDF salen de la misma
// geometría.
import { crc32, deflateSync } from "node:zlib";
import QRCode from "qrcode";
import { qrTexts } from "../../i18n/index.ts";

/** Zona de silencio, en módulos (el mínimo que pide la norma). */
export const QUIET_MODULES = 4;
/** Lado del recuadro del logo respecto al lado del símbolo: (0,42)² = 17,6 % del área (< 20 %). */
const LOGO_SIDE = 0.42;

export interface QrMatrix {
  /** Módulos por lado (sin zona de silencio). */
  size: number;
  dark: (x: number, y: number) => boolean;
}

/** Matriz del código para un texto, con corrección de errores H. */
export function qrMatrix(text: string): QrMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel: "H" });
  const size = code.modules.size;
  const data = code.modules.data;
  return { size, dark: (x, y) => data[y * size + x] === 1 };
}

export interface LogoBox {
  /** Esquina superior izquierda y lado del recuadro blanco, en módulos del símbolo. */
  x: number;
  y: number;
  side: number;
}

/** El recuadro blanco, centrado. Su lado tiene la paridad del símbolo para que quede simétrico. */
export function logoBox(size: number): LogoBox {
  let side = Math.floor(size * LOGO_SIDE);
  if ((size - side) % 2 !== 0) side -= 1;
  const origin = (size - side) / 2;
  return { x: origin, y: origin, side };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * La telaraña: ocho radios y tres anillos octogonales, en coordenadas de -1 a 1 (el círculo que
 * entra en el recuadro del logo).
 */
export function webSegments(): Segment[] {
  const segments: Segment[] = [];
  const point = (index: number, radius: number) => {
    const angle = (index * Math.PI) / 4;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  };
  for (let index = 0; index < 8; index += 1) {
    const tip = point(index, 1);
    segments.push({ x1: 0, y1: 0, x2: tip.x, y2: tip.y });
    for (const radius of [0.34, 0.64, 1]) {
      const from = point(index, radius);
      const to = point(index + 1, radius);
      segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
  }
  return segments;
}

/** La telaraña en módulos del símbolo: centrada en el recuadro, con un margen interior. */
export function webInModules(size: number): { segments: Segment[]; width: number } {
  const box = logoBox(size);
  const radius = (box.side / 2) * 0.82;
  const cx = box.x + box.side / 2;
  const cy = box.y + box.side / 2;
  return {
    segments: webSegments().map((s) => ({
      x1: cx + s.x1 * radius,
      y1: cy + s.y1 * radius,
      x2: cx + s.x2 * radius,
      y2: cy + s.y2 * radius,
    })),
    width: Math.max(0.28, box.side * 0.045),
  };
}

const num = (value: number): string => String(Math.round(value * 1000) / 1000);

/** SVG del código con el logo. `px` es el lado total en píxeles (con la zona de silencio). */
export function renderSvg(text: string, px = 512): string {
  const matrix = qrMatrix(text);
  const total = matrix.size + QUIET_MODULES * 2;
  const box = logoBox(matrix.size);
  const hidden = (x: number, y: number) =>
    x >= box.x && x < box.x + box.side && y >= box.y && y < box.y + box.side;
  let path = "";
  for (let y = 0; y < matrix.size; y += 1) {
    let x = 0;
    while (x < matrix.size) {
      if (matrix.dark(x, y) && !hidden(x, y)) {
        const start = x;
        while (x < matrix.size && matrix.dark(x, y) && !hidden(x, y)) x += 1;
        path += `M${num(start + QUIET_MODULES)} ${num(y + QUIET_MODULES)}h${num(x - start)}v1h-${num(x - start)}z`;
      } else {
        x += 1;
      }
    }
  }
  const web = webInModules(matrix.size);
  const lines = web.segments
    .map(
      (s) =>
        `M${num(s.x1 + QUIET_MODULES)} ${num(s.y1 + QUIET_MODULES)}L${num(s.x2 + QUIET_MODULES)} ${num(s.y2 + QUIET_MODULES)}`,
    )
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(total)} ${num(total)}" width="${num(px)}" height="${num(px)}" role="img" aria-label="${qrTexts.imageLabel}">`,
    `<rect width="${num(total)}" height="${num(total)}" fill="#fff"/>`,
    `<path d="${path}" fill="#000" shape-rendering="crispEdges"/>`,
    `<rect x="${num(box.x + QUIET_MODULES)}" y="${num(box.y + QUIET_MODULES)}" width="${num(box.side)}" height="${num(box.side)}" fill="#fff"/>`,
    `<path d="${lines}" fill="none" stroke="#000" stroke-width="${num(web.width)}" stroke-linecap="round"/>`,
    "</svg>",
  ].join("");
}

// ─── PNG ─────────────────────────────────────────────────────────────────────────────────

/** Distancia de un punto a un segmento. */
function distance(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / lengthSquared));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG en escala de grises de 8 bits. */
function encodeGray(width: number, height: number, pixels: Uint8Array): Buffer {
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(
      rows,
      y * (width + 1) + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits por canal
  header[9] = 0; // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Pixeles en escala de grises del código con el logo, y su lado. */
export function renderPixels(text: string, scale = 12): { width: number; pixels: Uint8Array } {
  const matrix = qrMatrix(text);
  const total = matrix.size + QUIET_MODULES * 2;
  const width = total * scale;
  const pixels = new Uint8Array(width * width).fill(255);
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.dark(x, y)) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        const row = ((y + QUIET_MODULES) * scale + dy) * width + (x + QUIET_MODULES) * scale;
        pixels.fill(0, row, row + scale);
      }
    }
  }
  const box = logoBox(matrix.size);
  const web = webInModules(matrix.size);
  const start = (offset: number) => (offset + QUIET_MODULES) * scale;
  for (let py = start(box.y); py < start(box.y + box.side); py += 1) {
    for (let px = start(box.x); px < start(box.x + box.side); px += 1) {
      // Centro del píxel, en módulos del símbolo (sin zona de silencio).
      const mx = (px + 0.5) / scale - QUIET_MODULES;
      const my = (py + 0.5) / scale - QUIET_MODULES;
      let near = Infinity;
      for (const segment of web.segments) near = Math.min(near, distance(mx, my, segment));
      // Borde suave de medio píxel.
      const coverage = Math.max(0, Math.min(1, (web.width / 2 - near) * scale + 0.5));
      pixels[py * width + px] = Math.round(255 * (1 - coverage));
    }
  }
  return { width, pixels };
}

/** PNG del código con el logo. `scale` son píxeles por módulo. */
export function renderPng(text: string, scale = 12): Buffer {
  const { width, pixels } = renderPixels(text, scale);
  return encodeGray(width, width, pixels);
}
