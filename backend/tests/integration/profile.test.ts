// Mi perfil: nombre propio, puesto propio y cambio de email (con contraseña y confirmación: el
// email nuevo solo reemplaza al actual cuando se confirma con el enlace).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { issueAuthToken } from "../../src/modules/auth/auth-tokens.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;
const PASSWORD = "UnaContraseñaLarga123";

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

async function world() {
  const ws = await createWorkspace(ctx, "Perfil");
  const me = await addMember(ctx, ws, { name: "Persona Perfil" });
  const other = await addMember(ctx, ws, { name: "Otra Persona" });
  await ctx.prisma.user.update({
    where: { id: me.user.id },
    data: { passwordHash: await ctx.deps.passwords.hash(PASSWORD) },
  });
  const call = (method: "patch" | "post", path: string, body: object, token = me.token) =>
    request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).send(body);
  const user = () => ctx.prisma.user.findUniqueOrThrow({ where: { id: me.user.id } });
  return { ws, me, other, call, user };
}

describe("mi perfil", () => {
  it("el nombre propio se corrige y se normaliza", async () => {
    const w = await world();
    expect((await w.call("patch", "/auth/me", { name: "ana maría de la vega" })).status).toBe(204);
    expect((await w.user()).name).toBe("Ana María de la Vega");
  });

  it("el puesto propio se cambia sin permisos de gestión y no toca el de otras personas", async () => {
    const w = await world();
    const res = await w.call("patch", `/w/${w.ws.slug}/profile`, { jobTitle: "Calidad" });
    expect(res.status).toBe(204);
    const mine = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: w.me.membership.id },
    });
    const others = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: w.other.membership.id },
    });
    expect(mine.jobTitle).toBe("Calidad");
    expect(others.jobTitle).toBeNull();
  });

  it("cambiar el email pide la contraseña actual", async () => {
    const w = await world();
    const res = await w.call("post", "/auth/change-email", {
      email: "nuevo@test.local",
      currentPassword: "otra-contraseña-cualquiera",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await w.user()).pendingEmail).toBeNull();
  });

  it("el email nuevo no reemplaza al actual hasta confirmarlo", async () => {
    const w = await world();
    const before = (await w.user()).email;
    const res = await w.call("post", "/auth/change-email", {
      email: "  Nuevo.Mail@Test.local ",
      currentPassword: PASSWORD,
    });
    expect(res.status).toBe(204);
    const pending = await w.user();
    expect(pending.email).toBe(before);
    expect(pending.pendingEmail).toBe("nuevo.mail@test.local");
    // Se confirma con el enlace (token de un solo uso) y recién ahí cambia.
    const token = await issueAuthToken(ctx.prisma, w.me.user.id, "CHANGE_EMAIL");
    expect((await request(app).post("/api/v1/auth/verify-email").send({ token })).status).toBe(204);
    const done = await w.user();
    expect(done.email).toBe("nuevo.mail@test.local");
    expect(done.pendingEmail).toBeNull();
    expect(done.emailVerifiedAt).not.toBeNull();
    expect(
      (await request(app).post("/api/v1/auth/verify-email").send({ token })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("no se puede pedir el email de otra cuenta", async () => {
    const w = await world();
    const taken = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: w.other.user.id } }))
      .email;
    const res = await w.call("post", "/auth/change-email", {
      email: taken ?? "",
      currentPassword: PASSWORD,
    });
    expect(res.status).toBe(409);
  });

  it("quien entra con PIN no tiene email para cambiar", async () => {
    const w = await world();
    await ctx.prisma.user.update({
      where: { id: w.me.user.id },
      data: { kind: "PIN", email: null, emailVerifiedAt: null, passwordHash: null },
    });
    const res = await w.call("post", "/auth/change-email", {
      email: "pin@test.local",
      currentPassword: PASSWORD,
    });
    expect(res.status).toBe(403);
  });
});
