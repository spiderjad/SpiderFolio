// Auth completa (CLAUDE.md, secciones 7.1 a 7.3) por HTTP, con Postgres, pg-boss y Mailpit.
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { PgBoss } from "pg-boss";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { createMailer } from "../../src/lib/mailer.ts";
import { MAX_FAILED_LOGINS } from "../../src/modules/auth/auth.service.ts";
import { ARGON2_OPTIONS, type Passwords } from "../../src/modules/auth/passwords.ts";
import { startWorker } from "../../src/worker.ts";
import { errorOf } from "../http.ts";
import {
  countEmails,
  createTestBoss,
  createTestContext,
  tokenFromEmail,
  uniqueEmail,
  waitForEmail,
  type TestContext,
} from "./helpers.ts";
import { TEST_DEMO_PASSWORD } from "./test-db.ts";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "una-clave-bien-larga";
const DAY = 24 * 3600 * 1000;

let ctx: TestContext;
let worker: PgBoss;
let app: ReturnType<typeof createApp>;
/** Verificaciones de argon2 hechas (verify + verifyDummy), para el test de tiempos. */
let verifications = 0;

// Cada request de un test usa su propia IP, así los rate limits no se pisan entre tests.
let ipCounter = 0;
const nextIp = () => {
  ipCounter++;
  return `198.18.${String(Math.floor(ipCounter / 250))}.${String((ipCounter % 250) + 1)}`;
};

beforeAll(async () => {
  ctx = await createTestContext();
  const real: Passwords = ctx.deps.passwords;
  ctx.deps.passwords = {
    ...real,
    verify: (hash, password) => {
      verifications++;
      return real.verify(hash, password);
    },
    verifyDummy: (password) => {
      verifications++;
      return real.verifyDummy(password);
    },
  };
  app = createApp(ctx.deps);
  worker = createTestBoss(ctx.deps.env.DATABASE_URL, "worker");
  await worker.start();
  await startWorker(worker, {
    prisma: ctx.prisma,
    mailer: createMailer(ctx.deps.env),
    logger: createLogger(ctx.deps.env),
    appUrl: ctx.deps.env.APP_URL,
    storage: ctx.deps.storage,
    systemStorage: ctx.deps.systemStorage,
  });
});

afterAll(async () => {
  await worker.stop({ graceful: false });
  await ctx.close();
});

const post = (path: string, body?: object, ip = nextIp()) =>
  request(app).post(`/api/v1/auth${path}`).set("X-Forwarded-For", ip).send(body);

interface AuthBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; emailVerified: boolean };
  memberships: { workspace: { slug: string }; role: { base: string }; seatType: string }[];
}
const authBody = (res: { body: unknown }) => res.body as AuthBody;

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = (res.headers["set-cookie"] as string[] | undefined) ?? [];
  const cookie = cookies.find((c) => c.startsWith("spiderfolio_rt="));
  if (cookie === undefined) throw new Error("Sin cookie spiderfolio_rt");
  return cookie;
}
const cookieValue = (setCookie: string) => setCookie.split(";")[0] ?? "";

async function register(email = uniqueEmail("registro"), company = "Industrias Prueba") {
  const res = await post("/register", {
    name: "Ana Ruiz",
    email,
    password: PASSWORD,
    companyName: company,
    timezone: "America/Argentina/Buenos_Aires",
    acceptTerms: true,
  });
  expect(res.status).toBe(201);
  return { res, email, body: authBody(res), cookie: cookieValue(refreshCookie(res)) };
}

const refresh = (cookie: string, headers: Record<string, string> = {}) =>
  request(app)
    .post("/api/v1/auth/refresh")
    .set("Cookie", cookie)
    .set("X-Requested-With", "spiderfolio")
    .set("Origin", ORIGIN)
    .set(headers)
    .send();

const me = (token: string) =>
  request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);

describe("registro", () => {
  it("crea usuario, workspace en prueba, sesión y envía la verificación", async () => {
    const { res, email, body } = await register();
    expect(body.user).toMatchObject({ email, emailVerified: false });
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]).toMatchObject({ role: { base: "OWNER" }, seatType: "FULL" });
    expect(res.headers["set-cookie"]).toBeDefined();

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    const settings = await ctx.prisma.workspace.findFirstOrThrow({
      where: { memberships: { some: { userId: user.id } } },
    });
    expect(settings.settings).toEqual({
      timezone: "America/Argentina/Buenos_Aires",
      locale: "es",
    });

    const mail = await waitForEmail(email, "Confirma tu email en SpiderFolio");
    expect(mail.text).toContain("/verify-email#token=");
    expect(mail.text).not.toMatch(/verify-email\?token=/);
  });

  it("normaliza el email y rechaza un duplicado con 409 genérico", async () => {
    const email = uniqueEmail("dup");
    await register(email);
    const res = await post("/register", {
      name: "Otra",
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      companyName: "Otra",
      acceptTerms: true,
    });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe("CONFLICT");
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
  });

  it("valida con Zod (400 sin repetir valores) y tiene rate limit por IP", async () => {
    const bad = await post("/register", {
      name: "A",
      email: "x",
      password: "corta",
      companyName: "B",
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain("corta");

    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await post("/register", { name: "A" }, ip)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("verificación de email", () => {
  it("flujo completo: registro → email en Mailpit → verificación, de un solo uso", async () => {
    const { email, body } = await register();
    const token = tokenFromEmail(
      (await waitForEmail(email, "Confirma tu email en SpiderFolio")).text,
    );

    expect((await post("/verify-email", { token })).status).toBe(204);
    expect(authBody(await me(body.accessToken)).user.emailVerified).toBe(true);

    const reused = await post("/verify-email", { token });
    expect(reused.status).toBe(400);
    expect(errorOf(reused).code).toBe("INVALID_TOKEN");
  });

  it("un token vencido no sirve", async () => {
    const { email } = await register();
    const token = tokenFromEmail(
      (await waitForEmail(email, "Confirma tu email en SpiderFolio")).text,
    );
    await ctx.prisma.authToken.updateMany({
      where: { user: { email }, type: "VERIFY_EMAIL" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(errorOf(await post("/verify-email", { token })).code).toBe("INVALID_TOKEN");
  });

  it("reenviar invalida el enlace anterior; con el email verificado no envía nada", async () => {
    const { email, body } = await register();
    const first = tokenFromEmail(
      (await waitForEmail(email, "Confirma tu email en SpiderFolio")).text,
    );
    const resend = await request(app)
      .post("/api/v1/auth/resend-verification")
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(resend.status).toBe(204);
    await expect.poll(() => countEmails(email), { timeout: 15_000 }).toBe(2);
    const second = tokenFromEmail(
      (await waitForEmail(email, "Confirma tu email en SpiderFolio")).text,
    );
    expect(second).not.toBe(first);
    expect(errorOf(await post("/verify-email", { token: first })).code).toBe("INVALID_TOKEN");
    expect((await post("/verify-email", { token: second })).status).toBe(204);

    await request(app)
      .post("/api/v1/auth/resend-verification")
      .set("Authorization", `Bearer ${body.accessToken}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await countEmails(email)).toBe(2);
  });
});

describe("login", () => {
  it("devuelve access token, cookie y workspaces; sin miembros suspendidos", async () => {
    const { email } = await register();
    const res = await post("/login", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(authBody(res).memberships).toHaveLength(1);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    await ctx.prisma.membership.updateMany({
      where: { userId: user.id },
      data: { status: "SUSPENDED" },
    });
    expect(authBody(await post("/login", { email, password: PASSWORD })).memberships).toEqual([]);
  });

  it("mismo error para email inexistente y contraseña incorrecta", async () => {
    const { email } = await register();
    const unknown = await post("/login", { email: uniqueEmail("nadie"), password: PASSWORD });
    const wrong = await post("/login", { email, password: "otra-clave-incorrecta" });
    for (const res of [unknown, wrong]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email o contraseña incorrectos.",
          requestId: res.headers["x-request-id"],
        },
      });
    }
  });

  it("email inexistente, contraseña incorrecta y cuenta bloqueada hacen el mismo trabajo y tardan lo mismo", async () => {
    const { email: valid } = await register();
    const { email: locked } = await register();
    await ctx.prisma.user.update({
      where: { email: locked },
      data: { lockedUntil: new Date(Date.now() + 3600_000) },
    });
    const cases = {
      inexistente: () => post("/login", { email: uniqueEmail("nadie"), password: PASSWORD }),
      incorrecta: () => post("/login", { email: valid, password: "otra-clave-incorrecta" }),
      bloqueada: () => post("/login", { email: locked, password: PASSWORD }),
    };

    // Determinístico: cada caso hace exactamente una verificación de argon2.
    for (const [name, attempt] of Object.entries(cases)) {
      const before = verifications;
      const res = await attempt();
      expect(errorOf(res).code, name).toBe("INVALID_CREDENTIALS");
      expect(verifications - before, name).toBe(1);
    }

    // Tiempos: medianas comparables (margen amplio para no ser frágil en CI).
    const samples: Record<string, number[]> = { inexistente: [], incorrecta: [], bloqueada: [] };
    for (let round = 0; round < 7; round++) {
      for (const [name, attempt] of Object.entries(cases)) {
        const start = performance.now();
        await attempt();
        samples[name]?.push(performance.now() - start);
      }
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[3] ?? 0;
    const medians = Object.values(samples).map(median);
    expect(Math.max(...medians) / Math.min(...medians)).toBeLessThan(2.5);
  });

  it("bloquea 15 minutos tras 10 fallos, aun con la contraseña correcta", async () => {
    const { email } = await register();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      expect((await post("/login", { email, password: "incorrecta-123" })).status).toBe(401);
    }
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(errorOf(await post("/login", { email, password: PASSWORD })).code).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(
      await ctx.prisma.auditLog.count({ where: { actorId: user.id, action: "auth.lockout" } }),
    ).toBe(1);

    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await post("/login", { email, password: PASSWORD })).status).toBe(200);
    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("rate limit: 5 por IP+email y 50 por IP cada 15 minutos", async () => {
    const { email } = await register();
    const ip = nextIp();
    const sameEmail: number[] = [];
    for (let i = 0; i < 6; i++) {
      sameEmail.push((await post("/login", { email, password: "incorrecta-123" }, ip)).status);
    }
    expect(sameEmail).toEqual([401, 401, 401, 401, 401, 429]);

    const ip2 = nextIp();
    const manyEmails: number[] = [];
    for (let i = 0; i < 51; i++) {
      manyEmails.push(
        (await post("/login", { email: uniqueEmail("rl"), password: "x" }, ip2)).status,
      );
    }
    expect(manyEmails.slice(0, 50).every((s) => s === 401)).toBe(true);
    expect(manyEmails[50]).toBe(429);
  });

  it("needsRehash: un hash con parámetros viejos se recalcula al iniciar sesión", async () => {
    const { email } = await register();
    const oldHash = await argon2.hash(PASSWORD, { ...ARGON2_OPTIONS, parallelism: 4 });
    await ctx.prisma.user.update({ where: { email }, data: { passwordHash: oldHash } });

    expect((await post("/login", { email, password: PASSWORD })).status).toBe(200);
    const rehashed = (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash;
    expect(rehashed).not.toBe(oldHash);
    expect(rehashed).toMatch(/\$m=19456,p=1,t=2\$/);
    expect((await post("/login", { email, password: PASSWORD })).status).toBe(200);
    // Con un hash actual no se reescribe.
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBe(
      rehashed,
    );
  });

  it("avisa por email de un dispositivo nuevo, no del mismo", async () => {
    const { email } = await register();
    await waitForEmail(email, "Confirma tu email en SpiderFolio");
    const ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";
    // Mismo user agent que el registro (supertest): sin aviso.
    await post("/login", { email, password: PASSWORD });
    await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", nextIp())
      .set("User-Agent", ua)
      .send({ email, password: PASSWORD });
    const mail = await waitForEmail(email, "Nuevo inicio de sesión en SpiderFolio");
    expect(mail.text).toContain("Chrome en Windows");
    expect(await countEmails(email)).toBe(2);
  });
});

describe("cookie del refresh token", () => {
  it("HttpOnly, SameSite=Strict, Path=/api/v1/auth, sin Domain ni Secure fuera de producción", async () => {
    const { res } = await register();
    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/);
  });

  it("Secure en producción", async () => {
    const prodApp = createApp({ ...ctx.deps, env: { ...ctx.deps.env, NODE_ENV: "production" } });
    const res = await request(prodApp)
      .post("/api/v1/auth/register")
      .set("X-Forwarded-For", nextIp())
      .send({
        name: "Ana",
        email: uniqueEmail(),
        password: PASSWORD,
        companyName: "Prod SA",
        acceptTerms: true,
      });
    expect(refreshCookie(res)).toMatch(/; Secure/);
  });

  it("en la base solo queda el SHA-256 del refresh token", async () => {
    const { cookie, body } = await register();
    const token = cookie.replace("spiderfolio_rt=", "");
    const sessions = await ctx.prisma.session.findMany({ where: { userId: body.user.id } });
    expect(sessions.some((s) => s.tokenHash === token)).toBe(false);
  });
});

describe("refresh", () => {
  it("rota en cada uso y devuelve un access token válido", async () => {
    const { cookie } = await register();
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    const next = cookieValue(refreshCookie(res));
    expect(next).not.toBe(cookie);
    expect((await me((res.body as { accessToken: string }).accessToken)).status).toBe(200);
  });

  it("exige X-Requested-With y el Origin de la app", async () => {
    const { cookie } = await register();
    const noHeader = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    const otherOrigin = await refresh(cookie, { Origin: "https://otro-sitio.example" });
    for (const res of [noHeader, otherOrigin]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe("FORBIDDEN");
    }
    // El token sigue sirviendo: los rechazos no lo consumieron.
    expect((await refresh(cookie)).status).toBe(200);
  });

  it("dentro de 5 s, un token recién rotado da 401 sin cerrar la sesión (pestañas)", async () => {
    const { cookie } = await register();
    const rotated = await refresh(cookie);
    const next = cookieValue(refreshCookie(rotated));
    const race = await refresh(cookie);
    expect(race.status).toBe(401);
    expect(errorOf(race).code).toBe("UNAUTHENTICATED");
    // The race keeps the cookie: clearing it would erase the new one the other tab just got.
    const cleared = (res: { headers: Record<string, unknown> }) =>
      ((res.headers["set-cookie"] as string[] | undefined) ?? []).some((c) =>
        c.startsWith("spiderfolio_rt="),
      );
    expect(cleared(race)).toBe(false);
    expect((await refresh(next)).status).toBe(200);
    // Any other failure (unknown token) still clears it.
    const unknown = await refresh("spiderfolio_rt=no-es-un-token");
    expect(unknown.status).toBe(401);
    expect(cleared(unknown)).toBe(true);
  });

  it("el access token de otra pestaña sigue valiendo después de una rotación, en la sesión activa", async () => {
    const { cookie, body } = await register();
    // Tab A: its token belongs to the session that tab B rotates twice in a row.
    const first = await refresh(cookie);
    const tabA = (first.body as { accessToken: string }).accessToken;
    const next = cookieValue(refreshCookie(first));
    const second = await refresh(next);
    expect(second.status).toBe(200);
    const after = cookieValue(refreshCookie(second));
    expect((await refresh(after)).status).toBe(200);
    expect((await me(tabA)).status).toBe(200);
    expect((await me(body.accessToken)).status).toBe(200);
    // The request is bound to the active session: the list marks the only live one as current.
    const list = await request(app)
      .get("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${tabA}`);
    const sessions = (list.body as { sessions: { current: boolean }[] }).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
  });

  it("logout y reuso cortan también los access tokens de sesiones ya rotadas", async () => {
    const out = await register();
    const outNext = cookieValue(refreshCookie(await refresh(out.cookie)));
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", outNext)
      .set("X-Requested-With", "spiderfolio")
      .set("Origin", ORIGIN);
    expect(logout.status).toBe(204);
    expect((await me(out.body.accessToken)).status).toBe(401);

    const reused = await register();
    cookieValue(refreshCookie(await refresh(reused.cookie)));
    await ctx.prisma.session.updateMany({
      where: { userId: reused.body.user.id, replacedAt: { not: null } },
      data: { replacedAt: new Date(Date.now() - 10_000) },
    });
    expect((await refresh(reused.cookie)).status).toBe(401);
    expect((await me(reused.body.accessToken)).status).toBe(401);
  });

  it("reuso pasado el margen: revoca toda la familia y lo registra", async () => {
    const { cookie, body } = await register();
    const next = cookieValue(refreshCookie(await refresh(cookie)));
    await ctx.prisma.session.updateMany({
      where: { userId: body.user.id, replacedAt: { not: null } },
      data: { replacedAt: new Date(Date.now() - 10_000) },
    });
    expect((await refresh(cookie)).status).toBe(401);
    expect((await refresh(next)).status).toBe(401);
    expect(
      await ctx.prisma.auditLog.count({
        where: { actorId: body.user.id, action: "auth.refresh.reuse_detected" },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.session.count({ where: { userId: body.user.id, revokedAt: null } }),
    ).toBe(0);
  });

  it("tope absoluto: la rotación no pasa de login + 90 días, y después vence", async () => {
    const { cookie, body } = await register();
    const familyCreatedAt = new Date(Date.now() - 89 * DAY);
    await ctx.prisma.session.updateMany({
      where: { userId: body.user.id },
      data: { familyCreatedAt },
    });
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    const session = await ctx.prisma.session.findFirstOrThrow({
      where: { userId: body.user.id, revokedAt: null },
    });
    expect(session.familyCreatedAt.getTime()).toBe(familyCreatedAt.getTime());
    expect(session.expiresAt.getTime()).toBe(familyCreatedAt.getTime() + 90 * DAY);

    await ctx.prisma.session.updateMany({
      where: { userId: body.user.id },
      data: { familyCreatedAt: new Date(Date.now() - 91 * DAY) },
    });
    expect((await refresh(cookieValue(refreshCookie(res)))).status).toBe(401);
  });

  it("sin cookie o con una cookie desconocida: 401 y borra la cookie", async () => {
    const res = await refresh("spiderfolio_rt=inventado");
    expect(res.status).toBe(401);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("logout y sesiones", () => {
  it("logout revoca la familia y borra la cookie con los mismos atributos", async () => {
    const { cookie, body } = await register();
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("X-Requested-With", "spiderfolio")
      .set("Origin", ORIGIN);
    expect(res.status).toBe(204);
    const cleared = refreshCookie(res);
    expect(cleared).toMatch(/Path=\/api\/v1\/auth/);
    expect(cleared).toMatch(/HttpOnly/);
    expect(cleared).toMatch(/SameSite=Strict/);
    expect((await me(body.accessToken)).status).toBe(401);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it("logout-all cierra todas las sesiones", async () => {
    const { email, body } = await register();
    const other = authBody(await post("/login", { email, password: PASSWORD }));
    const res = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(res.status).toBe(204);
    expect((await me(other.accessToken)).status).toBe(401);
  });

  it("lista las sesiones activas marcando la actual, y cierra una propia; una ajena es 404", async () => {
    const { email, body } = await register();
    const second = authBody(await post("/login", { email, password: PASSWORD }));
    const list = await request(app)
      .get("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${body.accessToken}`);
    const sessions = (list.body as { sessions: { id: string; current: boolean }[] }).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const other = sessions.find((s) => !s.current);
    const del = await request(app)
      .delete(`/api/v1/auth/sessions/${other?.id ?? ""}`)
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(del.status).toBe(204);
    expect((await me(second.accessToken)).status).toBe(401);

    const stranger = await register();
    const foreign = await request(app)
      .delete(`/api/v1/auth/sessions/${sessions.find((s) => s.current)?.id ?? ""}`)
      .set("Authorization", `Bearer ${stranger.body.accessToken}`);
    expect(foreign.status).toBe(404);
    expect((await me(body.accessToken)).status).toBe(200);
  });
});

describe("contraseñas", () => {
  it("forgot-password responde igual exista o no el email, y solo envía si existe", async () => {
    const { email } = await register();
    const ghost = uniqueEmail("fantasma");
    const a = await post("/forgot-password", { email });
    const b = await post("/forgot-password", { email: ghost });
    expect(a.status).toBe(204);
    expect(b.status).toBe(204);
    await waitForEmail(email, "Restablece tu contraseña de SpiderFolio");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await countEmails(ghost)).toBe(0);
  });

  it("reset-password: un solo uso, revoca las sesiones y avisa por email", async () => {
    const { email, body } = await register();
    await post("/forgot-password", { email });
    const token = tokenFromEmail(
      (await waitForEmail(email, "Restablece tu contraseña de SpiderFolio")).text,
    );
    const nueva = "otra-clave-muy-segura";
    expect((await post("/reset-password", { token, password: nueva })).status).toBe(204);
    expect((await me(body.accessToken)).status).toBe(401);
    expect((await post("/login", { email, password: nueva })).status).toBe(200);
    expect((await post("/login", { email, password: PASSWORD })).status).toBe(401);
    expect(errorOf(await post("/reset-password", { token, password: nueva })).code).toBe(
      "INVALID_TOKEN",
    );
    await waitForEmail(email, "Tu contraseña de SpiderFolio cambió");
  });

  it("reset-password: un token vencido no sirve", async () => {
    const { email } = await register();
    await post("/forgot-password", { email });
    const token = tokenFromEmail(
      (await waitForEmail(email, "Restablece tu contraseña de SpiderFolio")).text,
    );
    await ctx.prisma.authToken.updateMany({
      where: { user: { email }, type: "RESET_PASSWORD" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      errorOf(await post("/reset-password", { token, password: "otra-clave-muy-segura" })).code,
    ).toBe("INVALID_TOKEN");
  });

  it("change-password pide la actual y conserva solo la sesión actual", async () => {
    const { email, body } = await register();
    const other = authBody(await post("/login", { email, password: PASSWORD }));
    const change = (currentPassword: string) =>
      request(app)
        .post("/api/v1/auth/change-password")
        .set("Authorization", `Bearer ${body.accessToken}`)
        .send({ currentPassword, newPassword: "clave-nueva-segura" });

    const wrong = await change("no-es-la-actual");
    expect(wrong.status).toBe(401);
    expect(errorOf(wrong).code).toBe("INVALID_CREDENTIALS");

    expect((await change(PASSWORD)).status).toBe(204);
    expect((await me(body.accessToken)).status).toBe(200);
    expect((await me(other.accessToken)).status).toBe(401);
    await waitForEmail(email, "Tu contraseña de SpiderFolio cambió");
  });
});

describe("seed demo", () => {
  it.each([
    ["duena@demo.local", "OWNER", "FULL"],
    ["admin@demo.local", "ADMIN", "FULL"],
    ["miembro@demo.local", "MEMBER", "FULL"],
    ["lector@demo.local", "MEMBER", "READER"],
    ["invitado@demo.local", "GUEST", "READER"],
  ])("%s entra con su rol y plaza", async (email, base, seat) => {
    const res = await post("/login", { email, password: TEST_DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(authBody(res).user.emailVerified).toBe(true);
    expect(authBody(res).memberships[0]).toMatchObject({
      workspace: { slug: "embutidos-demo-s-l" },
      role: { base },
      seatType: seat,
    });
  });

  it("el seed se niega a correr contra una base que no es local", async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["prisma/seed.ts"], {
      cwd: new URL("../..", import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://u:p@db-${randomUUID()}.example.com:5432/spiderfolio`,
        SEED_DEMO_PASSWORD: TEST_DEMO_PASSWORD,
      },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("solo corre contra una base local");
  });
});

describe("términos y condiciones", () => {
  const registerBody = (extra: object = {}) => ({
    name: "Ana Ruiz",
    email: uniqueEmail("terminos"),
    password: PASSWORD,
    companyName: "Terminos SA",
    ...extra,
  });

  it("rechaza el registro sin aceptar (falta o false) y no crea nada", async () => {
    for (const extra of [{}, { acceptTerms: false }]) {
      const body = registerBody(extra);
      const res = await post("/register", body);
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe("VALIDATION_ERROR");
      expect(await ctx.prisma.user.count({ where: { email: body.email } })).toBe(0);
    }
  });

  it("guarda la evidencia: usuario, fecha, IP, user agent y la versión vigente", async () => {
    const body = registerBody({ acceptTerms: true });
    const ip = nextIp();
    const before = new Date();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .set("X-Forwarded-For", ip)
      .set("User-Agent", "Prueba-Terminos/1.0")
      .send(body);
    expect(res.status).toBe(201);
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: body.email },
      include: { termsAcceptances: true },
    });
    expect(user.termsAcceptances).toHaveLength(1);
    expect(user.termsAcceptances[0]).toMatchObject({
      userId: user.id,
      version: ctx.deps.env.TERMS_VERSION,
      ip,
      userAgent: "Prueba-Terminos/1.0",
    });
    expect(user.termsAcceptances[0]?.acceptedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
    expect(authBody(res).user).toBeDefined();
    expect((res.body as { user: { terms: object } }).user.terms).toEqual({
      currentVersion: ctx.deps.env.TERMS_VERSION,
      acceptedVersion: ctx.deps.env.TERMS_VERSION,
      required: false,
    });
  });

  it("las novedades por email se guardan aparte y desmarcadas por defecto", async () => {
    const without = registerBody({ acceptTerms: true });
    await post("/register", without);
    expect(
      await ctx.prisma.user.findUniqueOrThrow({
        where: { email: without.email },
        select: { marketingOptIn: true, marketingOptInAt: true },
      }),
    ).toEqual({ marketingOptIn: false, marketingOptInAt: null });

    const withOptIn = registerBody({ acceptTerms: true, marketingOptIn: true });
    await post("/register", withOptIn);
    const saved = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: withOptIn.email },
      select: { marketingOptIn: true, marketingOptInAt: true },
    });
    expect(saved.marketingOptIn).toBe(true);
    expect(saved.marketingOptInAt).not.toBeNull();
  });

  it("una versión nueva pide aceptar de nuevo, y aceptar deja otra evidencia", async () => {
    const body = registerBody({ acceptTerms: true });
    const registered = await post("/register", body);
    expect(registered.status).toBe(201);
    const userId = authBody(registered).user.id;

    // Se publica otra versión: al iniciar sesión se pide aceptarla antes de seguir.
    const newer = createApp({
      ...ctx.deps,
      env: { ...ctx.deps.env, TERMS_VERSION: "2099-01-01" },
    });
    const login = await request(newer)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", nextIp())
      .send({ email: body.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const account = login.body as { accessToken: string; user: { terms: object } };
    expect(account.user.terms).toEqual({
      currentVersion: "2099-01-01",
      acceptedVersion: ctx.deps.env.TERMS_VERSION,
      required: true,
    });
    const bearer = { Authorization: `Bearer ${account.accessToken}` };

    // Sin casilla marcada, no se acepta.
    const refused = await request(newer)
      .post("/api/v1/auth/accept-terms")
      .set(bearer)
      .send({ acceptTerms: false });
    expect(refused.status).toBe(400);
    expect(await ctx.prisma.termsAcceptance.count({ where: { userId } })).toBe(1);

    const accepted = await request(newer)
      .post("/api/v1/auth/accept-terms")
      .set(bearer)
      .set("User-Agent", "Prueba-Nueva-Version/1.0")
      .send({ acceptTerms: true });
    expect(accepted.status).toBe(204);
    const rows = await ctx.prisma.termsAcceptance.findMany({
      where: { userId },
      orderBy: { acceptedAt: "asc" },
    });
    expect(rows.map((row) => row.version)).toEqual([ctx.deps.env.TERMS_VERSION, "2099-01-01"]);
    expect(rows[1]?.userAgent).toBe("Prueba-Nueva-Version/1.0");

    const me = await request(newer).get("/api/v1/auth/me").set(bearer);
    expect((me.body as { user: { terms: { required: boolean } } }).user.terms.required).toBe(false);
  });

  it("quien nunca aceptó (cuenta anterior) también debe aceptar al iniciar sesión", async () => {
    const email = uniqueEmail("anterior");
    await ctx.prisma.user.create({
      data: {
        email,
        name: "Cuenta anterior",
        passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS),
        emailVerifiedAt: new Date(),
      },
    });
    const login = await post("/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect((login.body as { user: { terms: { required: boolean } } }).user.terms).toMatchObject({
      acceptedVersion: null,
      required: true,
    });
  });
});
