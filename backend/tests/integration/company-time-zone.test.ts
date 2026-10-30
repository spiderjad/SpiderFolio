// The company's time zone in Administration › Security, next to its language: who can change it, which
// values it takes and that it's kept with the rest of the settings.
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

const call = (slug: string, token: string, method: "get" | "patch", body?: object) =>
  request(app)
    [method](`/api/v1/w/${slug}/admin/security`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("zona horaria de la empresa", () => {
  it("se lee y se cambia junto con el idioma, sin tocar el resto de los ajustes", async () => {
    const ws = await createWorkspace(ctx, "Zona horaria");
    const before = await call(ws.slug, ws.token, "get");
    expect((before.body as { settings: { timezone: string } }).settings.timezone).toBe(
      "Europe/Madrid",
    );
    const changed = await call(ws.slug, ws.token, "patch", { timezone: "America/Santiago" });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      settings: { timezone: "America/Santiago", locale: "es" },
    });
    const stored = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
    expect(stored.settings).toMatchObject({ timezone: "America/Santiago", locale: "es" });
  });

  it("una zona que no existe se rechaza", async () => {
    const ws = await createWorkspace(ctx, "Zona mala");
    const res = await call(ws.slug, ws.token, "patch", { timezone: "Marte/Olimpo" });
    expect(res.status).toBe(400);
    const stored = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
    expect(stored.settings).toMatchObject({ timezone: "Europe/Madrid" });
  });

  it("un miembro no la puede cambiar", async () => {
    const ws = await createWorkspace(ctx, "Zona miembro");
    const member = await addMember(ctx, ws, { base: "MEMBER" });
    const res = await call(ws.slug, member.token, "patch", { timezone: "Asia/Tokyo" });
    expect(res.status).toBe(403);
  });
});
