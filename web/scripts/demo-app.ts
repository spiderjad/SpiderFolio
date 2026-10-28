// Shared by capturas.ts (screenshots) and clips.ts (videos): the demo people and documents, the API
// that serves the built app on its own port and database, signing in and waiting for a screen to load.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import type pg from "pg";

export const root = fileURLToPath(new URL("../..", import.meta.url));

export type Locale = "es" | "en";
export type Who = "owner" | "admin" | "reader";

export interface ServerOptions {
  port: number;
  /** Always a *_capturas database (or a copy of one), never the development one. */
  databaseUrl: string;
  /** Extra environment for this run. */
  env?: Record<string, string>;
}

export const PEOPLE: Record<Locale, Record<Who, string>> = {
  es: { owner: "duena@demo.local", admin: "admin@demo.local", reader: "lector@demo.local" },
  en: {
    owner: "owner@demo-en.local",
    admin: "admin@demo-en.local",
    reader: "reader@demo-en.local",
  },
};

/** Nombres del contenido de demo (backend/prisma/demo-content.ts) para encontrar sus ids. */
export const NAMES: Record<
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

export interface Ids {
  slug: string;
  procedures: string;
  plant: string;
  slicer: string;
  control: string;
}

/** Textos de la app (frontend/src/i18n/<idioma>) para abrir los diálogos. */
export const LABELS: Record<Locale, { more: string; share: string; control: string; qr: string }> = {
  es: {
    more: "Más acciones",
    share: "Compartir",
    control: "Control de documento",
    qr: "Generar QR",
  },
  en: { more: "More actions", share: "Share", control: "Document control", qr: "Generate QR code" },
};

export async function fromMenu(page: Page, locale: Locale, item: string): Promise<void> {
  await page.getByRole("button", { name: LABELS[locale].more }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await page.getByRole("dialog").waitFor();
}

export async function idsOf(db: pg.Client, locale: Locale): Promise<Ids> {
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

export async function startServer(options: ServerOptions): Promise<ChildProcess> {
  const { port, databaseUrl } = options;
  const BASE = `http://localhost:${String(port)}`;
  const storage = mkdtempSync(join(tmpdir(), "spiderfolio-demo-"));
  const server = spawn(process.execPath, ["--env-file-if-exists=.env", "backend/src/server.ts"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      APP_URL: BASE,
      DATABASE_URL: databaseUrl,
      STORAGE_DRIVER: "local",
      STORAGE_DIR: storage,
      APP_STATIC_DIR: join(root, "frontend", "dist"),
      TRUST_PROXY_HOPS: "0",
      BIAN_ENABLED: "false",
      // Example data on screen (Security › Email), never the developer's own SMTP. The API only
      // queues emails and no worker runs here, so nothing is sent.
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      MAIL_FROM: "SpiderFolio <no-reply@example.com>",
      // El Gotenberg de docker compose: sin él, la app muestra el aviso de que no hay PDF.
      GOTENBERG_URL: process.env.GOTENBERG_URL ?? "http://127.0.0.1:3000",
      ...options.env,
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
export async function signIn(
  context: BrowserContext,
  base: string,
  email: string,
  password: string,
): Promise<string> {
  const login = await context.request.post(`${base}/api/v1/auth/login`, {
    data: { email, password },
  });
  if (!login.ok()) throw new Error(`No pude entrar como ${email}: ${String(login.status())}`);
  const { accessToken } = (await login.json()) as { accessToken: string };
  await context.request.post(`${base}/api/v1/auth/accept-terms`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { acceptTerms: true },
  });
  return accessToken;
}

/** Splash (.animate-pulse), skeletons (.skeleton, components/ui/display.tsx) and busy regions. */
const LOADING = '[aria-busy="true"], .animate-pulse, .skeleton';

/**
 * Waits until the app has finished loading: still inside /app (the session opened), the main content
 * visible with text, no splash, skeletons or busy regions, every visible image loaded and the fonts
 * ready. Throws instead of letting a half-loaded screen through.
 */

export async function waitUntilReady(page: Page): Promise<void> {
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
