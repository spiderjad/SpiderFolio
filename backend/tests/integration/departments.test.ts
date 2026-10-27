// Parte 3 del Módulo 2: departamentos, jerarquía y miembros.
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

interface DepartmentBody {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  head: { membershipId: string; name: string } | null;
  deputies: { membershipId: string; name: string }[];
  memberCount: number;
}
const listOf = (res: { body: unknown }) => (res.body as { items: DepartmentBody[] }).items;
const oneOf = (res: { body: unknown }) => (res.body as { department: DepartmentBody }).department;

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

describe("departamentos", () => {
  it("crea, lista, edita y borra, y cada paso queda en la auditoría", async () => {
    const ws = await createWorkspace(ctx, "Deptos CRUD");
    const a = api(ws.slug, ws.token);
    const created = await a.post("/admin/departments", {
      name: "Calidad",
      description: "Control de calidad",
      color: "#7C3AED",
    });
    expect(created.status).toBe(201);
    const calidad = oneOf(created);
    expect(calidad).toMatchObject({ name: "Calidad", color: "#7c3aed", parentId: null });

    const list = listOf(await a.get("/admin/departments"));
    expect(list.map((d) => d.name)).toEqual(["Calidad"]);

    const updated = await a.patch(`/admin/departments/${calidad.id}`, { name: "Aseguramiento" });
    expect(oneOf(updated).name).toBe("Aseguramiento");

    expect((await a.delete(`/admin/departments/${calidad.id}`)).status).toBe(204);
    expect(listOf(await a.get("/admin/departments"))).toEqual([]);

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { workspaceId: ws.workspaceId, action: { startsWith: "department." } },
        orderBy: { createdAt: "asc" },
      })
    ).map((log) => log.action);
    expect(actions).toEqual(["department.create", "department.update", "department.delete"]);
  });

  it("rechaza nombres repetidos y datos inválidos", async () => {
    const ws = await createWorkspace(ctx, "Deptos nombre");
    const a = api(ws.slug, ws.token);
    expect((await a.post("/admin/departments", { name: "Calidad" })).status).toBe(201);
    const again = await a.post("/admin/departments", { name: "calidad" });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe("CONFLICT");
    for (const body of [
      { name: "x" },
      { name: "Válido", color: "rojo" },
      { name: "Válido", extra: 1 },
    ]) {
      const res = await a.post("/admin/departments", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("arma jerarquía, impide ciclos y sube a los hijos al borrar el padre", async () => {
    const ws = await createWorkspace(ctx, "Deptos jerarquía");
    const a = api(ws.slug, ws.token);
    const prod = oneOf(await a.post("/admin/departments", { name: "Producción" }));
    const lineas = oneOf(await a.post("/admin/departments", { name: "Líneas", parentId: prod.id }));
    const linea1 = oneOf(
      await a.post("/admin/departments", { name: "Línea 1", parentId: lineas.id }),
    );

    const cycle = await a.patch(`/admin/departments/${prod.id}`, { parentId: linea1.id });
    expect(cycle.status).toBe(400);
    const self = await a.patch(`/admin/departments/${prod.id}`, { parentId: prod.id });
    expect(self.status).toBe(400);

    // Mover Línea 1 bajo Producción y devolverla bajo Líneas.
    expect(
      oneOf(await a.patch(`/admin/departments/${linea1.id}`, { parentId: prod.id })).parentId,
    ).toBe(prod.id);
    await a.patch(`/admin/departments/${linea1.id}`, { parentId: lineas.id });

    // Al borrar "Líneas", "Línea 1" sube bajo "Producción".
    expect((await a.delete(`/admin/departments/${lineas.id}`)).status).toBe(204);
    const after = listOf(await a.get("/admin/departments"));
    expect(after.find((d) => d.id === linea1.id)?.parentId).toBe(prod.id);
  });

  it("el padre tiene que ser del mismo workspace", async () => {
    const a = await createWorkspace(ctx, "Deptos padre A");
    const b = await createWorkspace(ctx, "Deptos padre B");
    const ajeno = oneOf(
      await api(b.slug, b.token).post("/admin/departments", { name: "Del otro" }),
    );
    const res = await api(a.slug, a.token).post("/admin/departments", {
      name: "Hijo ajeno",
      parentId: ajeno.id,
    });
    expect(res.status).toBe(404);
  });

  it("agrega y quita miembros (en bloque, sin duplicar) y muestra el detalle", async () => {
    const ws = await createWorkspace(ctx, "Deptos miembros");
    const a = api(ws.slug, ws.token);
    const calidad = oneOf(await a.post("/admin/departments", { name: "Calidad" }));
    const ana = await addMember(ctx, ws, { name: "Ana Ruiz" });
    const luis = await addMember(ctx, ws, { name: "Luis Gómez" });

    const added = await a.post(`/admin/departments/${calidad.id}/members`, {
      membershipIds: [ana.membership.id, luis.membership.id],
    });
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ added: 2 });
    const repeated = await a.post(`/admin/departments/${calidad.id}/members`, {
      membershipIds: [ana.membership.id],
    });
    expect(repeated.body).toEqual({ added: 0 });

    const detail = await a.get(`/admin/departments/${calidad.id}`);
    expect((detail.body as { department: DepartmentBody }).department.memberCount).toBe(2);
    const members = await a.get(`/admin/departments/${calidad.id}/members`);
    expect((members.body as { items: { name: string }[] }).items.map((m) => m.name)).toEqual([
      "Ana Ruiz",
      "Luis Gómez",
    ]);

    expect(
      (await a.delete(`/admin/departments/${calidad.id}/members/${ana.membership.id}`)).status,
    ).toBe(204);
    expect(
      (await a.delete(`/admin/departments/${calidad.id}/members/${ana.membership.id}`)).status,
    ).toBe(404);
    expect(listOf(await a.get("/admin/departments"))[0]?.memberCount).toBe(1);
  });

  it("borrar un departamento libera a sus miembros", async () => {
    const ws = await createWorkspace(ctx, "Deptos borrado");
    const a = api(ws.slug, ws.token);
    const calidad = oneOf(await a.post("/admin/departments", { name: "Calidad" }));
    const ana = await addMember(ctx, ws);
    await a.post(`/admin/departments/${calidad.id}/members`, {
      membershipIds: [ana.membership.id],
    });
    expect((await a.delete(`/admin/departments/${calidad.id}`)).status).toBe(204);
    expect(
      await ctx.prisma.departmentMember.count({ where: { membershipId: ana.membership.id } }),
    ).toBe(0);
    // La persona sigue en el workspace.
    expect(await ctx.prisma.membership.count({ where: { id: ana.membership.id } })).toBe(1);
  });

  it("el responsable tiene que ser un miembro activo; al sacarlo, queda sin responsable", async () => {
    const ws = await createWorkspace(ctx, "Deptos responsable");
    const a = api(ws.slug, ws.token);
    const activo = await addMember(ctx, ws, { name: "Activa" });
    const suspendido = await addMember(ctx, ws, { name: "Suspendido", status: "SUSPENDED" });
    const bad = await a.post("/admin/departments", {
      name: "Calidad",
      headId: suspendido.membership.id,
    });
    expect(bad.status).toBe(400);
    const ok = oneOf(
      await a.post("/admin/departments", { name: "Calidad", headId: activo.membership.id }),
    );
    expect(ok.head).toEqual({ membershipId: activo.membership.id, name: "Activa" });
    await a.post(`/admin/departments/${ok.id}/members`, { membershipIds: [activo.membership.id] });
    await a.delete(`/admin/departments/${ok.id}/members/${activo.membership.id}`);
    const after = listOf(await a.get("/admin/departments"));
    expect(after[0]?.head).toBeNull();
  });

  it("un invitado externo no entra a departamentos", async () => {
    const ws = await createWorkspace(ctx, "Deptos invitados");
    const a = api(ws.slug, ws.token);
    const calidad = oneOf(await a.post("/admin/departments", { name: "Calidad" }));
    const guest = await addMember(ctx, ws, { base: "GUEST" });
    const res = await a.post(`/admin/departments/${calidad.id}/members`, {
      membershipIds: [guest.membership.id],
    });
    expect(res.status).toBe(400);
  });

  it("no acepta miembros de otro workspace", async () => {
    const a = await createWorkspace(ctx, "Deptos miembros A");
    const b = await createWorkspace(ctx, "Deptos miembros B");
    const calidad = oneOf(
      await api(a.slug, a.token).post("/admin/departments", { name: "Calidad" }),
    );
    const ajeno = await addMember(ctx, b);
    const res = await api(a.slug, a.token).post(`/admin/departments/${calidad.id}/members`, {
      membershipIds: [ajeno.membership.id],
    });
    expect(res.status).toBe(404);
  });

  it("el acceso del departamento tiene la forma definitiva (vacío hasta el módulo 3)", async () => {
    const ws = await createWorkspace(ctx, "Deptos acceso");
    const a = api(ws.slug, ws.token);
    const calidad = oneOf(await a.post("/admin/departments", { name: "Calidad" }));
    const res = await a.get(`/admin/departments/${calidad.id}/access`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ spaces: [], folders: [], documents: [] });
  });

  it("exige departments.manage para modificar y deja listar a quien invita", async () => {
    const ws = await createWorkspace(ctx, "Deptos permisos");
    const member = await addMember(ctx, ws);
    const m = api(ws.slug, member.token);
    // Un miembro lee la estructura (según "Los miembros ven"), pero no la modifica.
    expect((await m.get("/admin/departments")).status).toBe(200);
    expect((await m.post("/admin/departments", { name: "Calidad" })).status).toBe(403);

    const rol = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Quien invita",
        base: "ADMIN",
        capabilities: ["members.invite"],
      },
    });
    const person = await addMember(ctx, ws, { roleId: rol.id });
    const p = api(ws.slug, person.token);
    expect((await p.get("/admin/departments")).status).toBe(200);
    expect((await p.post("/admin/departments", { name: "Calidad" })).status).toBe(403);
    expect((await p.get("/admin/departments/x")).status).toBe(404);
  });
});
