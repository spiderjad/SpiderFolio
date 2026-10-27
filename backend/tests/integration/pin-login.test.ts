// Ingreso de lectores de planta con usuario + PIN (CLAUDE.md, sección 7.6) por HTTP.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import type { Passwords } from "../../src/modules/auth/passwords.ts";
import { createPinMember, resetPin } from "../../src/modules/pin/pin.service.ts";
import { KIOSK_MAX_AGE_MS, MAX_PIN_FAILURES } from "../../src/modules/pin/pin-rules.ts";
import { bodyOf, errorOf } from "../http.ts";
import {
  createTestContext,
  createWorkspace,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";

const ORIGIN = "http://localhost:5173";
const GOOD_PIN = "482915";
const OTHER_PIN = "739104";
const MINUTE = 60_000;

let ctx: TestContext;
let app: ReturnType<typeof createApp>;
/** Verificaciones de argon2 hechas (verify + verifyDummy), para el test de tiempos. */
let verifications = 0;

// Cada request usa su propia IP: los límites por IP no se pisan entre tests.
let ipCounter = 0;
const nextIp = () => {
  ipCounter++;
  return `198.19.${String(Math.floor(ipCounter / 250))}.${String((ipCounter % 250) + 1)}`;
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
});

afterAll(async () => {
  await ctx.close();
});

const pinLogin = (body: object) =>
  request(app).post("/api/v1/auth/pin-login").set("X-Forwarded-For", nextIp()).send(body);

interface PinAuthBody {
  accessToken: string;
  expiresIn: number;
  user: { id: string; kind: string; email: string | null; emailVerified: boolean };
  memberships: { workspace: { slug: string }; role: { base: string }; seatType: string }[];
}
const authBody = (res: { body: unknown }) => res.body as PinAuthBody;

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const cookies = (res.headers["set-cookie"] as string[] | undefined) ?? [];
  const cookie = cookies.find((c) => c.startsWith("spiderfolio_rt="));
  if (cookie === undefined) throw new Error("Sin cookie spiderfolio_rt");
  return cookie.split(";")[0] ?? "";
}

const refresh = (cookie: string) =>
  request(app)
    .post("/api/v1/auth/refresh")
    .set("Cookie", cookie)
    .set("X-Requested-With", "spiderfolio")
    .set("Origin", ORIGIN)
    .send();

async function memberRoleId(ws: TestWorkspace): Promise<string> {
  const role = await ctx.prisma.role.findFirstOrThrow({
    where: {
      workspaceId: ws.workspaceId,
      base: "MEMBER",
      isSystem: true,
      NOT: { name: "Jefe de departamento" },
    },
  });
  return role.id;
}

async function setPinSettings(
  ws: TestWorkspace,
  pinLogin: { enabled: boolean; idleMinutes?: number },
): Promise<void> {
  await ctx.prisma.workspace.update({
    where: { id: ws.workspaceId },
    data: { settings: { timezone: "Europe/Madrid", locale: "es", pinLogin } },
  });
}

/** Workspace con el ingreso por PIN activado y una persona con PIN. */
async function setup(name: string, loginName = "operario1", pin = GOOD_PIN) {
  const ws = await createWorkspace(ctx, name);
  await setPinSettings(ws, { enabled: true, idleMinutes: 5 });
  const member = await createPinMember(ctx.deps, {
    workspaceId: ws.workspaceId,
    actorUserId: ws.owner.id,
    name: "Operario Uno",
    loginName,
    roleId: await memberRoleId(ws),
    pin,
  });
  return { ws, member };
}

const credentialOf = (membershipId: string) =>
  ctx.prisma.pinLogin.findUniqueOrThrow({ where: { membershipId } });

describe("ingreso con usuario + PIN", () => {
  it("devuelve cookie, sesión corta y una cuenta sin email, y entra al workspace", async () => {
    const { ws, member } = await setup("PIN ingreso");
    const before = Date.now();
    const res = await pinLogin({ workspaceSlug: ws.slug, loginName: " Operario1 ", pin: GOOD_PIN });
    expect(res.status).toBe(200);
    const body = authBody(res);
    expect(body.user).toMatchObject({ id: member.userId, kind: "PIN", email: null });
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]).toMatchObject({
      workspace: { slug: ws.slug },
      role: { base: "MEMBER" },
      seatType: "READER",
    });
    // Access token con el lapso de inactividad (5 min), no con los 15 de una sesión normal.
    expect(body.expiresIn).toBe(300);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: member.userId } });
    expect(session.idleSeconds).toBe(300);
    expect(session.expiresAt.getTime()).toBeGreaterThan(before + 4 * MINUTE);
    expect(session.expiresAt.getTime()).toBeLessThan(Date.now() + 5 * MINUTE + 5_000);

    const tenant = await request(app)
      .get(`/api/v1/w/${ws.slug}/`)
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect(tenant.status).toBe(200);
    expect(bodyOf(tenant).membership.capabilities).toEqual([]);

    // Sin contraseña: no puede cambiarla.
    const change = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({ currentPassword: GOOD_PIN, newPassword: "una-clave-bien-larga" });
    expect(change.status).toBe(401);
    expect(errorOf(change).code).toBe("INVALID_CREDENTIALS");
  });

  it("al renovar mantiene el lapso corto y respeta el tope absoluto de 8 horas", async () => {
    const { ws, member } = await setup("PIN refresh");
    const res = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN });
    const renewed = await refresh(cookieOf(res));
    expect(renewed.status).toBe(200);
    expect((renewed.body as { expiresIn: number }).expiresIn).toBe(300);
    const sessions = await ctx.prisma.session.findMany({
      where: { userId: member.userId, revokedAt: null },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.idleSeconds).toBe(300);

    // Una familia de más de 8 horas ya no se renueva, aunque se haya usado hace un momento.
    await ctx.prisma.session.updateMany({
      where: { userId: member.userId },
      data: { familyCreatedAt: new Date(Date.now() - KIOSK_MAX_AGE_MS - MINUTE) },
    });
    const cookie = (renewed.headers["set-cookie"] as string[] | undefined)?.[0]?.split(";")[0];
    expect((await refresh(cookie ?? "")).status).toBe(401);
  });

  it("sin uso por más del lapso configurado, la sesión no se puede renovar", async () => {
    const { ws, member } = await setup("PIN inactividad");
    const res = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN });
    await ctx.prisma.session.updateMany({
      where: { userId: member.userId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await refresh(cookieOf(res))).status).toBe(401);
  });

  it("usa el lapso de inactividad del workspace", async () => {
    const { ws } = await setup("PIN lapso");
    await setPinSettings(ws, { enabled: true, idleMinutes: 2 });
    const res = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN });
    expect(authBody(res).expiresIn).toBe(120);
  });
});

describe("error único", () => {
  it("el mismo error y el mismo trabajo en todos los fallos", async () => {
    const { ws, member } = await setup("PIN error único");
    const off = await createWorkspace(ctx, "PIN apagado");
    await setPinSettings(off, { enabled: false });
    await createPinMember(ctx.deps, {
      workspaceId: off.workspaceId,
      actorUserId: off.owner.id,
      name: "Apagado",
      loginName: "operario1",
      roleId: await memberRoleId(off),
      pin: GOOD_PIN,
    });
    const suspended = await setup("PIN suspendido");
    await ctx.prisma.membership.update({
      where: { id: suspended.member.membershipId },
      data: { status: "SUSPENDED" },
    });

    const cases = [
      { workspaceSlug: "no-existe-este-workspace", loginName: "operario1", pin: GOOD_PIN },
      { workspaceSlug: off.slug, loginName: "operario1", pin: GOOD_PIN },
      { workspaceSlug: ws.slug, loginName: "nadie", pin: GOOD_PIN },
      { workspaceSlug: ws.slug, loginName: "operario1", pin: OTHER_PIN },
      { workspaceSlug: suspended.ws.slug, loginName: "operario1", pin: GOOD_PIN },
    ];
    const seen: { code: string; message: string; verified: number }[] = [];
    for (const body of cases) {
      const before = verifications;
      const res = await pinLogin(body);
      expect(res.status).toBe(401);
      seen.push({
        code: errorOf(res).code,
        message: errorOf(res).message,
        verified: verifications - before,
      });
    }
    expect(new Set(seen.map((s) => `${s.code}|${s.message}`)).size).toBe(1);
    expect(seen[0]).toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Usuario o PIN incorrectos.",
    });
    // Siempre una verificación de argon2, exista o no el usuario.
    expect(seen.map((s) => s.verified)).toEqual([1, 1, 1, 1, 1]);
    expect(member.membershipId).toBeDefined();
  });

  it("valida el cuerpo con Zod sin repetir valores", async () => {
    const { ws } = await setup("PIN validación");
    for (const body of [
      { workspaceSlug: ws.slug, loginName: "operario1", pin: "12345" },
      { workspaceSlug: ws.slug, loginName: "operario1", pin: "12345a" },
      { workspaceSlug: ws.slug, loginName: "operario1" },
      { workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN, extra: true },
    ]) {
      const res = await pinLogin(body);
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(res.body)).not.toContain("12345a");
    }
  });
});

describe("bloqueo", () => {
  it("bloquea tras 5 fallos, no deja entrar ni con el PIN correcto y duplica el tiempo", async () => {
    const { ws, member } = await setup("PIN bloqueo");
    const attempt = (pin: string) =>
      pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin });
    for (let i = 0; i < MAX_PIN_FAILURES; i++) expect((await attempt(OTHER_PIN)).status).toBe(401);

    let credential = await credentialOf(member.membershipId);
    expect(credential.lockCount).toBe(1);
    expect(credential.failedAttempts).toBe(0);
    const firstLock = (credential.lockedUntil?.getTime() ?? 0) - Date.now();
    expect(firstLock).toBeGreaterThan(14 * MINUTE);
    expect(firstLock).toBeLessThanOrEqual(15 * MINUTE);
    // Bloqueado: ni con el PIN correcto.
    expect((await attempt(GOOD_PIN)).status).toBe(401);

    // Vence el primer bloqueo; 5 fallos más y el segundo dura el doble.
    await ctx.prisma.pinLogin.update({
      where: { id: credential.id },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    for (let i = 0; i < MAX_PIN_FAILURES; i++) expect((await attempt(OTHER_PIN)).status).toBe(401);
    credential = await credentialOf(member.membershipId);
    expect(credential.lockCount).toBe(2);
    const secondLock = (credential.lockedUntil?.getTime() ?? 0) - Date.now();
    expect(secondLock).toBeGreaterThan(29 * MINUTE);
    expect(secondLock).toBeLessThanOrEqual(30 * MINUTE);

    const events = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: ws.workspaceId, action: "pin.login.locked" },
    });
    expect(events).toHaveLength(2);
  });

  it("un ingreso correcto reinicia los contadores", async () => {
    const { ws, member } = await setup("PIN reinicio");
    for (let i = 0; i < 3; i++) {
      await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: OTHER_PIN });
    }
    expect((await credentialOf(member.membershipId)).failedAttempts).toBe(3);
    const ok = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN });
    expect(ok.status).toBe(200);
    expect(await credentialOf(member.membershipId)).toMatchObject({
      failedAttempts: 0,
      lockCount: 0,
      lockedUntil: null,
    });
  });

  it("el bloqueo es de esa persona: otra del mismo workspace sigue entrando", async () => {
    const { ws, member } = await setup("PIN bloqueo ajeno");
    const other = await createPinMember(ctx.deps, {
      workspaceId: ws.workspaceId,
      actorUserId: ws.owner.id,
      name: "Operario Dos",
      loginName: "operario2",
      roleId: await memberRoleId(ws),
      pin: OTHER_PIN,
    });
    for (let i = 0; i < MAX_PIN_FAILURES; i++) {
      await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: "000111" });
    }
    expect((await credentialOf(member.membershipId)).lockedUntil).not.toBeNull();
    const res = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario2", pin: OTHER_PIN });
    expect(res.status).toBe(200);
    expect(authBody(res).user.id).toBe(other.userId);
  });

  it("tiene un límite por usuario aparte del bloqueo", async () => {
    const { ws } = await setup("PIN límite");
    let last = 0;
    for (let i = 0; i < 14; i++) {
      // Pin con otro formato válido pero sin bloqueo acumulado en otra cuenta inexistente.
      last = (await pinLogin({ workspaceSlug: ws.slug, loginName: "fantasma", pin: OTHER_PIN }))
        .status;
    }
    expect(last).toBe(429);
  });
});

describe("reset del PIN", () => {
  it("el PIN viejo deja de servir, se desbloquea y se cierran las sesiones", async () => {
    const { ws, member } = await setup("PIN reset");
    const first = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN });
    const token = authBody(first).accessToken;
    await ctx.prisma.pinLogin.update({
      where: { membershipId: member.membershipId },
      data: { failedAttempts: 3, lockCount: 1, lockedUntil: new Date(Date.now() + 10 * MINUTE) },
    });

    const reset = await resetPin(ctx.deps, {
      workspaceId: ws.workspaceId,
      actorUserId: ws.owner.id,
      membershipId: member.membershipId,
      pin: OTHER_PIN,
    });
    expect(reset).toEqual({ loginName: "operario1", pin: OTHER_PIN });

    // La sesión abierta ya no sirve.
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(
      (await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: GOOD_PIN })).status,
    ).toBe(401);
    expect(
      (await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: OTHER_PIN })).status,
    ).toBe(200);

    const credential = await credentialOf(member.membershipId);
    expect(credential.pinChangedById).toBe(ws.owner.id);
    const event = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, action: "pin.reset" },
    });
    expect(event.actorId).toBe(ws.owner.id);
    expect(JSON.stringify(event.metadata)).not.toContain(OTHER_PIN);
  });

  it("sin PIN, genera uno aleatorio que sirve para entrar", async () => {
    const { ws, member } = await setup("PIN reset aleatorio");
    const reset = await resetPin(ctx.deps, {
      workspaceId: ws.workspaceId,
      actorUserId: ws.owner.id,
      membershipId: member.membershipId,
    });
    expect(reset.pin).toMatch(/^\d{6}$/);
    expect(
      (await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: reset.pin })).status,
    ).toBe(200);
  });

  it("no resetea a quien no entra con PIN ni a una persona de otro workspace", async () => {
    const { ws } = await setup("PIN reset límites");
    await expect(
      resetPin(ctx.deps, {
        workspaceId: ws.workspaceId,
        actorUserId: ws.owner.id,
        membershipId: ws.membershipId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const other = await setup("PIN reset otro");
    await expect(
      resetPin(ctx.deps, {
        workspaceId: ws.workspaceId,
        actorUserId: ws.owner.id,
        membershipId: other.member.membershipId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // El PIN de la otra persona no cambió.
    expect(
      (await pinLogin({ workspaceSlug: other.ws.slug, loginName: "operario1", pin: GOOD_PIN }))
        .status,
    ).toBe(200);
  });
});

describe("aislamiento entre workspaces", () => {
  it("el mismo usuario puede existir en dos workspaces y cada PIN solo abre el suyo", async () => {
    const a = await setup("PIN aislamiento A", "operario1", GOOD_PIN);
    const b = await setup("PIN aislamiento B", "operario1", OTHER_PIN);
    expect(
      (await pinLogin({ workspaceSlug: a.ws.slug, loginName: "operario1", pin: GOOD_PIN })).status,
    ).toBe(200);
    expect(
      (await pinLogin({ workspaceSlug: b.ws.slug, loginName: "operario1", pin: GOOD_PIN })).status,
    ).toBe(401);
    const res = await pinLogin({
      workspaceSlug: b.ws.slug,
      loginName: "operario1",
      pin: OTHER_PIN,
    });
    expect(res.status).toBe(200);
    expect(authBody(res).memberships.map((m) => m.workspace.slug)).toEqual([b.ws.slug]);

    // Con la sesión de A no se entra al workspace B.
    const sessionA = await pinLogin({
      workspaceSlug: a.ws.slug,
      loginName: "operario1",
      pin: GOOD_PIN,
    });
    const denied = await request(app)
      .get(`/api/v1/w/${b.ws.slug}/`)
      .set("Authorization", `Bearer ${authBody(sessionA).accessToken}`);
    expect(denied.status).toBe(404);
  });
});

describe("crear personas con PIN", () => {
  it("solo con rol de miembro sin capacidades, PIN fuerte y usuario válido y libre", async () => {
    const ws = await createWorkspace(ctx, "PIN crear");
    const admin = await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: ws.workspaceId,
        base: "ADMIN",
        isSystem: true,
        NOT: { name: "Jefe de departamento" },
      },
    });
    const withCapability = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Con capacidad",
        base: "MEMBER",
        capabilities: ["audit.view"],
      },
    });
    const roleId = await memberRoleId(ws);
    const base = {
      workspaceId: ws.workspaceId,
      actorUserId: ws.owner.id,
      name: "Persona",
      loginName: "persona1",
      roleId,
    };
    for (const badRole of [admin.id, withCapability.id]) {
      await expect(createPinMember(ctx.deps, { ...base, roleId: badRole })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    await expect(createPinMember(ctx.deps, { ...base, pin: "123456" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    for (const loginName of ["ab", "con espacio", "ñandú"]) {
      await expect(createPinMember(ctx.deps, { ...base, loginName })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    await expect(createPinMember(ctx.deps, { ...base, roleId: "no-existe" })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    // Nada de lo anterior dejó personas a medias.
    expect(await ctx.prisma.pinLogin.count({ where: { workspaceId: ws.workspaceId } })).toBe(0);

    const created = await createPinMember(ctx.deps, { ...base, loginName: " Persona1 " });
    expect(created.loginName).toBe("persona1");
    expect(created.pin).toMatch(/^\d{6}$/);
    await expect(createPinMember(ctx.deps, base)).rejects.toMatchObject({ code: "CONFLICT" });

    const membership = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: created.membershipId },
      include: { user: true },
    });
    expect(membership).toMatchObject({ seatType: "READER", status: "ACTIVE" });
    expect(membership.user).toMatchObject({ kind: "PIN", email: null, passwordHash: null });
    // El PIN no se guarda en claro.
    const credential = await credentialOf(created.membershipId);
    expect(credential.pinHash).not.toContain(created.pin);
    const event = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, action: "pin.create" },
    });
    expect(JSON.stringify(event.metadata)).not.toContain(created.pin);
  });

  it("no tiene límite de lectores y respeta los departamentos del workspace", async () => {
    const ws = await createWorkspace(ctx, "PIN plazas");
    const department = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Planta" },
    });
    const foreign = await createWorkspace(ctx, "PIN plazas ajeno");
    const foreignDepartment = await ctx.prisma.department.create({
      data: { workspaceId: foreign.workspaceId, name: "Ajeno" },
    });
    const roleId = await memberRoleId(ws);
    const base = { workspaceId: ws.workspaceId, actorUserId: ws.owner.id, name: "P", roleId };

    const first = await createPinMember(ctx.deps, {
      ...base,
      loginName: "uno.uno",
      departmentIds: [department.id, foreignDepartment.id],
    });
    // El departamento de otro workspace se ignora.
    const memberships = await ctx.prisma.departmentMember.findMany({
      where: { membershipId: first.membershipId },
    });
    expect(memberships.map((m) => m.departmentId)).toEqual([department.id]);

    await createPinMember(ctx.deps, { ...base, loginName: "dos.dos" });
    expect(await ctx.prisma.pinLogin.count({ where: { workspaceId: ws.workspaceId } })).toBe(2);
  });

  it("la base impide un usuario de PIN con email o uno estándar sin email", async () => {
    await expect(
      ctx.prisma.user.create({ data: { kind: "PIN", name: "X", email: "x@test.local" } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.user.create({ data: { kind: "STANDARD", name: "X", passwordHash: "h" } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.user.create({ data: { kind: "STANDARD", name: "X" } }),
    ).rejects.toThrow();
  });
});
