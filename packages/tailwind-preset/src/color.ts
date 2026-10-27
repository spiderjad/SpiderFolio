// Conversión de color y contraste WCAG 2.x. Sin dependencias: lo usan el preset,
// los tests de contraste y el acento por workspace.
import type { HslToken } from "./tokens.ts";

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

type Rgb = readonly [r: number, g: number, b: number];

const HSL_TOKEN_RE = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/;

export function parseHslToken(token: string): Hsl {
  const match = HSL_TOKEN_RE.exec(token);
  if (!match) throw new Error(`Token HSL inválido: ${token}`);
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

export function formatHslToken({ h, s, l }: Hsl): HslToken {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contraste WCAG entre dos colores en formato de token ("H S% L%"). */
export function contrastRatio(a: string, b: string): number {
  return contrastRgb(hslToRgb(parseHslToken(a)), hslToRgb(parseHslToken(b)));
}
