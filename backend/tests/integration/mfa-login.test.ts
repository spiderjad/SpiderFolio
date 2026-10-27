// 2FA, paso 3: login en dos pasos (desafío de un solo uso y 5 minutos), dispositivos de confianza
// (cookie HttpOnly, SameSite=Strict, ruta mínima; se revocan al cerrar todas las sesiones) y bloqueo.
import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createMfaBox } from "../../src/lib/mfa-box.ts";
import { generateTotpSecret, totpAt } from "../../src/lib/totp.ts";
import type { AppDeps } from "../../src/routes.ts";
import { errorOf } from "../http.ts";
import { createTestContext, createUser, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let deps: AppDeps;
let app: ReturnType<typeof createApp>;
const PASSWORD = "una-contraseña-larga-1";

beforeAll(async () => {
  ctx = await createTestContext();
  deps = {
    ...ctx.deps,
    env: {
      ...ctx.deps.env,
      MFA_ENCRYPTION_KEY: ctx.deps.env.MFA_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
    },
  };
  app = createApp(deps);
});

afterAll(async () => {
  await ctx.close();
});

async function person(withMfa: boolean) {
  const user = await createUser(ctx.prisma, "Persona del login");
  const secret = generateTotpSecret();
  await ctx.prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await ctx.deps.passwords.hash(PASSWORD),
      ...(withMfa
        ? {
            totpSecretEnc: createMfaBox(deps.env).encrypt(user.id, secret),
            totpEnabledAt: new Date(),
          }
        : {}),
    },
  });
  return { user, secret };
}

const login = (email: string, cookie?: string) => {
  const call = request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  return cookie === undefined ? call : call.set("Cookie", cookie);
};
const verify = (body: object) => request(app).post("/api/v1/auth/2fa/verify").send(body);

const setCookies = (res: request.Response): string[] => {
  const header = res.headers["set-cookie"] as string[] | string | undefined;
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
};
const cookieNamed = (res: request.Response, name: string) =>
  setCookies(res).find((cookie) => cookie.startsWith(`${name}=`));

describe("login en dos pasos", () => {
  it("sin 2FA el login abre la sesión como siempre", async () => {
    const p = await person(false);
    const res = await login(p.user.email);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
  });

  it("con 2FA la contraseña sola no abre sesión: devuelve un desafío", async () => {
    const p = await person(true);
    const res = await login(p.user.email);
    expect(res.status).toBe(200);
    const body = res.body as { mfaRequired: boolean; challenge: string; accessToken?: string };
    expect(body.mfaRequired).toBe(true);
    expect(body.challenge.length).toBeGreaterThan(20);
    expect(body.accessToken).toBeUndefined();
    expect(cookieNamed(res, "spiderfolio_rt")).toBeUndefined();
    expect(await ctx.prisma.session.count({ where: { userId: p.user.id } })).toBe(0);
  });

  it("el código correcto abre la sesión (con mfaAt) y el desafío no se reutiliza", async () => {
    const p = await person(true);
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    const wrong = await verify({ challenge, code: "000000" });
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong).code).toBe("MFA_INVALID_CODE");
    // El desafío sigue sirviendo tras un código incorrecto.
    const ok = await verify({ challenge, code: totpAt(p.secret, new Date()) });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty("accessToken");
    expect(cookieNamed(ok, "spiderfolio_rt")).toBeDefined();
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: p.user.id } });
    expect(session.mfaAt).not.toBeNull();
    const again = await verify({
      challenge,
      code: totpAt(p.secret, new Date(Date.now() + 30_000)),
    });
    expect(again.status).toBe(400);
    expect(errorOf(again).code).toBe("INVALID_TOKEN");
  });

  it("un desafío vencido o inventado no sirve", async () => {
    const p = await person(true);
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    await ctx.prisma.authToken.updateMany({
      where: { userId: p.user.id, type: "MFA_CHALLENGE" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const code = totpAt(p.secret, new Date());
    expect(errorOf(await verify({ challenge, code })).code).toBe("INVALID_TOKEN");
    expect(errorOf(await verify({ challenge: "x".repeat(43), code })).code).toBe("INVALID_TOKEN");
  });

  it("acepta un código de recuperación", async () => {
    const p = await person(true);
    const { createHash } = await import("node:crypto");
    const recovery = "ABCDE-FGHJK";
    await ctx.prisma.recoveryCode.create({
      data: {
        userId: p.user.id,
        codeHash: createHash("sha256").update("recovery:ABCDEFGHJK").digest("hex"),
      },
    });
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    expect((await verify({ challenge, code: recovery })).status).toBe(200);
  });

  it("5 códigos incorrectos bloquean la cuenta", async () => {
    const p = await person(true);
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect((await verify({ challenge, code: "000000" })).status).toBe(400);
    }
    expect((await verify({ challenge, code: "000000" })).status).toBe(429);
    expect((await verify({ challenge, code: totpAt(p.secret, new Date()) })).status).toBe(429);
  });
});

describe("dispositivo de confianza", () => {
  it("con «Recordar» la cookie es HttpOnly, Strict, de ruta mínima, y salta el código", async () => {
    const p = await person(true);
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    const ok = await verify({ challenge, code: totpAt(p.secret, new Date()), remember: true });
    const cookie = cookieNamed(ok, "spiderfolio_td");
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=Strict/iu);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/login/iu);
    const stored = await ctx.prisma.trustedDevice.findFirstOrThrow({
      where: { userId: p.user.id },
    });
    const token = (cookie ?? "").split(";")[0] ?? "";
    expect(token).not.toContain(stored.tokenHash);

    const direct = await login(p.user.email, token);
    expect(direct.status).toBe(200);
    expect(direct.body).toHaveProperty("accessToken");
  });

  it("no sirve para otra cuenta y se revoca al cerrar todas las sesiones", async () => {
    const p = await person(true);
    const other = await person(true);
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    const ok = await verify({ challenge, code: totpAt(p.secret, new Date()), remember: true });
    const token = (cookieNamed(ok, "spiderfolio_td") ?? "").split(";")[0] ?? "";
    expect(
      ((await login(other.user.email, token)).body as { mfaRequired?: boolean }).mfaRequired,
    ).toBe(true);

    const access = (ok.body as { accessToken: string }).accessToken;
    expect(
      (await request(app).post("/api/v1/auth/logout-all").set("Authorization", `Bearer ${access}`))
        .status,
    ).toBe(204);
    expect(await ctx.prisma.trustedDevice.count({ where: { userId: p.user.id } })).toBe(0);
    expect(((await login(p.user.email, token)).body as { mfaRequired?: boolean }).mfaRequired).toBe(
      true,
    );
  });

  it("uno vencido no salta el código", async () => {
    const p = await person(true);
    const { challenge } = (await login(p.user.email)).body as { challenge: string };
    const ok = await verify({ challenge, code: totpAt(p.secret, new Date()), remember: true });
    const token = (cookieNamed(ok, "spiderfolio_td") ?? "").split(";")[0] ?? "";
    await ctx.prisma.trustedDevice.updateMany({
      where: { userId: p.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(((await login(p.user.email, token)).body as { mfaRequired?: boolean }).mfaRequired).toBe(
      true,
    );
  });
});
