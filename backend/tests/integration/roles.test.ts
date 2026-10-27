// Parte 2 del Módulo 2: roles personalizados y capacidades.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import { errorOf } from "../http.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

interface RoleBody {
  id: string;
  name: string;
  base: string;
  capabilities: string[];
  isSystem: boolean;
  memberCount: number;
}
const rolesOf = (res: { body: unknown }) => (res.body as { items: RoleBody[] }).items;
const roleOf = (res: { body: unknown }) => (res.body as { role: RoleBody }).role;

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
  delete: (path: string) =>
    request(app).delete(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
});

describe("roles del panel", () => {
  it("lista los 4 roles de sistema primero, con su cantidad de miembros", async () => {
    const ws = await createWorkspace(ctx, "Roles listado");
    const res = await api(ws.slug, ws.token).get("/admin/roles");
    expect(res.status).toBe(200);
    const roles = rolesOf(res);
    expect(roles.map((r) => r.base)).toEqual(["OWNER", "ADMIN", "MEMBER", "GUEST"]);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    expect(roles[0]).toMatchObject({ memberCount: 1 });
  });

  it("crea, edita y borra un rol personalizado, y cada paso queda en la auditoría", async () => {
    const ws = await createWorkspace(ctx, "Roles CRUD");
    const a = api(ws.slug, ws.token);
    const created = await a.post("/admin/roles", {
      name: "Responsable de Calidad",
      description: "Aprueba documentos",
      base: "MEMBER",
      capabilities: ["documents.approve", "documents.require_reading", "audit.view"],
    });
    expect(created.status).toBe(201);
    const role = roleOf(created);
    expect(role).toMatchObject({ isSystem: false, base: "MEMBER", memberCount: 0 });

    const updated = await a.patch(`/admin/roles/${role.id}`, {
      name: "Calidad",
      capabilities: ["documents.approve"],
    });
    expect(updated.status).toBe(200);
    expect(roleOf(updated)).toMatchObject({ name: "Calidad", capabilities: ["documents.approve"] });

    expect((await a.delete(`/admin/roles/${role.id}`)).status).toBe(204);
    const roles = rolesOf(await a.get("/admin/roles"));
    expect(roles.some((r) => r.id === role.id)).toBe(false);

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { workspaceId: ws.workspaceId, action: { startsWith: "role." } },
        orderBy: { createdAt: "asc" },
      })
    ).map((log) => log.action);
    expect(actions).toEqual(["role.create", "role.update", "role.delete"]);
  });

  it("rechaza nombres repetidos (sin distinguir mayúsculas)", async () => {
    const ws = await createWorkspace(ctx, "Roles nombre");
    const a = api(ws.slug, ws.token);
    const body = { name: "Calidad", base: "MEMBER", capabilities: [] };
    expect((await a.post("/admin/roles", body)).status).toBe(201);
    const again = await a.post("/admin/roles", { ...body, name: "CALIDAD" });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe("CONFLICT");
  });

  it("valida el cuerpo con Zod", async () => {
    const ws = await createWorkspace(ctx, "Roles zod");
    const a = api(ws.slug, ws.token);
    for (const body of [
      { name: "x", base: "MEMBER", capabilities: [] },
      { name: "Válido", base: "OWNER", capabilities: [] },
      { name: "Válido", base: "MEMBER", capabilities: ["inventada"] },
      { name: "Válido", base: "MEMBER", capabilities: ["audit.view", "audit.view"] },
      { name: "Válido", base: "MEMBER", capabilities: [], extra: true },
    ]) {
      const res = await a.post("/admin/roles", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(res).code).toBe("VALIDATION_ERROR");
    }
  });

  it("un rol de invitado no puede llevar capacidades", async () => {
    const ws = await createWorkspace(ctx, "Roles guest");
    const res = await api(ws.slug, ws.token).post("/admin/roles", {
      name: "Externo con poder",
      base: "GUEST",
      capabilities: ["audit.view"],
    });
    expect(res.status).toBe(400);
  });

  it("nadie se asigna capacidades que no tiene (escalada)", async () => {
    const ws = await createWorkspace(ctx, "Roles escalada");
    // Administra roles pero no la seguridad.
    const rolesOnly = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Gestión de roles",
        base: "ADMIN",
        capabilities: ["roles.manage", "audit.view"],
      },
    });
    const admin = await addMember(ctx, ws, { roleId: rolesOnly.id });
    const a = api(ws.slug, admin.token);
    const res = await a.post("/admin/roles", {
      name: "Seguridad",
      base: "MEMBER",
      capabilities: ["security.manage"],
    });
    expect(res.status).toBe(403);
    expect(errorOf(res).details).toBeUndefined();
    expect(errorOf(res).message).toContain("security.manage");
    // Con una capacidad propia sí.
    const ok = await a.post("/admin/roles", {
      name: "Auditor interno",
      base: "MEMBER",
      capabilities: ["audit.view"],
    });
    expect(ok.status).toBe(201);
    // Y tampoco puede editar ni borrar un rol del propietario que da lo que él no tiene.
    const ownerRole = await api(ws.slug, ws.token).post("/admin/roles", {
      name: "Con seguridad",
      base: "MEMBER",
      capabilities: ["security.manage"],
    });
    expect(ownerRole.status).toBe(201);
    const edit = await a.patch(`/admin/roles/${roleOf(ownerRole).id}`, { name: "Otro nombre" });
    expect(edit.status).toBe(403);
    const del = await a.delete(`/admin/roles/${roleOf(ownerRole).id}`);
    expect(del.status).toBe(403);
  });

  it("los roles de sistema no se editan ni se borran", async () => {
    const ws = await createWorkspace(ctx, "Roles sistema");
    const a = api(ws.slug, ws.token);
    const system = rolesOf(await a.get("/admin/roles")).find((r) => r.base === "MEMBER");
    expect((await a.patch(`/admin/roles/${system?.id}`, { name: "Nuevo" })).status).toBe(403);
    expect((await a.delete(`/admin/roles/${system?.id}`)).status).toBe(403);
  });

  it("un rol en uso no se borra (409) y se puede borrar al quedar libre", async () => {
    const ws = await createWorkspace(ctx, "Roles en uso");
    const a = api(ws.slug, ws.token);
    const created = await a.post("/admin/roles", {
      name: "Calidad",
      base: "MEMBER",
      capabilities: ["audit.view"],
    });
    const role = roleOf(created);
    const member = await addMember(ctx, ws, { roleId: role.id });
    const blocked = await a.delete(`/admin/roles/${role.id}`);
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).details).toBeUndefined();
    expect(errorOf(blocked).message).toContain("miembros: 1");
    await ctx.prisma.membership.delete({ where: { id: member.membership.id } });
    expect((await a.delete(`/admin/roles/${role.id}`)).status).toBe(204);
  });

  it("no se dan capacidades administrativas a un rol que usan lectores", async () => {
    const ws = await createWorkspace(ctx, "Roles lectores");
    const a = api(ws.slug, ws.token);
    const role = roleOf(
      await a.post("/admin/roles", { name: "Planta", base: "MEMBER", capabilities: [] }),
    );
    await addMember(ctx, ws, { roleId: role.id, seatType: "READER" });
    const res = await a.patch(`/admin/roles/${role.id}`, { capabilities: ["audit.view"] });
    expect(res.status).toBe(409);
  });

  it("exige roles.manage para modificar y deja listar a quien invita", async () => {
    const ws = await createWorkspace(ctx, "Roles permisos");
    const member = await addMember(ctx, ws, { base: "MEMBER" });
    const m = api(ws.slug, member.token);
    const newRole = { name: "Nuevo", base: "MEMBER", capabilities: [] };
    expect((await m.get("/admin/roles")).status).toBe(403);
    expect((await m.post("/admin/roles", newRole)).status).toBe(403);
    expect((await m.get("/admin/capabilities")).status).toBe(403);

    const inviter = roleOf(
      await api(ws.slug, ws.token).post("/admin/roles", {
        name: "Quien invita",
        base: "MEMBER",
        capabilities: ["members.invite"],
      }),
    );
    const person = await addMember(ctx, ws, { roleId: inviter.id });
    const p = api(ws.slug, person.token);
    expect((await p.get("/admin/roles")).status).toBe(200);
    expect((await p.post("/admin/roles", newRole)).status).toBe(403);
  });

  it("GET /admin/capabilities devuelve los grupos y lo que quien consulta puede dar", async () => {
    const ws = await createWorkspace(ctx, "Roles capacidades");
    const res = await api(ws.slug, ws.token).get("/admin/capabilities");
    expect(res.status).toBe(200);
    const body = res.body as { groups: { id: string }[]; all: string[]; grantable: string[] };
    expect(body.groups.map((g) => g.id)).toContain("members");
    expect(body.all).toHaveLength(22);
    expect(body.grantable).toEqual(body.all);
  });
});
