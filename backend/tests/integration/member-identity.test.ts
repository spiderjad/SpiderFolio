// Corregir nombre o email de una persona: solo con permiso de gestión, solo si la cuenta es de esta
// empresa y el email todavía no se confirmó (si no, lo cambia la propia persona).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

async function world() {
  const ws = await createWorkspace(ctx, "Identidad");
  const target = await addMember(ctx, ws, { name: "Persona Original" });
  const peer = await addMember(ctx, ws, { name: "Colega Común" });
  const patch = (token: string, body: object) =>
    request(app)
      .patch(`/api/v1/w/${ws.slug}/admin/members/${target.membership.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const userOf = () => ctx.prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
  return { ws, target, peer, patch, userOf };
}

describe("editar nombre y email de un miembro", () => {
  it("el nombre se corrige y se normaliza", async () => {
    const w = await world();
    const res = await w.patch(w.ws.token, { name: "maría del carmen" });
    expect(res.status).toBe(200);
    expect((await w.userOf()).name).toBe("María del Carmen");
  });

  it("un email sin confirmar se corrige: queda sin confirmar y se cierran sus sesiones", async () => {
    const w = await world();
    await ctx.prisma.user.update({
      where: { id: w.target.user.id },
      data: { emailVerifiedAt: null },
    });
    const res = await w.patch(w.ws.token, { email: "  Nuevo.Correo@Test.local " });
    expect(res.status).toBe(200);
    const user = await w.userOf();
    expect(user.email).toBe("nuevo.correo@test.local");
    expect(user.emailVerifiedAt).toBeNull();
    const open = await ctx.prisma.session.count({
      where: { userId: w.target.user.id, revokedAt: null },
    });
    expect(open).toBe(0);
  });

  it("si ya confirmó su email, no se cambia desde acá", async () => {
    const w = await world();
    await ctx.prisma.user.update({
      where: { id: w.target.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const before = (await w.userOf()).email;
    expect((await w.patch(w.ws.token, { email: "otro@test.local" })).status).toBe(403);
    expect((await w.userOf()).email).toBe(before);
  });

  it("si la cuenta pertenece a otras empresas, ni nombre ni email", async () => {
    const w = await world();
    const other = await createWorkspace(ctx, "Otra empresa");
    const role = await ctx.prisma.role.findFirstOrThrow({
      where: { workspaceId: other.workspaceId, base: "MEMBER", isSystem: true },
    });
    await ctx.prisma.membership.create({
      data: { userId: w.target.user.id, workspaceId: other.workspaceId, roleId: role.id },
    });
    await ctx.prisma.user.update({
      where: { id: w.target.user.id },
      data: { emailVerifiedAt: null },
    });
    expect((await w.patch(w.ws.token, { name: "Otro Nombre" })).status).toBe(403);
    expect((await w.patch(w.ws.token, { email: "x@test.local" })).status).toBe(403);
    expect((await w.userOf()).name).toBe("Persona Original");
  });

  it("no se puede usar un email que ya tiene otra cuenta", async () => {
    const w = await world();
    await ctx.prisma.user.update({
      where: { id: w.target.user.id },
      data: { emailVerifiedAt: null },
    });
    const taken = (await ctx.prisma.user.findUniqueOrThrow({ where: { id: w.peer.user.id } }))
      .email;
    expect((await w.patch(w.ws.token, { email: taken ?? "" })).status).toBe(409);
  });

  it("sin permiso de gestión de miembros, no", async () => {
    const w = await world();
    expect((await w.patch(w.peer.token, { name: "Intruso Total" })).status).toBe(403);
    expect((await w.userOf()).name).toBe("Persona Original");
  });
});
