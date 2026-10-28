// Capturas reales de la app para la web y la documentación, con las empresas demo del seed (datos
// inventados), en español e inglés y en tema claro y oscuro. Guarda WebP en
// web/public/capturas/<idioma>/<nombre>-<tema>.webp (la lista: CAPTURES, abajo).
//
//   1. Una base aparte con el seed:  createdb spiderfolio_capturas
//      DATABASE_URL=…/spiderfolio_capturas npx prisma migrate deploy   (en backend/)
//      DATABASE_URL=…/spiderfolio_capturas SEED_DEMO_PASSWORD=… node prisma/seed.ts
//   2. La app compilada:  npm run build -w @spiderfolio/frontend
//   3. node web/scripts/capturas.ts   (CAPTURAS_DATABASE_URL y SEED_DEMO_PASSWORD en el entorno)
//
// Levanta la API (que sirve la app) en un puerto propio con esa base y la apaga al terminar. Nunca
// apunta a la base de desarrollo: se niega si CAPTURAS_DATABASE_URL no termina en _capturas.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import {
  fromMenu,
  idsOf,
  LABELS,
  PEOPLE,
  root,
  signIn,
  startServer,
  waitUntilReady,
  type Ids,
  type Locale,
  type Who,
} from "./demo-app.ts";
import { BIAN_TEXT, BIAN_USAGE, bianRecording, fakeBian, fakeBianUsage } from "./bian-recording.ts";
const out = join(root, "web", "public", "capturas");
const PORT = 4100;
const BASE = `http://localhost:${String(PORT)}`;
const databaseUrl = process.env.CAPTURAS_DATABASE_URL ?? "";
const password = process.env.SEED_DEMO_PASSWORD ?? "";
if (!/_capturas(\?|$)/u.test(databaseUrl)) {
  throw new Error(
    "CAPTURAS_DATABASE_URL tiene que apuntar a una base *_capturas (nunca a la de desarrollo)",
  );
}
if (password === "") throw new Error("Falta SEED_DEMO_PASSWORD (la misma del seed)");

type Theme = "light" | "dark";

interface Capture {
  name: string;
  who: Who;
  path: (ids: Ids, locale: Locale) => string;
  /** Algo que tiene que verse antes de capturar. */
  ready?: string;
  /** Acción extra antes de capturar (abrir un diálogo…). */
  then?: (page: Page, locale: Locale) => Promise<void>;
  /** Bian available, answering with the recording shared with the clip (bian-recording.ts). */
  bian?: true;
}

/** A word that matches several demo documents in each language. */
const SEARCH: Record<Locale, string> = { es: "limpieza", en: "cleaning" };

const CAPTURES: Capture[] = [
  { name: "inicio", who: "owner", path: (i) => `/app/${i.slug}` },
  { name: "espacios", who: "owner", path: (i) => `/app/${i.slug}/files` },
  {
    name: "explorador",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/f/${i.plant}`,
  },
  {
    name: "pagina",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
  },
  {
    name: "documento-controlado",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.control}`,
  },
  { name: "documentos", who: "owner", path: (i) => `/app/${i.slug}/admin/documents` },
  { name: "aprobaciones", who: "admin", path: (i) => `/app/${i.slug}/aprobaciones` },
  { name: "mis-documentos", who: "reader", path: (i) => `/app/${i.slug}/mis-documentos` },
  {
    name: "busqueda",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/search?q=${encodeURIComponent(SEARCH[locale])}`,
  },
  { name: "accesos", who: "owner", path: (i) => `/app/${i.slug}/admin/access` },
  { name: "miembros", who: "owner", path: (i) => `/app/${i.slug}/admin/members` },
  { name: "departamentos", who: "owner", path: (i) => `/app/${i.slug}/admin/departments` },
  { name: "roles", who: "owner", path: (i) => `/app/${i.slug}/admin/roles` },
  { name: "seguridad", who: "owner", path: (i) => `/app/${i.slug}/admin/security` },
  {
    name: "seguridad-email",
    who: "owner",
    path: (i) => `/app/${i.slug}/admin/security?tab=email`,
    then: (page, locale) =>
      page
        .getByText(locale === "es" ? "Email del servidor" : "Server email", { exact: true })
        .first()
        .waitFor(),
  },
  {
    name: "bian",
    who: "owner",
    path: (i) => `/app/${i.slug}`,
    bian: true,
    then: async (page, locale) => {
      const t = BIAN_TEXT[locale];
      await page.getByRole("button", { name: t.ask }).first().click();
      const input = page.getByRole("textbox", { name: t.placeholder });
      await input.fill(t.question);
      await input.press("Enter");
      // The recorded answer is written in about 3 s; the citations come with the last event.
      await page.getByRole("link", { name: t.source }).first().waitFor({ timeout: 15_000 });
    },
  },
  { name: "bian-admin", who: "owner", path: (i) => `/app/${i.slug}/admin/bian` },
  { name: "limites", who: "owner", path: (i) => `/app/${i.slug}/admin/limits` },
  { name: "licencia", who: "owner", path: (i) => `/app/${i.slug}/admin/license` },
  { name: "auditoria", who: "owner", path: (i) => `/app/${i.slug}/admin/audit` },
  { name: "perfil", who: "owner", path: (i) => `/app/${i.slug}/profile` },
  {
    name: "compartir",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    then: (page, locale) =>
      page.getByRole("button", { name: LABELS[locale].share, exact: true }).click(),
  },
  {
    name: "control",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.control}`,
    then: (page, locale) => fromMenu(page, locale, LABELS[locale].control),
  },
  {
    name: "qr",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    then: (page, locale) => fromMenu(page, locale, LABELS[locale].qr),
  },
];

/**
 * Fails a blank capture or one with only the splash: almost every pixel is the background color. A
 * real screen (sidebar, text, cards) has well over 1.5% of pixels away from the background; the splash
 * logo alone is about 0.2%.
 */
async function assertNotBlank(png: Buffer): Promise<void> {
  const { data, info } = await sharp(png)
    .resize({ width: 240 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const at = (index: number): number => data[index] ?? 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 3) {
    const key = ((at(i) >> 3) << 10) | ((at(i + 1) >> 3) << 5) | (at(i + 2) >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const [r, g, b] = [
    (background >> 10) << 3,
    ((background >> 5) & 31) << 3,
    (background & 31) << 3,
  ];
  let content = 0;
  for (let i = 0; i < data.length; i += 3) {
    const distance = Math.abs(at(i) - r) + Math.abs(at(i + 1) - g) + Math.abs(at(i + 2) - b);
    if (distance > 40) content++;
  }
  const ratio = content / pixels;
  if (ratio < 0.015) {
    throw new Error(
      `la captura está casi vacía (${(ratio * 100).toFixed(1)} % de contenido): en blanco o con el splash`,
    );
  }
}

async function shoot(page: Page, file: string): Promise<void> {
  const png = await page.screenshot({ type: "png" });
  await assertNotBlank(png);
  // 1600 px de ancho alcanzan para la web; WebP pesa ~5 veces menos que PNG.
  await sharp(png).resize({ width: 1600 }).webp({ quality: 82 }).toFile(file);
}

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
// Los límites de intentos de login viven en la base: entre corridas, se limpian (solo en esta base).
await db.query(`DELETE FROM "RateLimitBucket"`);
// The server email card shows "Working": a recent successful send (only in this database).
await db.query(
  `INSERT INTO "SystemEmailHealth" ("id", "lastSuccessAt", "updatedAt") VALUES ('system', now(), now())
   ON CONFLICT ("id") DO UPDATE
   SET "lastSuccessAt" = now(), "lastErrorAt" = NULL, "lastErrorCode" = NULL, "updatedAt" = now()`,
);
const server = await startServer({ port: PORT, databaseUrl });
const failed: string[] = [];
// CAPTURAS_SOLO=compartir,qr: rehace solo esas (y CAPTURAS_IDIOMA=es, solo un idioma).
const only = process.env.CAPTURAS_SOLO ? new Set(process.env.CAPTURAS_SOLO.split(",")) : null;
const onlyLocale = process.env.CAPTURAS_IDIOMA;
const browser = await chromium.launch();
try {
  for (const locale of ["es", "en"] as const) {
    if (onlyLocale !== undefined && onlyLocale !== locale) continue;
    const ids = await idsOf(db, locale);
    const bian = await bianRecording(db, locale, ids);
    mkdirSync(join(out, locale), { recursive: true });
    for (const who of ["owner", "admin", "reader"] as const) {
      const captures = CAPTURES.filter(
        (capture) => capture.who === who && (only === null || only.has(capture.name)),
      );
      if (captures.length === 0) continue;
      // Una sesión por persona: los dos temas se recorren en la misma (un solo login).
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        locale: locale === "es" ? "es-ES" : "en-GB",
        reducedMotion: "reduce",
      });
      // Only /bian/ask is answered in the page; the rest goes to the server.
      await context.addInitScript(fakeBian, bian);
      await signIn(context, BASE, PEOPLE[locale][who], password);
      const page = await context.newPage();
      for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`${BASE}/app`);
        // Let the session refresh finish first: navigating away mid-refresh loses the rotated cookie.
        await waitUntilReady(page);
        await page.evaluate(
          ([key, value]) => {
            window.localStorage.setItem(key, value);
          },
          ["spiderfolio-theme", theme] as const,
        );
        for (const capture of captures) {
          try {
            await page.keyboard.press("Escape");
            // Only for this capture: the usage shown elsewhere (home, admin) stays the real one.
            if (capture.bian) await page.route(BIAN_USAGE, fakeBianUsage(bian));
            await page.goto(`${BASE}${capture.path(ids, locale)}`);
            // Some screens poll (notifications): instead of "network idle", wait for the content.
            await waitUntilReady(page);
            if (capture.ready !== undefined) await page.getByText(capture.ready).first().waitFor();
            await capture.then?.(page, locale);
            // A dialog can load its own skeletons: check again right before the shot.
            await waitUntilReady(page);
            // Que terminen de pintarse gráficos y avatares.
            await sleep(400);
            await shoot(page, join(out, locale, `${capture.name}-${theme}.webp`));
            console.log(`${locale}/${capture.name}-${theme}`);
          } catch (error) {
            // Una captura que falla no corta las demás: se informa y se sigue.
            failed.push(`${locale}/${capture.name}-${theme}`);
            const reason = String(error).split(/\r?\n/u)[0] ?? "";
            console.error(`FALLÓ ${locale}/${capture.name}-${theme}: ${reason}`);
          }
          if (capture.bian) await page.unroute(BIAN_USAGE);
          // Sin pasar el límite global de pedidos por minuto de la API.
          await sleep(1500);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
  await db.end();
}
if (failed.length > 0) {
  console.error(`Capturas que fallaron: ${failed.join(", ")}`);
  process.exitCode = 1;
}
