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
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

const root = fileURLToPath(new URL("../..", import.meta.url));
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

type Locale = "es" | "en";
type Theme = "light" | "dark";
type Who = "owner" | "admin" | "reader";

const PEOPLE: Record<Locale, Record<Who, string>> = {
  es: { owner: "duena@demo.local", admin: "admin@demo.local", reader: "lector@demo.local" },
  en: {
    owner: "owner@demo-en.local",
    admin: "admin@demo-en.local",
    reader: "reader@demo-en.local",
  },
};

/** Nombres del contenido de demo (backend/prisma/demo-content.ts) para encontrar sus ids. */
const NAMES: Record<
  Locale,
  { procedures: string; plant: string; slicer: string; control: string }
> = {
  es: {
    procedures: "Procedimientos",
    plant: "Planta",
    slicer: "Uso de la cortadora de fiambres",
    control: "Control de documentos",
  },
  en: {
    procedures: "Procedures",
    plant: "Plant",
    slicer: "Using the meat slicer",
    control: "Document control",
  },
};

interface Ids {
  slug: string;
  procedures: string;
  plant: string;
  slicer: string;
  control: string;
}

interface Capture {
  name: string;
  who: Who;
  path: (ids: Ids, locale: Locale) => string;
  /** Algo que tiene que verse antes de capturar. */
  ready?: string;
  /** Acción extra antes de capturar (abrir un diálogo…). */
  then?: (page: Page, locale: Locale) => Promise<void>;
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

/** Textos de la app (frontend/src/i18n/<idioma>) para abrir los diálogos. */
const LABELS: Record<Locale, { more: string; share: string; control: string; qr: string }> = {
  es: {
    more: "Más acciones",
    share: "Compartir",
    control: "Control de documento",
    qr: "Generar QR",
  },
  en: { more: "More actions", share: "Share", control: "Document control", qr: "Generate QR code" },
};

async function fromMenu(page: Page, locale: Locale, item: string): Promise<void> {
  await page.getByRole("button", { name: LABELS[locale].more }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await page.getByRole("dialog").waitFor();
}

async function idsOf(db: pg.Client, locale: Locale): Promise<Ids> {
  const ownerEmail = PEOPLE[locale].owner;
  const ws = await db.query<{ id: string; slug: string }>(
    `SELECT w.id, w.slug FROM "Workspace" w JOIN "Membership" m ON m."workspaceId" = w.id
       JOIN "User" u ON u.id = m."userId" WHERE u.email = $1`,
    [ownerEmail],
  );
  const workspace = ws.rows[0];
  if (workspace === undefined)
    throw new Error(`No está la empresa demo de ${locale}: corré el seed`);
  const n = NAMES[locale];
  const one = async (sql: string, values: unknown[]) => {
    const { rows } = await db.query<{ id: string }>(sql, values);
    const id = rows[0]?.id;
    if (id === undefined)
      throw new Error(`No encontré ${String(values[1])} en la demo de ${locale}`);
    return id;
  };
  const procedures = await one(`SELECT id FROM "Space" WHERE "workspaceId" = $1 AND name = $2`, [
    workspace.id,
    n.procedures,
  ]);
  const node = (name: string) =>
    one(`SELECT id FROM "Node" WHERE "workspaceId" = $1 AND name = $2 AND "trashedAt" IS NULL`, [
      workspace.id,
      name,
    ]);
  return {
    slug: workspace.slug,
    procedures,
    plant: await node(n.plant),
    slicer: await node(n.slicer),
    control: await node(n.control),
  };
}

async function startServer(): Promise<ChildProcess> {
  const storage = mkdtempSync(join(tmpdir(), "spiderfolio-capturas-"));
  const server = spawn(process.execPath, ["--env-file-if-exists=.env", "backend/src/server.ts"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      APP_URL: BASE,
      DATABASE_URL: databaseUrl,
      STORAGE_DRIVER: "local",
      STORAGE_DIR: storage,
      APP_STATIC_DIR: join(root, "frontend", "dist"),
      TRUST_PROXY_HOPS: "0",
      BIAN_ENABLED: "false",
      // El Gotenberg de docker compose: sin él, la app muestra el aviso de que no hay PDF.
      GOTENBERG_URL: process.env.GOTENBERG_URL ?? "http://127.0.0.1:3000",
    },
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return server;
    } catch {
      // Todavía arrancando.
    }
    await sleep(500);
  }
  server.kill();
  throw new Error("La API no arrancó");
}

/** Sesión de la persona en el contexto (cookie de refresh) y términos aceptados. */
async function signIn(context: BrowserContext, email: string): Promise<void> {
  const login = await context.request.post(`${BASE}/api/v1/auth/login`, {
    data: { email, password },
  });
  if (!login.ok()) throw new Error(`No pude entrar como ${email}: ${String(login.status())}`);
  const { accessToken } = (await login.json()) as { accessToken: string };
  await context.request.post(`${BASE}/api/v1/auth/accept-terms`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { acceptTerms: true },
  });
}

/** Splash (.animate-pulse), skeletons (.skeleton, components/ui/display.tsx) and busy regions. */
const LOADING = '[aria-busy="true"], .animate-pulse, .skeleton';

/**
 * Waits until the app has finished loading: still inside /app (the session opened), the main content
 * visible with text, no splash, skeletons or busy regions, every visible image loaded and the fonts
 * ready. Throws instead of letting a half-loaded screen through.
 */

async function waitUntilReady(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      (loading) => {
        if (!window.location.pathname.startsWith("/app/")) return false;
        const main = document.querySelector("main");
        if (main === null || main.innerText.trim() === "") return false;
        if (document.querySelector(loading) !== null) return false;
        // Every visible image finished loading and is not broken.
        for (const img of Array.from(document.images)) {
          if (img.getClientRects().length === 0) continue;
          if (!img.complete || img.naturalWidth === 0) return false;
        }
        return document.fonts.status === "loaded";
      },
      LOADING,
      { timeout: 30_000 },
    );
  } catch {
    const path = new URL(page.url()).pathname;
    if (!path.startsWith("/app/")) throw new Error(`la sesión no se abrió: quedó en ${path}`);
    const state = await page.evaluate(
      (loading) => ({
        main: document.querySelector("main") !== null,
        busy: document.querySelectorAll(loading).length,
        broken: Array.from(document.images).filter(
          (img) => img.getClientRects().length > 0 && img.complete && img.naturalWidth === 0,
        ).length,
      }),
      LOADING,
    );
    if (!state.main) throw new Error("sigue la pantalla de carga (sin contenido principal)");
    if (state.broken > 0) throw new Error(`${String(state.broken)} imagen(es) rota(s) en pantalla`);
    throw new Error(
      `la pantalla no terminó de cargar (${String(state.busy)} splash, skeletons o elementos ocupados)`,
    );
  }
}

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
const server = await startServer();
const failed: string[] = [];
// CAPTURAS_SOLO=compartir,qr: rehace solo esas (y CAPTURAS_IDIOMA=es, solo un idioma).
const only = process.env.CAPTURAS_SOLO ? new Set(process.env.CAPTURAS_SOLO.split(",")) : null;
const onlyLocale = process.env.CAPTURAS_IDIOMA;
const browser = await chromium.launch();
try {
  for (const locale of ["es", "en"] as const) {
    if (onlyLocale !== undefined && onlyLocale !== locale) continue;
    const ids = await idsOf(db, locale);
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
      await signIn(context, PEOPLE[locale][who]);
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
