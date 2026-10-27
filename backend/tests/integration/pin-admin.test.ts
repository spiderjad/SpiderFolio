// Panel del ingreso con usuario + PIN (CLAUDE.md, sección 7.6): crear, resetear y ajustes.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { MAX_PIN_FAILURES } from "../../src/modules/pin/pin-rules.ts";
import { errorOf } from "../http.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import type { TestWorkspace } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const api = (ws: Pick<TestWorkspace, "slug">, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${ws.slug}${path}`).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  patch: (path: string, body?: object) =>
    request(app)
      .patch(`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
});

let ipCounter = 0;
const pinLogin = (body: object) =>
  request(app)
    .post("/api/v1/auth/pin-login")
    .set(
      "X-Forwarded-For",
      `198.20.${String(Math.floor(++ipCounter / 250))}.${String((ipCounter % 250) + 1)}`,
    )
    .send(body);

interface MemberBody {
  id: string;
  name: string;
  email: string | null;
  kind: string;
  loginName: string | null;
  pinLocked: boolean;
  seatType: string;
}
interface CreatedBody {
  member: MemberBody;
  pin: string;
}

async function memberRoleId(ws: TestWorkspace) {
  return (
    await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: ws.workspaceId,
        base: "MEMBER",
        isSystem: true,
        NOT: { name: "Jefe de departamento" },
      },
    })
  ).id;
}

async function setup(label: string) {
  const ws = await createWorkspace(ctx, label);
  const owner = api(ws, ws.token);
  const roleId = await memberRoleId(ws);
  const create = (body: object = {}) =>
    owner.post("/admin/members/pin", {
      name: "Operario Uno",
      loginName: "operario1",
      roleId,
      ...body,
    });
  return { ws, owner, roleId, create };
}

describe("crear personas con PIN desde el panel", () => {
  it("crea a la persona, devuelve el PIN una sola vez y entra con él", async () => {
    const { ws, owner, create } = await setup("PIN panel crear");
    await owner.patch("/admin/members/pin-settings", { enabled: true });
    const res = await create();
    expect(res.status).toBe(201);
    const body = res.body as CreatedBody;
    expect(body.pin).toMatch(/^\d{6}$/);
    expect(body.member).toMatchObject({
      name: "Operario Uno",
      email: null,
      kind: "PIN",
      loginName: "operario1",
      pinLocked: false,
      seatType: "READER",
    });
    const login = await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: body.pin });
    expect(login.status).toBe(200);
    // El PIN no se puede volver a consultar: la lista de miembros no lo trae.
    const list = await owner.get("/admin/members?pageSize=100");
    expect(JSON.stringify(list.body)).not.toContain(body.pin);
  });

  it("acepta un PIN elegido, pero no uno débil, y valida usuario, rol y repetidos", async () => {
    const { ws, create } = await setup("PIN panel validar");
    expect((await create({ pin: "123456" })).status).toBe(400);
    expect((await create({ loginName: "a" })).status).toBe(400);
    expect((await create({ loginName: "con espacio" })).status).toBe(400);
    expect((await create({ unknown: true })).status).toBe(400);
    const chosen = await create({ pin: "482915" });
    expect(chosen.status).toBe(201);
    expect((chosen.body as CreatedBody).pin).toBe("482915");
    const repeated = await create();
    expect(repeated.status).toBe(409);
    expect(errorOf(repeated).code).toBe("CONFLICT");

    const admin = await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: ws.workspaceId,
        base: "ADMIN",
        isSystem: true,
        NOT: { name: "Jefe de departamento" },
      },
    });
    expect((await create({ loginName: "otro.usuario", roleId: admin.id })).status).toBe(400);
  });

  it("exige members.pin y no tiene límite de lectores", async () => {
    const { ws, create } = await setup("PIN panel permisos");
    const manager = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Gestor",
        base: "MEMBER",
        capabilities: ["members.manage", "members.invite", "members.view"],
      },
    });
    const person = await addMember(ctx, ws, { roleId: manager.id });
    const roleId = await memberRoleId(ws);
    const denied = await api(ws, person.token).post("/admin/members/pin", {
      name: "Otro",
      loginName: "otro.op",
      roleId,
    });
    expect(denied.status).toBe(403);
    expect((await api(ws, person.token).get("/admin/members/pin-settings")).status).toBe(403);

    // Sin límite de plazas de lector.
    expect((await create()).status).toBe(201);
    expect((await create({ loginName: "operario2" })).status).toBe(201);
  });

  it("también cuenta como plaza de lector en el resumen y sale en el CSV con su usuario", async () => {
    const { owner, create } = await setup("PIN panel lista");
    await create();
    const summary = (await owner.get("/admin/members/summary")).body as Record<string, number>;
    expect(summary).toMatchObject({ readers: 1, total: 2 });
    const exported = (await owner.get("/admin/members/export")).body as { csv: string };
    expect(exported.csv).toContain("Usuario");
    expect(exported.csv).toContain("operario1");
  });
});

describe("resetear el PIN", () => {
  it("devuelve un PIN nuevo, desbloquea y cierra las sesiones", async () => {
    const { ws, owner, create } = await setup("PIN panel reset");
    await owner.patch("/admin/members/pin-settings", { enabled: true });
    const created = (await create({ pin: "482915" })).body as CreatedBody;
    const first = await pinLogin({
      workspaceSlug: ws.slug,
      loginName: "operario1",
      pin: "482915",
    });
    const token = (first.body as { accessToken: string }).accessToken;
    for (let i = 0; i < MAX_PIN_FAILURES; i++) {
      await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: "000111" });
    }
    const locked = (await owner.get("/admin/members?group=readers")).body as {
      items: MemberBody[];
    };
    expect(locked.items.find((m) => m.id === created.member.id)?.pinLocked).toBe(true);

    const reset = await owner.post(`/admin/members/${created.member.id}/pin/reset`, {});
    expect(reset.status).toBe(200);
    const body = reset.body as { pin: string; loginName: string; member: MemberBody };
    expect(body.pin).toMatch(/^\d{6}$/);
    expect(body.loginName).toBe("operario1");
    expect(body.member.pinLocked).toBe(false);
    // La sesión abierta ya no sirve y el PIN nuevo entra.
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(
      (await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: body.pin })).status,
    ).toBe(200);
    expect(
      (await pinLogin({ workspaceSlug: ws.slug, loginName: "operario1", pin: "482915" })).status,
    ).toBe(401);
  });

  it("solo a personas con PIN, y con members.pin", async () => {
    const { ws, owner, create } = await setup("PIN panel reset permisos");
    const created = (await create()).body as CreatedBody;
    const plain = await addMember(ctx, ws);
    expect((await owner.post(`/admin/members/${plain.membership.id}/pin/reset`, {})).status).toBe(
      400,
    );
    expect(
      (await api(ws, plain.token).post(`/admin/members/${created.member.id}/pin/reset`, {})).status,
    ).toBe(403);
    expect((await owner.post("/admin/members/no-existe/pin/reset", {})).status).toBe(404);
  });
});

describe("ajustes del ingreso con PIN", () => {
  it("por defecto está apagado; se cambian de a uno y quedan en la auditoría", async () => {
    const { ws, owner } = await setup("PIN panel ajustes");
    expect((await owner.get("/admin/members/pin-settings")).body).toEqual({
      settings: { enabled: false, idleMinutes: 5, closeAfterConfirm: true },
    });
    const res = await owner.patch("/admin/members/pin-settings", {
      enabled: true,
      idleMinutes: 2,
    });
    expect(res.body).toEqual({
      settings: { enabled: true, idleMinutes: 2, closeAfterConfirm: true },
    });
    // Los demás ajustes del workspace se conservan.
    const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: ws.workspaceId },
    });
    expect(workspace.settings).toMatchObject({ timezone: "Europe/Madrid", locale: "es" });
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "pin.settings.update" },
      }),
    ).toBe(1);
    for (const bad of [{}, { idleMinutes: 0 }, { idleMinutes: 31 }, { enabled: "si" }, { x: 1 }]) {
      expect((await owner.patch("/admin/members/pin-settings", bad)).status).toBe(400);
    }
  });

  it("la sesión y la cuenta de quien entra traen el cierre por inactividad configurado", async () => {
    const { ws, owner, create } = await setup("PIN panel kiosco");
    await owner.patch("/admin/members/pin-settings", {
      enabled: true,
      idleMinutes: 2,
      closeAfterConfirm: false,
    });
    const created = (await create()).body as CreatedBody;
    const login = await pinLogin({
      workspaceSlug: ws.slug,
      loginName: "operario1",
      pin: created.pin,
    });
    const body = login.body as {
      accessToken: string;
      expiresIn: number;
      kiosk: unknown;
      user: { kind: string; email: string | null };
    };
    expect(body.expiresIn).toBe(120);
    expect(body.user).toMatchObject({ kind: "PIN", email: null });
    expect(body.kiosk).toEqual({ idleSeconds: 120, closeAfterConfirm: false });
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${body.accessToken}`);
    expect((me.body as { kiosk: unknown }).kiosk).toEqual({
      idleSeconds: 120,
      closeAfterConfirm: false,
    });
    // Una cuenta común no tiene sesión de tablet.
    const standard = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${ws.token}`);
    expect((standard.body as { kiosk: unknown }).kiosk).toBeNull();
    expect(JSON.stringify(me.body)).not.toContain("settings");
  });
});
