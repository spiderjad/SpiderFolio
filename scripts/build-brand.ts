// Genera el logo, el favicon y los íconos de la PWA de SpiderFolio.
// Uso: npm run build:brand (después de cambiar colores o geometría aquí).
// El texto "SpiderFolio" es la fuente Inter 700 convertida a trazados
// (brand/wordmark-path.txt), así los SVG no dependen de ninguna tipografía.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIOLET = "#7c3aed";
const YELLOW = "#fbbf24";
const ORANGE = "#f97316";
const WORD_WIDTH = 237.38;
const wordPath = readFileSync(join(root, "brand", "wordmark-path.txt"), "utf8").trim();

/** Telaraña: 8 radios y 3 anillos de lados curvados hacia el centro, en un cuadrado de 56. */
function webMarkup(color: string, strokeWidth = 2): string {
  const c = 28;
  const point = (r: number, i: number) => {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const [x, y] = point(27, i);
    return `M${c} ${c}L${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join("");
  const rings = [8, 16.5, 25]
    .map((r) => {
      let d = "";
      for (let i = 0; i < 8; i++) {
        const [x0, y0] = point(r, i);
        const [x1, y1] = point(r, i + 1);
        const [qx, qy] = point(r * 0.8, i + 0.5);
        d += `${i === 0 ? "M" : ""}${i === 0 ? `${x0.toFixed(2)} ${y0.toFixed(2)}` : ""}Q${qx.toFixed(2)} ${qy.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
      }
      return `${d}Z`;
    })
    .join("");
  return `<path d="${spokes}${rings}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Tres franjas diagonales: amarillo, naranja y violeta. */
function stripesMarkup(): string {
  const bar = (color: string, dx: number, dy: number) =>
    `<rect x="-20" y="-6" width="40" height="12" rx="6" transform="translate(${dx} ${dy}) rotate(-38)" fill="${color}"/>`;
  return bar(VIOLET, 0, 16) + bar(ORANGE, 4, 1) + bar(YELLOW, 8, -14);
}

function logo(textColor: string, webColor: string): string {
  const textX = 66;
  const stripesX = textX + WORD_WIDTH + 24;
  const width = Math.round(stripesX + 34);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" width="${width}" height="64" role="img" aria-label="SpiderFolio">
<title>SpiderFolio</title>
<g transform="translate(0 4)">${webMarkup(webColor)}</g>
<path transform="translate(${textX} 44)" d="${wordPath}" fill="${textColor}"/>
<g transform="translate(${stripesX.toFixed(2)} 32)">${stripesMarkup()}</g>
</svg>
`;
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56">${webMarkup(VIOLET, 2.4)}</svg>
`;

/** Ícono con fondo blanco (iOS no admite transparencia; la PWA necesita zona segura). */
function paddedIcon(size: number, scale: number): string {
  const inner = size * scale;
  const offset = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#ffffff"/><g transform="translate(${offset} ${offset}) scale(${inner / 56})">${webMarkup(VIOLET, 2.6)}</g></svg>`;
}

const files: Record<string, string> = {
  "logo-light.svg": logo("#0f172a", "#0f172a"),
  "logo-dark.svg": logo("#f8fafc", "#f8fafc"),
  "logo-icon.svg": iconSvg,
};

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg: string, size: number, transparent: boolean): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({
    omitBackground: transparent,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}

/** ICO con PNG incrustados (Vista+ y todos los navegadores). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size, e);
    head.writeUInt8(size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

const binaries: Record<string, Buffer> = {
  "apple-touch-icon.png": await png(paddedIcon(180, 0.78), 180, false),
  "icon-192.png": await png(paddedIcon(192, 0.7), 192, false),
  "icon-512.png": await png(paddedIcon(512, 0.7), 512, false),
  "favicon.ico": ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(iconSvg, size, true) })),
    ),
  ),
};
await browser.close();

for (const dir of ["brand", "web/public", "frontend/public"]) {
  const out = join(root, dir);
  mkdirSync(out, { recursive: true });
  for (const [name, svg] of Object.entries(files)) writeFileSync(join(out, name), svg);
  if (dir === "brand") continue;
  writeFileSync(join(out, "favicon.svg"), iconSvg);
  for (const [name, data] of Object.entries(binaries)) writeFileSync(join(out, name), data);
}
