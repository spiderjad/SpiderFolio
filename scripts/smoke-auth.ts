// npm run smoke:auth — prueba de humo del flujo de auth contra la API local y Mailpit:
// registro → email recibido → verificación → login → /me → refresh → refresh sin cabeceras.
// Requiere `docker compose up -d` y `npm run dev` (API y worker). Funciona igual en
// PowerShell, Git Bash, macOS o Linux: solo usa Node.
//
// Variables opcionales: API_URL (http://localhost:4000), MAILPIT_API
// (http://localhost:8025/api/v1). El Origin se toma de APP_URL del .env.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MAILPIT = (process.env.MAILPIT_API ?? "http://localhost:8025/api/v1").replace(/\/$/, "");
const ORIGIN = new URL(process.env.APP_URL ?? "http://localhost:5173").origin;

const EMAIL = `smoke-${String(Date.now())}-${randomUUID().slice(0, 8)}@smoke.local`;
const PASSWORD = `smoke-${randomUUID()}`;
const SUBJECT_VERIFY = "Confirma tu email en SpiderFolio";

class StepError extends Error {}

const fail = (message: string): never => {
  throw new StepError(message);
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    console.log(`✓ ${name}`);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`✗ ${name}: ${detail}`);
    process.exit(1);
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    return await fetch(`${API}${path}`, { ...init, headers });
  } catch {
    return fail(`no responde ${API}. ¿Está corriendo npm run dev?`);
  }
}

/** Código y mensaje de un error de la API, para mostrar en el ✗. */
async function describe(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  const hint = res.status === 429 ? " (rate limit: esperá unos minutos o probá desde otra IP)" : "";
  return `HTTP ${String(res.status)} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}${hint}`.trim();
}

async function expectStatus(res: Response, expected: number): Promise<void> {
  if (res.status !== expected)
    fail(`se esperaba ${String(expected)}, llegó ${await describe(res)}`);
}

function refreshCookie(res: Response): string {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("spiderfolio_rt="));
  return cookie?.split(";")[0] ?? fail("la respuesta no trae la cookie spiderfolio_rt");
}

const refresh = (cookie: string, withHeaders: boolean) =>
  api("/api/v1/auth/refresh", {
    method: "POST",
    headers: {
      Cookie: cookie,
      ...(withHeaders ? { "X-Requested-With": "spiderfolio", Origin: ORIGIN } : {}),
    },
  });

console.log(`Prueba de auth contra ${API} con ${EMAIL}\n`);

await step("API disponible (/api/health)", async () => {
  await expectStatus(await api("/api/health"), 200);
});

const registered = await step("Registro (201, cookie de refresh)", async () => {
  const res = await api("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Prueba de humo",
      email: EMAIL,
      password: PASSWORD,
      companyName: "Smoke SA",
      acceptTerms: true,
    }),
  });
  await expectStatus(res, 201);
  const cookie = refreshCookie(res);
  const body = (await res.json()) as { user: { emailVerified: boolean } };
  if (body.user.emailVerified) fail("el email figura verificado antes de verificarlo");
  return { cookie };
});

const token = await step("Email de verificación recibido en Mailpit", async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:"${EMAIL}" subject:"${SUBJECT_VERIFY}"`);
    const search = await fetch(`${MAILPIT}/search?query=${query}`).catch(() =>
      fail(`no responde Mailpit en ${MAILPIT}. ¿Está docker compose up -d?`),
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    const id = messages[0]?.ID;
    if (id !== undefined) {
      const message = (await (await fetch(`${MAILPIT}/message/${id}`)).json()) as { Text: string };
      const match = /#token=([A-Za-z0-9_-]+)/.exec(message.Text);
      return match?.[1] ?? fail("el email no trae un enlace con #token=");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return fail("no llegó en 15 s. ¿Está corriendo el worker (npm run dev)?");
});

await step("Verificación del email (204)", async () => {
  await expectStatus(
    await api("/api/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
    204,
  );
});

const accessToken = await step("Login (200, access token)", async () => {
  const res = await api("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  await expectStatus(res, 200);
  const body = (await res.json()) as { accessToken?: string };
  return body.accessToken ?? fail("la respuesta no trae accessToken");
});

await step("/me con el email verificado", async () => {
  const res = await api("/api/v1/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  await expectStatus(res, 200);
  const body = (await res.json()) as { user: { email: string; emailVerified: boolean } };
  if (body.user.email !== EMAIL) fail(`/me devolvió otro usuario (${body.user.email})`);
  if (!body.user.emailVerified) fail("emailVerified sigue en false");
});

const rotated = await step("Refresh con la cookie (200, rota la cookie)", async () => {
  const res = await refresh(registered.cookie, true);
  await expectStatus(res, 200);
  const cookie = refreshCookie(res);
  if (cookie === registered.cookie) fail("la cookie no rotó");
  return cookie;
});

await step("Refresh sin X-Requested-With ni Origin (403)", async () => {
  await expectStatus(await refresh(rotated, false), 403);
});

console.log("\nFlujo de auth OK.");
