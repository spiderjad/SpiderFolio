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
//
// Plugin screens (plugin-*, and licencia with its plugins): the plugins built in the plugins
// repository (node tools/build-plugin.ts <id>) and, for the paid ones, a license per demo company
// signed with the production key (the core accepts no other):
//   CAPTURAS_PLUGINS_DIR=<plugins repo>/dist  CAPTURAS_LICENCIAS=<file, one SFL1 token per line>
// The assistant's capture reads a real certificate: the plugins repo's Samba AD test image listening
// on 127.0.0.1:636 (docker run -d -p 127.0.0.1:636:636 spiderfolio-plugins-samba-ad).
import { mkdirSync, readFileSync } from "node:fs";
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
const pluginsDir = process.env.CAPTURAS_PLUGINS_DIR;
const licenses = (
  process.env.CAPTURAS_LICENCIAS === undefined
    ? ""
    : readFileSync(process.env.CAPTURAS_LICENCIAS, "utf8")
)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("SFL1."));

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
  /** With the paid plugins' license loaded (true) or without it (false); undefined: either. */
  license?: boolean;
  /** Where the screen lives, if it's outside the app (the consent screen). */
  prefix?: string;
  /** Data the screen needs, set right before it (only in this database). */
  before?: (input: { workspaceId: string; slug: string; locale: Locale }) => Promise<void>;
}

/** The license read is remembered 30 s by the API (LICENSE_CACHE_MS): wait it out after a change. */
const LICENSE_CACHE_WAIT_MS = 31_000;

/** The demo company's license from CAPTURAS_LICENCIAS (the token naming its id), or none. */
function licenseFor(workspaceId: string): string | null {
  return (
    licenses.find((token) => {
      const payload = token.split(".")[1] ?? "";
      const json = Buffer.from(payload, "base64url").toString("utf8");
      return (JSON.parse(json) as { workspaceId?: string }).workspaceId === workspaceId;
    }) ?? null
  );
}

/** An owner's API session (the demo owners have no 2FA), to set a plugin up like the screen does. */
async function ownerToken(locale: Locale): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "spiderfolio" },
    body: JSON.stringify({ email: PEOPLE[locale].owner, password }),
  });
  if (!res.ok) throw new Error(`Login de la dueña de la demo: ${String(res.status)}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function pluginCall(locale: Locale, slug: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}/api/v1/w/${slug}/plugins/corporate-directory${path}`, {
    method: path.startsWith("/ad/wizard") || path === "/ad/test" ? "POST" : "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await ownerToken(locale)}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${String(res.status)} ${await res.text()}`);
  return (await res.json()) as unknown;
}

/** The consent screen's address for a real request (an app registered for the capture). */
let consentUrl = "";

/** The labels of the assistant's first step (corporate-directory's frontend/texts.ts). */
const WIZARD: Record<Locale, { domain: string; find: string; server: string; next: string }> = {
  es: {
    domain: "Dominio de tu red",
    find: "Buscar el servidor",
    server: "Nombre del servidor (controlador de dominio)",
    next: "Siguiente",
  },
  en: {
    domain: "Your network's domain",
    find: "Find the server",
    server: "Server name (domain controller)",
    next: "Next",
  },
};

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
  // Plugins: the free one alone first (the paid one replaces it), then with the paid license.
  {
    name: "plugin-microsoft",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/admin/p/microsoft-sign-in/microsoft`,
    // An example connection (invented ids), saved like the screen does.
    before: async ({ workspaceId }) => {
      await db.query(
        `INSERT INTO "PluginSetting" ("id", "workspaceId", "pluginId", "key", "value", "updatedAt")
         VALUES ($1, $2, 'microsoft-sign-in', 'entra', $3, now())
         ON CONFLICT ("workspaceId", "pluginId", "key") DO UPDATE SET "value" = $3, "updatedAt" = now()`,
        [
          `capturas-ms-${workspaceId}`,
          workspaceId,
          JSON.stringify({
            enabled: true,
            label: "",
            tenantId: "3f2a8c51-7d4e-4b9a-9c1e-2b6f0d8e4a17",
            clientId: "9b1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
          }),
        ],
      );
    },
  },
  { name: "licencia", who: "owner", license: true, path: (i) => `/app/${i.slug}/admin/license` },
  // The connector for Claude (free plugin, on in both demo companies).
  {
    name: "plugin-claude",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/admin/p/claude-connector/claude`,
  },
  {
    name: "aplicaciones-conectadas",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/profile`,
    then: async (page, locale) => {
      // The profile column stays fixed while scrolling: in the shot it would cover the section.
      await page.addStyleTag({ content: String.raw`.lg\:sticky { position: static !important; }` });
      await page
        .getByRole("heading", {
          name: locale === "es" ? "Aplicaciones conectadas" : "Connected apps",
        })
        .scrollIntoViewIfNeeded();
    },
  },
  {
    name: "conector-seguridad",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/admin/security`,
    then: async (page, locale) => {
      // In the page, not the menu (the plugin's section has the same name).
      await page
        .locator("main")
        .getByText(locale === "es" ? "Conector para Claude" : "Connector for Claude", {
          exact: true,
        })
        .scrollIntoViewIfNeeded();
    },
  },
  {
    name: "autorizar-app",
    who: "owner",
    license: false,
    path: () => consentUrl,
    prefix: "/authorize-app",
    // A real request, as Claude starts it: the app registers and asks to authorize.
    before: async () => {
      const registered = await fetch(`${BASE}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      });
      const { client_id: clientId } = (await registered.json()) as { client_id: string };
      const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        scope: "docs:read docs:write",
        state: "capturas",
        resource: `${BASE}/mcp`,
      });
      const answer = await fetch(`${BASE}/oauth/authorize?${query.toString()}`, {
        redirect: "manual",
      });
      const location = new URL(answer.headers.get("location") ?? "");
      consentUrl = `${location.pathname}${location.hash}`;
    },
  },
  {
    name: "plugin-asistente",
    who: "owner",
    license: true,
    path: (i) => `/app/${i.slug}/admin/p/corporate-directory/directory`,
    // The assistant shows until Active Directory is set up.
    before: async ({ workspaceId }) => {
      await db.query(
        `DELETE FROM "PluginSetting" WHERE "workspaceId" = $1 AND "pluginId" = 'corporate-directory'`,
        [workspaceId],
      );
    },
    then: async (page, locale) => {
      const w = WIZARD[locale];
      await page.getByLabel(w.domain).fill("empresa.test");
      await page.getByRole("button", { name: w.find }).click();
      await page.getByLabel(w.server).fill("localhost");
      await page.getByRole("button", { name: w.next }).click();
      await page.getByText("SpiderFolio Test CA").first().waitFor();
    },
  },
  {
    name: "plugin-directorio",
    who: "owner",
    license: true,
    path: (i) => `/app/${i.slug}/admin/p/corporate-directory/directory`,
    // Active Directory set up as the assistant leaves it (the Samba AD test image on 127.0.0.1:636).
    before: async ({ slug, locale }) => {
      const answer = (await pluginCall(locale, slug, "/ad/wizard/certificate", {
        server: "localhost",
      })) as { ok: boolean; certificate?: { pem: string } };
      if (answer.certificate === undefined) throw new Error("Sin Samba AD en 127.0.0.1:636");
      await pluginCall(locale, slug, "/ad", {
        config: {
          enabled: true,
          label: "",
          url: "ldaps://localhost:636",
          startTls: false,
          caCertificate: answer.certificate.pem,
          baseDn: "DC=empresa,DC=test",
          bindDn: "svc-spiderfolio@empresa.test",
          loginAttribute: "sAMAccountName",
          allowedGroups: ["CN=SpiderFolio,OU=Grupos,DC=empresa,DC=test"],
          mappings: [],
          sync: { enabled: true, maxSuspendPercent: 10 },
        },
        // The Samba AD test image's fixed password (plugins repository, test/samba-ad).
        bindPassword: "Clave-Prueba-2026!",
      });
    },
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
// Free plugins are turned on by the owner: on in both demo companies (only in this database).
await db.query(
  `UPDATE "Workspace" SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{communityPlugins}',
     COALESCE("settings"->'communityPlugins', '{}'::jsonb) ||
     jsonb_build_object(
       'microsoft-sign-in', jsonb_build_object('enabledAt', now()::text, 'enabledBy', 'capturas'),
       'claude-connector', jsonb_build_object('enabledAt', now()::text, 'enabledBy', 'capturas')))`,
);
let licensed: boolean | null = null;
/** Loads or takes away the paid plugins' license in both demo companies, then waits for the cache. */
async function setLicense(on: boolean): Promise<void> {
  if (licensed === on) return;
  const companies = await db.query<{ id: string }>(`SELECT id FROM "Workspace"`);
  for (const { id } of companies.rows) {
    const token = on ? licenseFor(id) : null;
    if (token === null) {
      await db.query(`DELETE FROM "WorkspaceLicense" WHERE "workspaceId" = $1`, [id]);
    } else {
      await db.query(
        `INSERT INTO "WorkspaceLicense" ("id", "workspaceId", "token", "updatedAt")
         VALUES ($1, $2, $3, now())
         ON CONFLICT ("workspaceId") DO UPDATE SET "token" = $3, "updatedAt" = now()`,
        [`capturas-${id}`, id, token],
      );
    }
  }
  if (licensed !== null) await sleep(LICENSE_CACHE_WAIT_MS);
  licensed = on;
}
const server = await startServer({
  port: PORT,
  databaseUrl,
  ...(pluginsDir === undefined ? {} : { env: { PLUGINS_DIR: pluginsDir } }),
});
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
            if (capture.license !== undefined) await setLicense(capture.license);
            if (capture.before !== undefined) {
              const { rows } = await db.query<{ id: string }>(
                `SELECT id FROM "Workspace" WHERE slug = $1`,
                [ids.slug],
              );
              await capture.before({ workspaceId: rows[0]?.id ?? "", slug: ids.slug, locale });
            }
            // Only for this capture: the usage shown elsewhere (home, admin) stays the real one.
            if (capture.bian) await page.route(BIAN_USAGE, fakeBianUsage(bian));
            await page.goto(`${BASE}${capture.path(ids, locale)}`);
            // Some screens poll (notifications): instead of "network idle", wait for the content.
            await waitUntilReady(page, capture.prefix);
            if (capture.ready !== undefined) await page.getByText(capture.ready).first().waitFor();
            await capture.then?.(page, locale);
            // A dialog can load its own skeletons: check again right before the shot.
            await waitUntilReady(page, capture.prefix);
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
