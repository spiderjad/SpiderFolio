// Demo clips for the README and the website, recorded with Playwright on the demo companies (made-up
// data), in Spanish and English, light theme, 1280×800:
//   control    controlled document: version history, what changed between two versions (in the
//              approval), approve, and the controlled PDF with its watermark
//   qr         generate a document's QR code and open its short URL (the current version)
//   bian       ask Bian and watch the answer being written, with its citations
//   compartir  Share › "Who can get in and why"
//   conector   the connector for Claude: a question in a chat, the SpiderFolio tools it calls, the
//              answer with the current document, and that document opened in SpiderFolio
// Each one is exported as MP4 (web/public/clips/<lang>/<name>.mp4, with a .webp poster) and as a light
// GIF (<name>-<lang>.gif, under 5 MB, plus demo-<lang>.gif joining the four) in clips-gif/, which is
// not versioned: the README links the GIFs attached to a Release.
//
//   1. The capture database with the seed, migrated (see capturas.ts) and the app built.
//   2. ffmpeg on the PATH (not an npm dependency).
//   3. node web/scripts/clips.ts   (CAPTURAS_DATABASE_URL and SEED_DEMO_PASSWORD in the environment)
//      CLIPS_SOLO=qr,bian and CLIPS_IDIOMA=es record only those.
//      CLIPS_RELEASE=v0.1.3 also uploads the GIFs to that Release (gh, replacing the old ones).
//
// The browser opens an example address (APP_URL below), mapped to the local API with
// --host-resolver-rules, so the screens (the QR's short URL) never show localhost. The API runs with
// that APP_URL, so its origin checks pass as they are.
//
// Every run works on a fresh copy of the capture database (<name>_clips_capturas, dropped at the end):
// approving a document changes data, and the clips have to come out the same every time. Bian never
// calls the Anthropic API: the page gets a recorded answer, streamed at a fixed pace. Neither does the
// connector's clip: its chat is a local page (served by Playwright, never on the network) with a
// recorded answer written from the demo document's real content. The chat is laid over the document,
// already loaded, and opening the link takes it away: no reload in the clip.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import {
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
import {
  BIAN_TEXT,
  BIAN_USAGE,
  bianRecording,
  fakeBian,
  fakeBianUsage,
  type BianRecording,
} from "./bian-recording.ts";

const PORT = 4110;
const BASE = `http://localhost:${String(PORT)}`;
/** What the browser shows; Chromium resolves it to the local API (see the launch below). */
const APP_HOST = "docs.empresa-demo.test";
const APP_URL = `http://${APP_HOST}`;
const WIDTH = 1280;
const HEIGHT = 800;
/** GIFs over this size get smaller (width, frame rate, colors) until they fit. */
const MAX_GIF_BYTES = 5_000_000;
const sourceUrl = process.env.CAPTURAS_DATABASE_URL ?? "";
const password = process.env.SEED_DEMO_PASSWORD ?? "";
if (!/_capturas(\?|$)/u.test(sourceUrl)) {
  throw new Error(
    "CAPTURAS_DATABASE_URL tiene que apuntar a una base *_capturas (nunca a la de desarrollo)",
  );
}
if (password === "") throw new Error("Falta SEED_DEMO_PASSWORD (la misma del seed)");
if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("Falta ffmpeg en el PATH");

const webOut = join(root, "web", "public", "clips");
const gifOut = join(root, "clips-gif");
const release = process.env.CLIPS_RELEASE;

/** Texts of the app (frontend/src/i18n/<lang>). */
const TEXT: Record<
  Locale,
  {
    /** The comparison's summary ("2 added"), to know it has loaded. */
    added: RegExp;
    approve: string;
    approveTitle: string;
    pdf: (version: number) => string;
    generateQr: string;
    whoTitle: string;
    review: [string, string];
    newRule: string;
    changeNote: string;
  }
> = {
  es: {
    added: /\d+ agregados/u,
    approve: "Aprobar",
    approveTitle: "Aprobar el documento",
    pdf: (version) => `Descargar el PDF controlado de la versión ${String(version)}`,
    generateQr: "Generar QR",
    whoTitle: "Quién puede entrar y por qué",
    review: ["cada 12 meses", "cada 6 meses"],
    newRule: "Producción revisa cada trimestre las instrucciones de planta.",
    changeNote: "Revisión cada 6 meses y control trimestral de Producción.",
  },
  en: {
    added: /\d+ added/u,
    approve: "Approve",
    approveTitle: "Approve the document",
    pdf: (version) => `Download the controlled PDF of version ${String(version)}`,
    generateQr: "Generate QR code",
    whoTitle: "Who can get in and why",
    review: ["every 12 months", "every 6 months"],
    newRule: "Production reviews the plant instructions every quarter.",
    changeNote: "Review every 6 months and a quarterly check by Production.",
  },
};

interface Clip {
  name: string;
  who: Who;
  /** Where the recording starts (already loaded; the loading is cut out). */
  path: (ids: Ids) => string;
  /** A local page laid over the loaded screen (the connector's chat), closed by its own link. */
  chat?: (ctx: ClipContext) => string;
  run: (page: Page, ctx: ClipContext) => Promise<void>;
}

interface ClipContext {
  locale: Locale;
  ids: Ids;
  /** Temporary folder of this run (downloads). */
  work: string;
}

// ─── Moving like a person ─────────────────────────────────────────────────────

/**
 * A visible cursor: headless Chromium doesn't draw the mouse in videos. It follows mousemove and
 * shrinks a little on click. The clips context bypasses the CSP (only here) so it can use styles.
 */
const CURSOR_SCRIPT = `
  window.addEventListener("DOMContentLoaded", () => {
    const cursor = document.createElement("div");
    cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 11.5-7 1.2 4.3 7.3-3 1.7-4.3-7.4L4 21z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(-100px, -100px)", transition: "scale 120ms ease", transformOrigin: "4px 2px",
    });
    document.body.appendChild(cursor);
    window.addEventListener("mousemove", (event) => {
      cursor.style.transform = "translate(" + (event.clientX - 4) + "px, " + (event.clientY - 2) + "px)";
    }, true);
    window.addEventListener("mousedown", () => { cursor.style.scale = "0.85"; }, true);
    window.addEventListener("mouseup", () => { cursor.style.scale = "1"; }, true);
  });
`;

const position = new WeakMap<Page, { x: number; y: number }>();

/** Moves the mouse to the element with an eased curve (about 320 ms), like a hand would. */
async function glide(page: Page, target: Locator, duration = 320): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("El elemento no está en pantalla");
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = position.get(page) ?? { x: WIDTH * 0.62, y: HEIGHT * 0.55 };
  // Paced by the clock, not by a number of steps: each mouse.move takes its own time.
  const started = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - started) / duration);
    const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease);
    if (t === 1) break;
    await sleep(10);
  }
  position.set(page, to);
}

async function clickOn(page: Page, target: Locator): Promise<void> {
  await glide(page, target);
  await sleep(120);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

// ─── The clips ────────────────────────────────────────────────────────────────

const CLIPS: Clip[] = [
  {
    name: "control",
    who: "admin",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.control}`,
    run: async (page, { locale, work }) => {
      const t = TEXT[locale];
      await clickOn(page, page.getByRole("button", { name: LABELS[locale].more }));
      await sleep(60);
      await clickOn(page, page.getByRole("menuitem", { name: LABELS[locale].control }));
      const dialog = page.getByRole("dialog").first();
      await dialog.waitFor();
      // The history: v1 obsolete, v2 current, v3 in review.
      await sleep(500);
      await clickOn(page, dialog.getByRole("button", { name: t.approve, exact: true }));
      const confirm = page.getByRole("dialog", { name: t.approveTitle });
      // "What changed": version 3 against the current one, added in green and changes highlighted.
      await confirm.getByText(t.added).first().waitFor();
      await sleep(1400);
      await clickOn(page, confirm.getByRole("button", { name: t.approve, exact: true }));
      await confirm.waitFor({ state: "hidden" });
      await sleep(150);
      const download = page.waitForEvent("download");
      await clickOn(page, dialog.getByRole("button", { name: t.pdf(2) }));
      // The controlled PDF, as downloaded: its "uncontrolled copy" watermark is on every page.
      const file = join(work, `control-${locale}.pdf`);
      await (await download).saveAs(file);
      await page.goto(`${pathToFileURL(file).href}#toolbar=0&view=FitH`);
      await sleep(400);
      // Down to the foot of the page, where the watermark is.
      position.set(page, { x: WIDTH / 2, y: HEIGHT / 2 });
      await page.mouse.move(WIDTH / 2, HEIGHT / 2);
      for (let i = 0; i < 9; i++) {
        await page.mouse.wheel(0, 160);
        await sleep(45);
      }
      await sleep(850);
    },
  },
  {
    name: "qr",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    run: async (page, { locale }) => {
      const t = TEXT[locale];
      await clickOn(page, page.getByRole("button", { name: LABELS[locale].more }));
      await sleep(250);
      await clickOn(page, page.getByRole("menuitem", { name: LABELS[locale].qr }));
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await sleep(700);
      const created = page.waitForResponse(
        (res) => res.request().method() === "POST" && /\/nodes\/[^/]+\/qr$/u.test(res.url()),
      );
      await clickOn(page, dialog.getByRole("button", { name: t.generateQr, exact: true }));
      const { url } = (await (await created).json()) as { url: string };
      await sleep(1500);
      // What a phone does after scanning it: open the short URL.
      await page.goto(url);
      await waitUntilReady(page);
      await sleep(2000);
    },
  },
  {
    name: "bian",
    who: "owner",
    path: (i) => `/app/${i.slug}`,
    run: async (page, { locale }) => {
      const t = BIAN_TEXT[locale];
      await clickOn(page, page.getByRole("button", { name: t.ask }).first());
      const input = page.getByRole("textbox", { name: t.placeholder });
      await input.waitFor();
      await sleep(300);
      await glide(page, input);
      await input.pressSequentially(t.question, { delay: 18 });
      await sleep(250);
      await page.keyboard.press("Enter");
      // The recorded answer takes about 3 s to be written.
      await page.getByRole("link", { name: t.source }).first().waitFor({ timeout: 15_000 });
      await sleep(700);
      await glide(page, page.getByRole("link", { name: t.source }).first());
      await sleep(1600);
    },
  },
  {
    name: "compartir",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    run: async (page, { locale }) => {
      const t = TEXT[locale];
      await clickOn(page, page.getByRole("button", { name: LABELS[locale].share, exact: true }));
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await sleep(900);
      const who = dialog.getByRole("heading", { name: t.whoTitle });
      await who.scrollIntoViewIfNeeded();
      await sleep(400);
      await glide(page, who);
      await sleep(700);
      // Down the list of people, slowly, so the reasons can be read.
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 140);
        await sleep(700);
      }
      await sleep(1200);
    },
  },
  {
    name: "conector",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    chat: ({ locale }) => chatPage(locale),
    run: async (page, { locale }) => {
      const t = CHAT[locale];
      const chat = page.frameLocator(`#${CHAT_FRAME}`);
      const input = chat.getByRole("textbox", { name: t.placeholder });
      await glide(page, input);
      await input.pressSequentially(t.question, { delay: 16 });
      await sleep(200);
      await page.keyboard.press("Enter");
      const open = chat.getByRole("link", { name: t.open });
      await open.waitFor({ timeout: 15_000 });
      await sleep(700);
      await clickOn(page, open);
      await page.locator(`#${CHAT_FRAME}`).waitFor({ state: "detached" });
      await sleep(1800);
    },
  },
];

// ─── The connector's chat ─────────────────────────────────────────────────────

/** The chat's frame, over the app. */
const CHAT_FRAME = "demo-chat";

/** The chat's texts: a question about the slicer and the answer from INS-001 (demo-content.ts). */
const CHAT: Record<
  Locale,
  {
    title: string;
    connected: string;
    placeholder: string;
    send: string;
    question: string;
    tools: [string, string];
    answer: string[];
    open: string;
  }
> = {
  es: {
    title: "Claude",
    connected: "Conector: SpiderFolio",
    placeholder: "Escribe tu pregunta",
    send: "Enviar",
    question: "¿Qué tengo que tener en cuenta antes de usar la cortadora de fiambres?",
    tools: ["SpiderFolio · search «cortadora»", "SpiderFolio · get_page INS-001"],
    answer: [
      "Según el documento vigente INS-001 «Uso de la cortadora de fiambres»:",
      "Antes de empezar: comprueba que la protección de la cuchilla está colocada y usa guante de malla en la mano que sujeta la pieza.",
      "Durante el uso: ajusta el grosor con la máquina parada, empuja la pieza siempre con el carro y apaga y desenchufa antes de limpiar.",
      "Importante: nunca retires la protección de la cuchilla con la máquina en marcha.",
    ],
    open: "Abrir INS-001 en SpiderFolio",
  },
  en: {
    title: "Claude",
    connected: "Connector: SpiderFolio",
    placeholder: "Type your question",
    send: "Send",
    question: "What should I keep in mind before using the meat slicer?",
    tools: ["SpiderFolio · search “slicer”", "SpiderFolio · get_page INS-001"],
    answer: [
      "According to the current document INS-001 “Using the meat slicer”:",
      "Before you start: check that the blade guard is in place and wear a mesh glove on the hand that holds the piece.",
      "While slicing: adjust the thickness with the machine stopped, always push the piece with the carriage, and switch off and unplug before cleaning.",
      "Important: never remove the blade guard while the machine is running.",
    ],
    open: "Open INS-001 in SpiderFolio",
  },
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/gu, (char) => `&#${String(char.charCodeAt(0))};`);

/**
 * A plain chat window (not a copy of any real product's screen): on Enter it shows the two tool calls
 * and writes the recorded answer at a fixed pace, ending with the link to the document. The link closes
 * the chat, uncovering the document loaded underneath. The mouse is passed on to the app's page, which
 * draws the clip's cursor.
 */
function chatPage(locale: Locale): string {
  const t = CHAT[locale];
  const data = JSON.stringify({ tools: t.tools, answer: t.answer, open: t.open });
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(t.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f1d1a; background: #f6f5f1; }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 24px; border-bottom: 1px solid #e4e1d8; background: #fff; }
  header b { font-size: 16px; }
  header span { font-size: 12px; color: #5f5a50; background: #efece4; border-radius: 999px; padding: 2px 10px; }
  main { max-width: 760px; margin: 0 auto; padding: 28px 24px 140px; display: grid; gap: 16px; }
  .me { justify-self: end; max-width: 80%; background: #e9e6dd; border-radius: 16px; padding: 10px 14px; }
  .tool { justify-self: start; font-size: 12px; color: #5f5a50; border: 1px solid #e4e1d8; background: #fff; border-radius: 8px; padding: 4px 10px; }
  .answer p { margin: 0 0 10px; }
  .answer a { display: inline-block; margin-top: 4px; color: #6d28d9; font-weight: 600; text-decoration: none; border: 1px solid #ddd6fe; background: #f5f3ff; border-radius: 8px; padding: 6px 12px; }
  form { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(712px, calc(100vw - 48px)); display: flex; gap: 8px; background: #fff; border: 1px solid #d9d5ca; border-radius: 16px; padding: 10px; box-shadow: 0 4px 18px rgb(0 0 0 / 6%); }
  input { flex: 1; border: 0; outline: 0; font: inherit; padding: 6px 8px; }
  button { border: 0; border-radius: 10px; background: #1f1d1a; color: #fff; font: inherit; padding: 6px 14px; }
</style></head><body>
<header><b>${escapeHtml(t.title)}</b><span>${escapeHtml(t.connected)}</span></header>
<main id="chat"></main>
<form id="ask"><input id="q" aria-label="${escapeHtml(t.placeholder)}" placeholder="${escapeHtml(t.placeholder)}" autocomplete="off"><button>${escapeHtml(t.send)}</button></form>
<script>
  const data = ${data};
  const chat = document.getElementById("chat");
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  for (const type of ["mousemove", "mousedown", "mouseup"]) {
    addEventListener(type, (event) => parent.dispatchEvent(new MouseEvent(type, { clientX: event.clientX, clientY: event.clientY })), true);
  }
  const add = (cls, text) => { const el = document.createElement("div"); el.className = cls; el.textContent = text; chat.append(el); return el; };
  document.getElementById("ask").addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = document.getElementById("q");
    add("me", q.value);
    q.value = "";
    for (const tool of data.tools) { await wait(450); add("tool", tool); }
    await wait(400);
    const answer = add("answer", "");
    for (const paragraph of data.answer) {
      const p = document.createElement("p");
      answer.append(p);
      for (const word of paragraph.split(" ")) { p.textContent += (p.textContent ? " " : "") + word; await wait(28); }
    }
    const a = document.createElement("a");
    a.href = "#"; a.textContent = data.open;
    a.addEventListener("click", (click) => {
      click.preventDefault();
      const frame = parent.document.getElementById("${CHAT_FRAME}");
      frame.style.opacity = "0";
      setTimeout(() => frame.remove(), 320);
    });
    answer.append(a);
  });
</script></body></html>`;
}

// ─── Data for the clips ───────────────────────────────────────────────────────

async function apiAs(
  email: string,
): Promise<(path: string, init?: RequestInit & { raw?: boolean }) => Promise<unknown>> {
  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "spiderfolio",
    // The API checks the origin against APP_URL.
    Origin: APP_URL,
  };
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`No pude entrar como ${email}: ${String(login.status)}`);
  const { accessToken } = (await login.json()) as { accessToken: string };
  return async (path, { raw = false, ...init } = {}) => {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: { ...headers, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${String(res.status)}`);
    // raw: a file (the controlled PDF), read and discarded.
    if (raw) {
      await res.arrayBuffer();
      return null;
    }
    return res.status === 204 ? null : ((await res.json()) as unknown);
  };
}

/** Replaces text in every text node of a Tiptap document. */
function replaceText(node: unknown, from: string, to: string): unknown {
  if (Array.isArray(node)) return node.map((child) => replaceText(child, from, to));
  if (typeof node !== "object" || node === null) return node;
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) };
  if (typeof copy.text === "string") copy.text = copy.text.split(from).join(to);
  if (Array.isArray(copy.content)) copy.content = replaceText(copy.content, from, to);
  return copy;
}

/**
 * Version 3 of "Document control" waiting for the admin's approval: a shorter review period and
 * a new responsibility, so the comparison has something to highlight.
 */
async function prepareReview(db: pg.Client, locale: Locale, ids: Ids): Promise<void> {
  const t = TEXT[locale];
  const owner = await apiAs(PEOPLE[locale].owner);
  const { page } = (await owner(`/w/${ids.slug}/pages/${ids.control}`)) as {
    page: { content: { content?: unknown[] }; revision: number };
  };
  const content = replaceText(page.content, t.review[0], t.review[1]) as {
    content: { type: string; content?: unknown[] }[];
  };
  const list = content.content.find((block) => block.type === "bulletList");
  list?.content?.push({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text: t.newRule }] }],
  });
  await owner(`/w/${ids.slug}/pages/${ids.control}/content`, {
    method: "PUT",
    body: JSON.stringify({ baseRevision: page.revision, content }),
  });
  const admin = await db.query<{ id: string }>(
    `SELECT m.id FROM "Membership" m JOIN "User" u ON u.id = m."userId"
       JOIN "Workspace" w ON w.id = m."workspaceId" WHERE u.email = $1 AND w.slug = $2`,
    [PEOPLE[locale].admin, ids.slug],
  );
  await owner(`/w/${ids.slug}/nodes/${ids.control}/controlled/submit`, {
    method: "POST",
    body: JSON.stringify({ approverIds: [admin.rows[0]?.id], changeNote: t.changeNote }),
  });
  // Gotenberg takes a few seconds the first time: generated now, the download in the clip is instant.
  await owner(`/w/${ids.slug}/nodes/${ids.control}/controlled/pdf?version=2`, { raw: true });
}

// ─── Recording and exporting ──────────────────────────────────────────────────

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`ffmpeg falló: ${result.stderr}`);
}

/** A GIF under MAX_GIF_BYTES: smaller width, frame rate and palette until it fits. */
function toGif(input: string, output: string, tries: [number, number, number][]): void {
  for (const [width, fps, colors] of tries) {
    ffmpeg([
      "-i",
      input,
      "-vf",
      `fps=${String(fps)},scale=${String(width)}:-1:flags=lanczos,split[a][b];` +
        `[a]palettegen=max_colors=${String(colors)}:stats_mode=diff[p];` +
        "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
      output,
    ]);
    if (statSync(output).size <= MAX_GIF_BYTES) return;
  }
  throw new Error(`${output} pesa más de 5 MB incluso con la versión más chica`);
}

const CLIP_GIF: [number, number, number][] = [
  [960, 12, 128],
  [800, 10, 96],
  [720, 8, 64],
];
const DEMO_GIF: [number, number, number][] = [
  [800, 10, 96],
  [720, 8, 64],
  [640, 8, 48],
  [560, 6, 32],
];

async function record(
  browser: Browser,
  clip: Clip,
  ctx: ClipContext,
  bian: BianRecording,
): Promise<string> {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: work, size: { width: WIDTH, height: HEIGHT } },
    locale: ctx.locale === "es" ? "es-ES" : "en-GB",
    colorScheme: "light",
    reducedMotion: "no-preference",
    acceptDownloads: true,
    // Only for the fake cursor's styles; the app itself is the same.
    bypassCSP: true,
  });
  await context.addInitScript(CURSOR_SCRIPT);
  await context.addInitScript(fakeBian, bian);
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("spiderfolio-theme", "light");
    } catch {
      // Without storage the system theme (light here) is used.
    }
  });
  await context.route(BIAN_USAGE, fakeBianUsage(bian));
  await signIn(context, BASE, PEOPLE[ctx.locale][clip.who], password);
  // The session cookie was set for localhost (Node can't resolve the example host): the same one for
  // the address the page uses.
  // All of them: the refresh cookie lives under /api/v1/auth, not under the root URL.
  const cookies = (await context.cookies()).filter((cookie) => cookie.domain === "localhost");
  await context.addCookies(
    cookies.map((cookie) => ({ ...cookie, domain: APP_HOST, secure: false })),
  );
  const page = await context.newPage();
  const opened = Date.now();
  await page.goto(`${APP_URL}/app`);
  await waitUntilReady(page);
  await page.goto(`${APP_URL}${clip.path(ctx.ids)}`);
  await waitUntilReady(page);
  if (clip.chat !== undefined) {
    await page.evaluate(
      ([id, html]) => {
        const frame = document.createElement("iframe");
        frame.id = id;
        frame.srcdoc = html;
        Object.assign(frame.style, {
          position: "fixed",
          inset: "0",
          width: "100%",
          height: "100%",
          border: "0",
          zIndex: "2147483646",
          transition: "opacity 300ms ease",
        });
        document.body.append(frame);
      },
      [CHAT_FRAME, clip.chat(ctx)] as const,
    );
    await page.frameLocator(`#${CHAT_FRAME}`).getByRole("textbox").waitFor();
  }
  await sleep(500);
  const start = (Date.now() - opened) / 1000;
  await clip.run(page, ctx);
  const end = (Date.now() - opened) / 1000;
  const video = page.video();
  await context.close();
  const raw = await video?.path();
  if (raw === undefined) throw new Error("Playwright no grabó el video");
  const duration = end - start;
  if (duration < 6 || duration > 10) {
    console.warn(`${ctx.locale}/${clip.name}: dura ${duration.toFixed(1)} s (objetivo 6 a 10 s)`);
  }
  const mp4 = join(webOut, ctx.locale, `${clip.name}.mp4`);
  ffmpeg([
    "-ss",
    start.toFixed(2),
    "-i",
    raw,
    "-t",
    duration.toFixed(2),
    "-vf",
    `fps=30,scale=${String(WIDTH)}:${String(HEIGHT)}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "24",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ]);
  // Poster: shown before playing and when motion is reduced.
  ffmpeg([
    "-ss",
    (duration * 0.6).toFixed(2),
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-q:v",
    "80",
    join(webOut, ctx.locale, `${clip.name}.webp`),
  ]);
  toGif(mp4, join(gifOut, `${clip.name}-${ctx.locale}.gif`), CLIP_GIF);
  console.log(`${ctx.locale}/${clip.name}: ${duration.toFixed(1)} s`);
  return mp4;
}

/** The clips in sequence, for the top of the README. */
function demoGif(locale: Locale, work: string): void {
  const list = join(work, `demo-${locale}.txt`);
  writeFileSync(
    list,
    CLIPS.map(
      (clip) => `file '${join(webOut, locale, `${clip.name}.mp4`).replace(/\\/gu, "/")}'`,
    ).join("\n"),
  );
  const joined = join(work, `demo-${locale}.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
  toGif(joined, join(gifOut, `demo-${locale}.gif`), DEMO_GIF);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const clipsUrl = sourceUrl.replace(/_capturas(\?|$)/u, "_clips_capturas$1");
const clipsName = new URL(clipsUrl).pathname.slice(1);
const sourceName = new URL(sourceUrl).pathname.slice(1);
const admin = new pg.Client({
  connectionString: Object.assign(new URL(sourceUrl), { pathname: "/postgres" }).href,
});
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${clipsName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${clipsName}" TEMPLATE "${sourceName}"`);

const only = process.env.CLIPS_SOLO ? new Set(process.env.CLIPS_SOLO.split(",")) : null;
const onlyLocale = process.env.CLIPS_IDIOMA;
const work = mkdtempSync(join(tmpdir(), "spiderfolio-clips-"));
mkdirSync(gifOut, { recursive: true });
const db = new pg.Client({ connectionString: clipsUrl });
await db.connect();
await db.query(`DELETE FROM "RateLimitBucket"`);
const server = await startServer({ port: PORT, databaseUrl: clipsUrl, env: { APP_URL } });
// Full Chromium (not the headless shell): it has the PDF viewer the control clip ends with.
const browser = await chromium.launch({
  channel: "chromium",
  args: [`--host-resolver-rules=MAP ${APP_HOST}:80 127.0.0.1:${String(PORT)}`],
});
try {
  for (const locale of ["es", "en"] as const) {
    if (onlyLocale !== undefined && onlyLocale !== locale) continue;
    mkdirSync(join(webOut, locale), { recursive: true });
    const ids = await idsOf(db, locale);
    const bian = await bianRecording(db, locale, ids);
    if (only === null || only.has("control")) await prepareReview(db, locale, ids);
    for (const clip of CLIPS) {
      if (only !== null && !only.has(clip.name)) continue;
      await record(browser, clip, { locale, ids, work }, bian);
      // Without going over the API's global limit of requests per minute.
      await sleep(1500);
    }
    if (only === null) demoGif(locale, work);
  }
  if (release !== undefined) {
    const gifs = readdirSync(gifOut)
      .filter((file) => file.endsWith(".gif"))
      .map((file) => join(gifOut, file));
    const upload = spawnSync("gh", ["release", "upload", release, ...gifs, "--clobber"], {
      stdio: "inherit",
    });
    if (upload.status !== 0)
      throw new Error(`No se pudieron subir los GIF a la Release ${release}`);
  }
} finally {
  await browser.close();
  server.kill();
  await db.end();
  await sleep(500);
  await admin.query(`DROP DATABASE IF EXISTS "${clipsName}" WITH (FORCE)`);
  await admin.end();
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    // Windows can keep the browser's video locked for a moment: a temp folder left behind is harmless
    // and must not hide the real error.
  }
}
