// 2FA, paso 2: alta con QR y código, códigos de recuperación (hash, un solo uso), confirmación
// reciente, bloqueo, desactivación con contraseña y código, cuentas de PIN fuera y servidor sin clave.
import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { totpAt } from "../../src/lib/totp.ts";
import { createSession, rotateSession } from "../../src/modules/auth/sessions.service.ts";
import type { AppDeps } from "../../src/routes.ts";
import { errorOf } from "../http.ts";
import { createTestContext, createUser, loginAs, type TestContext } from "./helpers.ts";

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

const call = (token: string, path: string, body?: object, method: "get" | "post" = "post") =>
  request(app)[method](`/api/v1/auth${path}`).set("Authorization", `Bearer ${token}`).send(body);

async function person() {
  const user = await createUser(ctx.prisma, "Persona con 2FA");
  await ctx.prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await ctx.deps.passwords.hash(PASSWORD) },
  });
  const token = await loginAs(ctx, user.id);
  return { user, token };
}

/** Activa la 2FA y devuelve el secreto y los códigos de recuperación. */
async function enabled() {
  const p = await person();
  const setup = await call(p.token, "/2fa/setup");
  expect(setup.status).toBe(200);
  const { secret } = setup.body as { secret: string };
  const res = await call(p.token, "/2fa/enable", { code: totpAt(secret, new Date()) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { ...p, secret, codes: (res.body as { recoveryCodes: string[] }).recoveryCodes };
}

/** Un código válido del paso siguiente (el actual ya se usó al activar). */
const nextCode = (secret: string) => totpAt(secret, new Date(Date.now() + 30_000));

const forgetRecentConfirmation = (userId: string) =>
  ctx.prisma.session.updateMany({
    where: { userId },
    data: { mfaAt: new Date(Date.now() - 11 * 60_000) },
  });

describe("alta", () => {
  it("con QR y código: guarda el secreto cifrado y solo el hash de los códigos", async () => {
    const p = await person();
    expect((await call(p.token, "/2fa", undefined, "get")).body).toMatchObject({
      enabled: false,
      available: true,
    });
    const setup = await call(p.token, "/2fa/setup");
    const body = setup.body as { secret: string; otpauthUri: string; qr: string };
    expect(body.otpauthUri).toContain(`secret=${body.secret}`);
    expect(body.qr.startsWith("data:image/png;base64,")).toBe(true);
    // Un código incorrecto no activa nada.
    const wrong = await call(p.token, "/2fa/enable", { code: "000000" });
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong).code).toBe("MFA_INVALID_CODE");

    const ok = await call(p.token, "/2fa/enable", { code: totpAt(body.secret, new Date()) });
    expect(ok.status).toBe(200);
    const codes = (ok.body as { recoveryCodes: string[] }).recoveryCodes;
    expect(codes).toHaveLength(10);

    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    expect(stored.totpEnabledAt).not.toBeNull();
    expect(stored.totpSecretEnc?.startsWith("k1:")).toBe(true);
    expect(stored.totpSecretEnc).not.toContain(body.secret);
    const hashes = await ctx.prisma.recoveryCode.findMany({ where: { userId: p.user.id } });
    expect(hashes).toHaveLength(10);
    for (const row of hashes) expect(codes).not.toContain(row.codeHash);
    expect(
      await ctx.prisma.auditLog.count({ where: { actorId: p.user.id, action: "auth.2fa.enable" } }),
    ).toBe(1);
    const me = (await call(p.token, "/me", undefined, "get")).body as {
      user: { twoFactor: boolean };
    };
    expect(me.user.twoFactor).toBe(true);
    // No se puede volver a empezar el alta con la 2FA activa.
    expect((await call(p.token, "/2fa/setup")).status).toBe(409);
  });

  it("las cuentas de PIN quedan fuera", async () => {
    const pin = await ctx.prisma.user.create({ data: { kind: "PIN", name: "Tablet" } });
    const token = await loginAs(ctx, pin.id);
    expect((await call(token, "/2fa/setup")).status).toBe(403);
    expect(
      ((await call(token, "/2fa", undefined, "get")).body as { available: boolean }).available,
    ).toBe(false);
  });

  it("sin MFA_ENCRYPTION_KEY la 2FA no está disponible", async () => {
    const bare = createApp({ ...deps, env: { ...deps.env, MFA_ENCRYPTION_KEY: undefined } });
    const p = await person();
    const res = await request(bare)
      .post("/api/v1/auth/2fa/setup")
      .set("Authorization", `Bearer ${p.token}`);
    expect(res.status).toBe(503);
  });
});

describe("códigos", () => {
  it("un código de la app no se reutiliza", async () => {
    const p = await enabled();
    const same = totpAt(p.secret, new Date());
    expect((await call(p.token, "/2fa/confirm", { code: same })).status).toBe(400);
    expect((await call(p.token, "/2fa/confirm", { code: nextCode(p.secret) })).status).toBe(200);
  });

  it("un código de recuperación vale una sola vez", async () => {
    const p = await enabled();
    const [first] = p.codes;
    expect((await call(p.token, "/2fa/confirm", { code: first })).status).toBe(200);
    expect((await call(p.token, "/2fa/confirm", { code: first })).status).toBe(400);
    const status = (await call(p.token, "/2fa", undefined, "get")).body as {
      recoveryCodesLeft: number;
    };
    expect(status.recoveryCodesLeft).toBe(9);
  });

  it("5 códigos incorrectos bloquean 15 minutos, aunque después venga el correcto", async () => {
    const p = await enabled();
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect((await call(p.token, "/2fa/confirm", { code: "000000" })).status).toBe(400);
    }
    const locked = await call(p.token, "/2fa/confirm", { code: "000000" });
    expect(locked.status).toBe(429);
    expect((await call(p.token, "/2fa/confirm", { code: nextCode(p.secret) })).status).toBe(429);
    expect(
      await ctx.prisma.auditLog.count({ where: { actorId: p.user.id, action: "auth.2fa.locked" } }),
    ).toBe(1);
  });
});

describe("acciones sensibles", () => {
  it("regenerar códigos pide confirmación reciente y anula los anteriores", async () => {
    const p = await enabled();
    await forgetRecentConfirmation(p.user.id);
    const stale = await call(p.token, "/2fa/recovery-codes");
    expect(stale.status).toBe(403);
    expect(errorOf(stale).code).toBe("MFA_RECENT_REQUIRED");
    expect((await call(p.token, "/2fa/confirm", { code: nextCode(p.secret) })).status).toBe(200);
    const fresh = await call(p.token, "/2fa/recovery-codes");
    expect(fresh.status).toBe(200);
    const [old] = p.codes;
    expect((await call(p.token, "/2fa/confirm", { code: old })).status).toBe(400);
    const [renewed] = (fresh.body as { recoveryCodes: string[] }).recoveryCodes;
    expect((await call(p.token, "/2fa/confirm", { code: renewed })).status).toBe(200);
  });

  it("desactivar pide la contraseña y un código; borra códigos y dispositivos", async () => {
    const p = await enabled();
    await ctx.prisma.trustedDevice.create({
      data: {
        userId: p.user.id,
        tokenHash: randomBytes(16).toString("hex"),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const badPassword = await call(p.token, "/2fa/disable", {
      password: "otra-contraseña",
      code: nextCode(p.secret),
    });
    expect(badPassword.status).toBe(401);
    const [recovery] = p.codes;
    expect(
      (await call(p.token, "/2fa/disable", { password: PASSWORD, code: "000000" })).status,
    ).toBe(400);
    const ok = await call(p.token, "/2fa/disable", { password: PASSWORD, code: recovery });
    expect(ok.status).toBe(204);
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    expect(stored.totpEnabledAt).toBeNull();
    expect(stored.totpSecretEnc).toBeNull();
    expect(await ctx.prisma.recoveryCode.count({ where: { userId: p.user.id } })).toBe(0);
    expect(await ctx.prisma.trustedDevice.count({ where: { userId: p.user.id } })).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({
        where: { actorId: p.user.id, action: "auth.2fa.disable" },
      }),
    ).toBe(1);
  });

  it("la confirmación reciente se conserva al renovar la sesión", async () => {
    const p = await person();
    const policy = { refreshTtlDays: 30, maxAgeDays: 90 };
    const info = { ip: null, userAgent: null };
    const issued = await createSession(ctx.prisma, p.user.id, info, policy);
    const mfaAt = new Date();
    await ctx.prisma.session.update({ where: { id: issued.sessionId }, data: { mfaAt } });
    const rotated = await rotateSession(ctx.prisma, issued.refreshToken, info, policy);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    const next = await ctx.prisma.session.findUniqueOrThrow({
      where: { id: rotated.session.sessionId },
    });
    expect(next.mfaAt?.getTime()).toBe(mfaAt.getTime());
  });
});
