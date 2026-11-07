// Navigation by areas (docs/spec/diseno.md 10.4.1): moving a space to another area needs spaces.manage
// (managing the space isn't enough); each person picks only their own home area; a department's needs
// departments.manage; /auth/me says both; the Prevention space is in its area from the start.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const api = (slug: string, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  patch: (path: string, body?: object) =>
    request(app)
      .patch(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body?: object) =>
    request(app).put(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`).send(body),
});

interface Me {
  memberships: {
    id: string;
    workspace: { slug: string };
    homeArea: string | null;
    departmentHomeArea: string | null;
  }[];
}

const me = async (token: string, slug: string) => {
  const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body as Me).memberships.find((m) => m.workspace.slug === slug);
};

async function space(ws: TestWorkspace, name: string): Promise<string> {
  const res = await api(ws.slug, ws.token).post("/spaces", { name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { space: { id: string } }).space.id;
}

describe("área de un espacio", () => {
  it("cambiarla pide spaces.manage; quien gestiona el espacio sin esa capacidad recibe 403", async () => {
    const ws = await createWorkspace(ctx, "Áreas espacio");
    const spaceId = await space(ws, "Procedimientos");
    const keeper = await addMember(ctx, ws, { base: "MEMBER", name: "Gestiona el espacio" });
    await ctx.prisma.permission.create({
      data: {
        workspaceId: ws.workspaceId,
        spaceId,
        membershipId: keeper.membership.id,
        level: "MANAGE",
        grantedById: ws.membershipId,
      },
    });
    const asKeeper = api(ws.slug, keeper.token);
    expect((await asKeeper.patch(`/spaces/${spaceId}`, { area: "DOCUMENTS" })).status).toBe(403);
    // The rest of the space they still manage.
    expect((await asKeeper.patch(`/spaces/${spaceId}`, { description: "Planta" })).status).toBe(
      200,
    );
    expect((await ctx.prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).area).toBe(
      "WIKI",
    );
    const moved = await api(ws.slug, ws.token).patch(`/spaces/${spaceId}`, { area: "DOCUMENTS" });
    expect(moved.status).toBe(200);
    expect((moved.body as { space: { area: string } }).space.area).toBe("DOCUMENTS");
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "space.update", entityId: spaceId },
      }),
    ).toBeGreaterThan(0);
    // The list filters by area (one or several); an unknown one is a 400.
    const owner = api(ws.slug, ws.token);
    const docs = await owner.get("/spaces?area=DOCUMENTS");
    expect((docs.body as { items: { id: string }[] }).items.map((s) => s.id)).toEqual([spaceId]);
    const wiki = await owner.get("/spaces?area=WIKI");
    expect((wiki.body as { items: { id: string }[] }).items.map((s) => s.id)).not.toContain(
      spaceId,
    );
    expect((await owner.get("/spaces?area=DOCUMENTS,WIKI")).status).toBe(200);
    expect((await owner.get("/spaces?area=OTRA")).status).toBe(400);
    // Another company's space: 404.
    const other = await createWorkspace(ctx, "Áreas otra");
    expect(
      (await api(other.slug, other.token).patch(`/spaces/${spaceId}`, { area: "WIKI" })).status,
    ).toBe(404);
  });

  it("el espacio de Prevención nace en su área", async () => {
    const ws = await createWorkspace(ctx, "Áreas prevención");
    expect((await api(ws.slug, ws.token).put("/admin/safety", { enabled: true })).status).toBe(200);
    const row = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
    const spaceId = (row.settings as { safety: { spaceId: string } }).safety.spaceId;
    expect((await ctx.prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).area).toBe(
      "PREVENTION",
    );
  });
});

describe("área de entrada", () => {
  it("cada persona cambia solo la suya, y /auth/me la devuelve", async () => {
    const ws = await createWorkspace(ctx, "Áreas perfil");
    const ana = await addMember(ctx, ws, { base: "MEMBER", name: "Ana" });
    const res = await api(ws.slug, ana.token).patch("/profile/home-area", { homeArea: "WIKI" });
    expect(res.status).toBe(204);
    expect((await me(ana.token, ws.slug))?.homeArea).toBe("WIKI");
    // Nobody else's changed (the owner's included).
    expect((await me(ws.token, ws.slug))?.homeArea).toBeNull();
    // The body has no one else's id to aim at.
    expect(
      (
        await api(ws.slug, ana.token).patch("/profile/home-area", {
          homeArea: "ADMIN",
          membershipId: ws.membershipId,
        })
      ).status,
    ).toBe(400);
    expect(
      (await api(ws.slug, ana.token).patch("/profile/home-area", { homeArea: "NADA" })).status,
    ).toBe(400);
    expect(
      (await api(ws.slug, ana.token).patch("/profile/home-area", { homeArea: null })).status,
    ).toBe(204);
    expect((await me(ana.token, ws.slug))?.homeArea).toBeNull();
    // In another company the person isn't a member: 404.
    const other = await createWorkspace(ctx, "Áreas perfil otra");
    expect(
      (await api(other.slug, ana.token).patch("/profile/home-area", { homeArea: "WIKI" })).status,
    ).toBe(404);
  });

  it("la de un departamento pide departments.manage y llega a sus miembros", async () => {
    const ws = await createWorkspace(ctx, "Áreas departamento");
    const ana = await addMember(ctx, ws, { base: "MEMBER", name: "Ana" });
    const department = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Prevención" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: department.id,
        membershipId: ana.membership.id,
        position: "HEAD",
      },
    });
    // Not even its head without the capability.
    expect(
      (
        await api(ws.slug, ana.token).patch(`/admin/departments/${department.id}`, {
          homeArea: "PREVENTION",
        })
      ).status,
    ).toBe(403);
    const ok = await api(ws.slug, ws.token).patch(`/admin/departments/${department.id}`, {
      homeArea: "PREVENTION",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const mine = await me(ana.token, ws.slug);
    expect(mine?.departmentHomeArea).toBe("PREVENTION");
    expect(mine?.homeArea).toBeNull();
    // Another company's department: 404.
    const other = await createWorkspace(ctx, "Áreas departamento otra");
    expect(
      (
        await api(other.slug, other.token).patch(`/admin/departments/${department.id}`, {
          homeArea: "WIKI",
        })
      ).status,
    ).toBe(404);
  });
});
