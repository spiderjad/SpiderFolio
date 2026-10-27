// Parte 5 del Módulo 2: miembros (listado, cambios, suspender, quitar, masivas e importación).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  uniqueEmail,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";
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
  delete: (path: string, body?: object) =>
    request(app)
      .delete(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
});

interface MemberBody {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  roleBase: string;
  seatType: string;
  status: string;
  jobTitle: string | null;
  departments: { id: string; name: string }[];
  isSelf: boolean;
}
interface ListBody {
  items: MemberBody[];
  total: number;
  page: number;
  pageSize: number;
}
const memberOf = (res: { body: unknown }) => (res.body as { member: MemberBody }).member;

async function systemRole(ws: TestWorkspace, base: "OWNER" | "ADMIN" | "MEMBER" | "GUEST") {
  return await ctx.prisma.role.findFirstOrThrow({
    where: {
      workspaceId: ws.workspaceId,
      base,
      isSystem: true,
      NOT: { name: "Jefe de departamento" },
    },
  });
}

async function customRole(
  ws: TestWorkspace,
  name: string,
  capabilities: string[],
  base: "ADMIN" | "MEMBER" | "GUEST" = "MEMBER",
) {
  return await ctx.prisma.role.create({
    data: { workspaceId: ws.workspaceId, name, base, capabilities },
  });
}

/** Persona con un rol personalizado que le da esas capacidades, ya con su token. */
async function withCapabilities(
  ws: TestWorkspace,
  capabilities: string[],
  name = "Gestor",
  base: "ADMIN" | "MEMBER" = "ADMIN",
) {
  // Gestionar personas es del propietario y los administradores: el rol base es ADMIN.
  const role = await customRole(ws, `${name} ${uniqueEmail()}`, capabilities, base);
  return await addMember(ctx, ws, { roleId: role.id });
}

describe("listado", () => {
  it("pagina, ordena, busca y filtra del lado del servidor", async () => {
    const ws = await createWorkspace(ctx, "Miembros listado");
    const a = api(ws.slug, ws.token);
    const quality = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    const ana = await addMember(ctx, ws, { name: "Ana Ruiz" });
    const luis = await addMember(ctx, ws, { name: "Luis Gómez" });
    const eva = await addMember(ctx, ws, { name: "Eva Díaz", status: "SUSPENDED" });
    await ctx.prisma.membership.update({
      where: { id: ana.membership.id },
      data: { jobTitle: "Jefa de calidad" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: quality.id,
        membershipId: luis.membership.id,
      },
    });

    const all = (await a.get("/admin/members?sort=name")).body as ListBody;
    expect(all.total).toBe(4);
    expect(all.items.map((m) => m.name)).toEqual([
      "Ana Ruiz",
      "Dueño de Miembros listado",
      "Eva Díaz",
      "Luis Gómez",
    ]);
    expect(all.items.find((m) => m.isSelf)?.roleBase).toBe("OWNER");

    const desc = (await a.get("/admin/members?sort=name&dir=desc")).body as ListBody;
    expect(desc.items[0]?.name).toBe("Luis Gómez");

    const page2 = (await a.get("/admin/members?sort=name&pageSize=2&page=2")).body as ListBody;
    expect(page2).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(page2.items.map((m) => m.name)).toEqual(["Eva Díaz", "Luis Gómez"]);

    const byName = (await a.get("/admin/members?q=gómez")).body as ListBody;
    expect(byName.items.map((m) => m.id)).toEqual([luis.membership.id]);
    const byEmail = (await a.get(`/admin/members?q=${encodeURIComponent(eva.user.email)}`))
      .body as ListBody;
    expect(byEmail.items.map((m) => m.id)).toEqual([eva.membership.id]);
    const byTitle = (await a.get("/admin/members?q=jefa")).body as ListBody;
    expect(byTitle.items.map((m) => m.id)).toEqual([ana.membership.id]);

    expect(
      ((await a.get("/admin/members?status=SUSPENDED")).body as ListBody).items.map((m) => m.id),
    ).toEqual([eva.membership.id]);
    expect(
      ((await a.get(`/admin/members?department=${quality.id}`)).body as ListBody).items.map(
        (m) => m.id,
      ),
    ).toEqual([luis.membership.id]);
    const ownerRole = await systemRole(ws, "OWNER");
    expect(((await a.get(`/admin/members?role=${ownerRole.id}`)).body as ListBody).total).toBe(1);
    const withDepartments = (await a.get("/admin/members?q=luis")).body as ListBody;
    expect(withDepartments.items[0]?.departments).toMatchObject([
      { id: quality.id, name: "Calidad" },
    ]);

    for (const sort of ["role", "status", "email", "createdAt", "lastSeenAt"]) {
      expect((await a.get(`/admin/members?sort=${sort}`)).status, sort).toBe(200);
    }
    expect((await a.get("/admin/members?sort=passwordHash")).status).toBe(400);
    expect((await a.get("/admin/members?pageSize=1000")).status).toBe(400);
  });

  it("el listado y la ficha no mezclan workspaces", async () => {
    const a = await createWorkspace(ctx, "Miembros A");
    const b = await createWorkspace(ctx, "Miembros B");
    const ajeno = await addMember(ctx, b, { name: "Ajeno" });
    const list = (await api(a.slug, a.token).get("/admin/members")).body as ListBody;
    expect(list.items.map((m) => m.name)).not.toContain("Ajeno");
    expect((await api(a.slug, a.token).get(`/admin/members/${ajeno.membership.id}`)).status).toBe(
      404,
    );
  });

  it("exige members.view (o members.manage)", async () => {
    const ws = await createWorkspace(ctx, "Miembros permisos listado");
    const plain = await addMember(ctx, ws);
    expect((await api(ws.slug, plain.token).get("/admin/members")).status).toBe(403);
    const viewer = await withCapabilities(ws, ["members.view"]);
    expect((await api(ws.slug, viewer.token).get("/admin/members")).status).toBe(200);
    const ficha = await api(ws.slug, viewer.token).get(`/admin/members/${plain.membership.id}`);
    expect(memberOf(ficha)).toMatchObject({ id: plain.membership.id, roleBase: "MEMBER" });
    // Ver no es modificar.
    expect(
      (
        await api(ws.slug, viewer.token).patch(`/admin/members/${plain.membership.id}`, {
          jobTitle: "x",
        })
      ).status,
    ).toBe(403);
  });

  it("registra el último acceso al usar el workspace", async () => {
    const ws = await createWorkspace(ctx, "Miembros último acceso");
    const person = await addMember(ctx, ws);
    expect(
      (await ctx.prisma.membership.findUniqueOrThrow({ where: { id: person.membership.id } }))
        .lastSeenAt,
    ).toBeNull();
    await api(ws.slug, person.token).get("");
    const row = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: person.membership.id },
    });
    expect(row.lastSeenAt).not.toBeNull();
  });
});

describe("cambios de rol, plaza, puesto y departamentos", () => {
  it("cambia rol, puesto y departamentos, y lo deja en la auditoría", async () => {
    const ws = await createWorkspace(ctx, "Miembros cambios");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws, { name: "Persona" });
    const quality = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    const production = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Producción" },
    });
    const role = await customRole(ws, "Responsable de Calidad", ["documents.approve"]);

    const res = await a.patch(`/admin/members/${person.membership.id}`, {
      roleId: role.id,
      jobTitle: "Responsable",
      departmentIds: [quality.id, production.id],
    });
    expect(res.status).toBe(200);
    expect(memberOf(res)).toMatchObject({
      roleName: "Responsable de Calidad",
      jobTitle: "Responsable",
      seatType: "FULL",
    });
    expect(memberOf(res).departments.map((d) => d.name)).toEqual(["Calidad", "Producción"]);

    const only = await a.patch(`/admin/members/${person.membership.id}`, {
      departmentIds: [production.id],
    });
    expect(memberOf(only).departments.map((d) => d.name)).toEqual(["Producción"]);
    const cleared = await a.patch(`/admin/members/${person.membership.id}`, {
      departmentIds: [],
      jobTitle: null,
    });
    expect(memberOf(cleared)).toMatchObject({ departments: [], jobTitle: null });

    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "member.update" },
      }),
    ).toBe(3);
  });

  it("valida el cuerpo y que el rol y los departamentos sean del workspace", async () => {
    const ws = await createWorkspace(ctx, "Miembros validación");
    const other = await createWorkspace(ctx, "Miembros validación ajeno");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws);
    const base = `/admin/members/${person.membership.id}`;
    expect((await a.patch(base, {})).status).toBe(400);
    expect((await a.patch(base, { extra: 1 })).status).toBe(400);
    expect((await a.patch(base, { seatType: "ENORME" })).status).toBe(400);
    const foreignRole = await systemRole(other, "MEMBER");
    expect((await a.patch(base, { roleId: foreignRole.id })).status).toBe(404);
    const foreignDepartment = await ctx.prisma.department.create({
      data: { workspaceId: other.workspaceId, name: "Ajeno" },
    });
    expect((await a.patch(base, { departmentIds: [foreignDepartment.id] })).status).toBe(404);
    expect((await a.patch("/admin/members/inexistente", { jobTitle: "x" })).status).toBe(404);
  });

  it("un rol administrativo pasa a plaza completa (sin límite de plazas)", async () => {
    const ws = await createWorkspace(ctx, "Miembros plaza admin");
    const a = api(ws.slug, ws.token);
    const reader = await addMember(ctx, ws, { seatType: "READER" });
    const admin = await systemRole(ws, "ADMIN");
    const ok = await a.patch(`/admin/members/${reader.membership.id}`, { roleId: admin.id });
    expect(memberOf(ok)).toMatchObject({ roleBase: "ADMIN", seatType: "FULL" });
  });

  it("un lector no recibe un rol administrativo con plaza de lector explícita", async () => {
    const ws = await createWorkspace(ctx, "Miembros lector explícito");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws);
    const admin = await systemRole(ws, "ADMIN");
    const res = await a.patch(`/admin/members/${person.membership.id}`, {
      roleId: admin.id,
      seatType: "READER",
    });
    expect(res.status).toBe(400);
  });

  it("al pasar a invitado externo es lector y deja los departamentos", async () => {
    const ws = await createWorkspace(ctx, "Miembros a invitado");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws);
    const quality = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    await a.patch(`/admin/members/${person.membership.id}`, { departmentIds: [quality.id] });
    const guest = await systemRole(ws, "GUEST");
    const res = await a.patch(`/admin/members/${person.membership.id}`, { roleId: guest.id });
    expect(memberOf(res)).toMatchObject({ roleBase: "GUEST", seatType: "READER", departments: [] });
    const withDepartment = await a.patch(`/admin/members/${person.membership.id}`, {
      departmentIds: [quality.id],
    });
    expect(withDepartment.status).toBe(400);
  });

  it("cambiar la plaza no tiene límite: a completa y a lector", async () => {
    const ws = await createWorkspace(ctx, "Miembros cambio de plaza");
    const a = api(ws.slug, ws.token);
    const one = await addMember(ctx, ws, { seatType: "FULL" });
    const two = await addMember(ctx, ws, { seatType: "READER" });
    expect(
      memberOf(await a.patch(`/admin/members/${one.membership.id}`, { seatType: "READER" }))
        .seatType,
    ).toBe("READER");
    expect(
      memberOf(await a.patch(`/admin/members/${two.membership.id}`, { seatType: "FULL" })).seatType,
    ).toBe("FULL");
  });

  it("nadie se da capacidades que no tiene ni toca a quien está por encima", async () => {
    const ws = await createWorkspace(ctx, "Miembros escalada");
    // Administra personas pero no la seguridad: no puede dar un rol que sí la tiene.
    const admin = await withCapabilities(ws, ["members.view", "members.manage"]);
    const security = await customRole(ws, "Seguridad", ["security.manage"]);
    const person = await addMember(ctx, ws);
    const a = api(ws.slug, admin.token);
    expect(
      (await a.patch(`/admin/members/${person.membership.id}`, { roleId: security.id })).status,
    ).toBe(403);
    // El rol de propietario no se asigna por acá, ni siquiera el propietario.
    const owner = await systemRole(ws, "OWNER");
    expect(
      (
        await api(ws.slug, ws.token).patch(`/admin/members/${person.membership.id}`, {
          roleId: owner.id,
        })
      ).status,
    ).toBe(403);
    // Un administrador no modifica al propietario.
    expect((await a.patch(`/admin/members/${ws.membershipId}`, { jobTitle: "Jefe" })).status).toBe(
      403,
    );
    expect((await a.post(`/admin/members/${ws.membershipId}/suspend`)).status).toBe(403);
    expect((await a.delete(`/admin/members/${ws.membershipId}`)).status).toBe(403);
  });

  it("el único propietario no puede bajarse el rol", async () => {
    const ws = await createWorkspace(ctx, "Miembros último propietario");
    const member = await systemRole(ws, "MEMBER");
    const res = await api(ws.slug, ws.token).patch(`/admin/members/${ws.membershipId}`, {
      roleId: member.id,
    });
    expect(res.status).toBe(409);
    expect(errorOf(res).message).toContain("propietario");
  });

  it("con otro propietario activo, uno puede bajarle el rol al otro", async () => {
    const ws = await createWorkspace(ctx, "Miembros dos propietarios");
    const second = await addMember(ctx, ws, { base: "OWNER" });
    const member = await systemRole(ws, "MEMBER");
    const res = await api(ws.slug, second.token).patch(`/admin/members/${ws.membershipId}`, {
      roleId: member.id,
    });
    expect(res.status).toBe(200);
    expect(memberOf(res).roleBase).toBe("MEMBER");
  });
});

describe("suspender, reactivar y quitar", () => {
  it("suspender deja a la persona fuera del workspace y libera la plaza; reactivar la devuelve", async () => {
    const ws = await createWorkspace(ctx, "Miembros suspender");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws);
    expect((await api(ws.slug, person.token).get("")).status).toBe(200);
    const seatsBefore = (await a.get("/admin/seats")).body as { seats: { FULL: { used: number } } };

    const suspended = await a.post(`/admin/members/${person.membership.id}/suspend`);
    expect(memberOf(suspended).status).toBe("SUSPENDED");
    expect((await api(ws.slug, person.token).get("")).status).toBe(404);
    const seatsAfter = (await a.get("/admin/seats")).body as { seats: { FULL: { used: number } } };
    expect(seatsAfter.seats.FULL.used).toBe(seatsBefore.seats.FULL.used - 1);
    expect((await a.post(`/admin/members/${person.membership.id}/suspend`)).status).toBe(409);

    const back = await a.post(`/admin/members/${person.membership.id}/reactivate`);
    expect(memberOf(back).status).toBe("ACTIVE");
    expect((await api(ws.slug, person.token).get("")).status).toBe(200);
    expect((await a.post(`/admin/members/${person.membership.id}/reactivate`)).status).toBe(409);
  });

  it("no se puede suspender ni quitar la propia cuenta", async () => {
    const ws = await createWorkspace(ctx, "Miembros propia cuenta");
    const a = api(ws.slug, ws.token);
    expect((await a.post(`/admin/members/${ws.membershipId}/suspend`)).status).toBe(400);
    expect((await a.delete(`/admin/members/${ws.membershipId}`)).status).toBe(400);
  });

  it("reactivar no depende de plazas libres (sin límite)", async () => {
    const ws = await createWorkspace(ctx, "Miembros reactivar sin límite");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws, { status: "SUSPENDED" });
    await addMember(ctx, ws);
    const res = await a.post(`/admin/members/${person.membership.id}/reactivate`);
    expect(res.status).toBe(200);
  });

  it("quitar borra la membresía (no la cuenta) y deja sin responsable a su departamento", async () => {
    const ws = await createWorkspace(ctx, "Miembros quitar");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws);
    const heir = await addMember(ctx, ws, { name: "Heredera" });
    const department = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: department.id,
        membershipId: person.membership.id,
        position: "HEAD",
      },
    });

    // La persona a quien se transfiere tiene que ser un miembro activo distinto.
    expect(
      (
        await a.delete(`/admin/members/${person.membership.id}`, {
          transferToMembershipId: person.membership.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await a.delete(`/admin/members/${person.membership.id}`, {
          transferToMembershipId: "inexistente",
        })
      ).status,
    ).toBe(400);

    const res = await a.delete(`/admin/members/${person.membership.id}`, {
      transferToMembershipId: heir.membership.id,
    });
    expect(res.status).toBe(204);
    expect(await ctx.prisma.membership.count({ where: { id: person.membership.id } })).toBe(0);
    expect(await ctx.prisma.user.count({ where: { id: person.user.id } })).toBe(1);
    expect(
      await ctx.prisma.departmentMember.count({ where: { departmentId: department.id } }),
    ).toBe(0);
    expect((await api(ws.slug, person.token).get("")).status).toBe(404);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "member.remove" },
      }),
    ).toBe(1);
    expect((await a.delete(`/admin/members/${person.membership.id}`)).status).toBe(404);
  });

  it("cerrar las sesiones revoca las de la cuenta", async () => {
    const ws = await createWorkspace(ctx, "Miembros sesiones");
    const a = api(ws.slug, ws.token);
    const person = await addMember(ctx, ws);
    expect((await api(ws.slug, person.token).get("")).status).toBe(200);
    const res = await a.post(`/admin/members/${person.membership.id}/revoke-sessions`);
    expect(res.status).toBe(200);
    expect((res.body as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
    expect((await api(ws.slug, person.token).get("")).status).toBe(401);
  });

  it("suspender y quitar piden sus capacidades", async () => {
    const ws = await createWorkspace(ctx, "Miembros permisos acciones");
    const person = await addMember(ctx, ws);
    const manager = await withCapabilities(ws, ["members.view", "members.manage"]);
    const suspender = await withCapabilities(ws, ["members.view", "members.suspend"]);
    expect(
      (await api(ws.slug, manager.token).post(`/admin/members/${person.membership.id}/suspend`))
        .status,
    ).toBe(403);
    expect(
      (
        await api(ws.slug, suspender.token).patch(`/admin/members/${person.membership.id}`, {
          jobTitle: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (await api(ws.slug, suspender.token).delete(`/admin/members/${person.membership.id}`)).status,
    ).toBe(403);
    expect(
      (await api(ws.slug, suspender.token).post(`/admin/members/${person.membership.id}/suspend`))
        .status,
    ).toBe(200);
  });
});

describe("acciones masivas", () => {
  it("informa el resultado por persona y no corta por un error", async () => {
    const ws = await createWorkspace(ctx, "Miembros masivas");
    const a = api(ws.slug, ws.token);
    const one = await addMember(ctx, ws);
    const two = await addMember(ctx, ws);
    const quality = await customRole(ws, "Calidad", ["audit.view"]);

    // El dueño (propio) es el único que no se puede suspender: la acción sigue con el resto.
    const suspend = await a.post("/admin/members/bulk", {
      ids: [one.membership.id, ws.membershipId, two.membership.id],
      action: { type: "suspend" },
    });
    expect(suspend.status).toBe(200);
    const body = suspend.body as {
      succeeded: number;
      failed: number;
      results: { id: string; ok: boolean; code?: string }[];
    };
    expect(body).toMatchObject({ succeeded: 2, failed: 1 });
    expect(body.results.find((r) => r.id === ws.membershipId)).toMatchObject({
      ok: false,
      code: "BAD_REQUEST",
    });

    const reactivate = await a.post("/admin/members/bulk", {
      ids: [one.membership.id, two.membership.id],
      action: { type: "reactivate" },
    });
    expect((reactivate.body as { succeeded: number }).succeeded).toBe(2);

    const role = await a.post("/admin/members/bulk", {
      ids: [one.membership.id, two.membership.id],
      action: { type: "change_role", roleId: quality.id },
    });
    expect((role.body as { succeeded: number }).succeeded).toBe(2);
    const list = (await a.get(`/admin/members?role=${quality.id}`)).body as ListBody;
    expect(list.total).toBe(2);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "member.bulk" },
      }),
    ).toBe(3);
  });

  it("agrega, quita y reemplaza departamentos en bloque", async () => {
    const ws = await createWorkspace(ctx, "Miembros masivas departamentos");
    const a = api(ws.slug, ws.token);
    const one = await addMember(ctx, ws);
    const two = await addMember(ctx, ws);
    const calidad = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    const produccion = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Producción" },
    });
    const ids = [one.membership.id, two.membership.id];
    const names = async (membershipId: string) =>
      memberOf(await a.get(`/admin/members/${membershipId}`)).departments.map((d) => d.name);

    await a.post("/admin/members/bulk", {
      ids,
      action: { type: "change_departments", mode: "add", departmentIds: [calidad.id] },
    });
    expect(await names(one.membership.id)).toEqual(["Calidad"]);
    await a.post("/admin/members/bulk", {
      ids,
      action: { type: "change_departments", mode: "add", departmentIds: [produccion.id] },
    });
    expect(await names(one.membership.id)).toEqual(["Calidad", "Producción"]);
    await a.post("/admin/members/bulk", {
      ids,
      action: { type: "change_departments", mode: "remove", departmentIds: [calidad.id] },
    });
    expect(await names(two.membership.id)).toEqual(["Producción"]);
    await a.post("/admin/members/bulk", {
      ids,
      action: { type: "change_departments", mode: "set", departmentIds: [calidad.id] },
    });
    expect(await names(two.membership.id)).toEqual(["Calidad"]);
  });

  it("valida el cuerpo y las capacidades de cada acción", async () => {
    const ws = await createWorkspace(ctx, "Miembros masivas permisos");
    const person = await addMember(ctx, ws);
    const manager = await withCapabilities(ws, ["members.view", "members.manage"]);
    const m = api(ws.slug, manager.token);
    expect(
      (await m.post("/admin/members/bulk", { ids: [], action: { type: "suspend" } })).status,
    ).toBe(400);
    expect(
      (await m.post("/admin/members/bulk", { ids: ["x"], action: { type: "borrar" } })).status,
    ).toBe(400);
    // members.manage no alcanza para suspender en bloque.
    const res = await m.post("/admin/members/bulk", {
      ids: [person.membership.id],
      action: { type: "suspend" },
    });
    expect(res.status).toBe(403);
  });
});

describe("plaza en bloque", () => {
  it("cambia la plaza por persona (sin límite de plazas)", async () => {
    const ws = await createWorkspace(ctx, "Miembros plaza masiva");
    const a = api(ws.slug, ws.token);
    const one = await addMember(ctx, ws, { seatType: "READER" });
    const two = await addMember(ctx, ws, { seatType: "READER" });
    const res = await a.post("/admin/members/bulk", {
      ids: [one.membership.id, two.membership.id],
      action: { type: "change_seat", seatType: "FULL" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ succeeded: 2, failed: 0 });

    const back = await a.post("/admin/members/bulk", {
      ids: [one.membership.id, two.membership.id],
      action: { type: "change_seat", seatType: "READER" },
    });
    expect((back.body as { succeeded: number }).succeeded).toBe(2);
    expect(
      (await a.post("/admin/members/bulk", { ids: ["x"], action: { type: "change_seat" } })).status,
    ).toBe(400);
  });
});

describe("exportación a CSV", () => {
  it("exporta la lista filtrada, sin mezclar workspaces, y lo deja en la auditoría", async () => {
    const ws = await createWorkspace(ctx, "Miembros exportar");
    const other = await createWorkspace(ctx, "Miembros exportar otro");
    const a = api(ws.slug, ws.token);
    await addMember(ctx, ws, { name: "Ana Pérez" });
    await addMember(ctx, ws, { name: 'Beto, el "Jefe"', status: "SUSPENDED" });
    await addMember(ctx, ws, { name: '=HYPERLINK("http://x")' });
    await addMember(ctx, other, { name: "Ajena Total" });

    const all = await a.get("/admin/members/export");
    expect(all.status).toBe(200);
    const { csv, filename, rows } = all.body as { csv: string; filename: string; rows: number };
    expect(filename).toMatch(/^miembros-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows).toBe(4);
    expect(csv.startsWith("﻿Nombre,Email,Usuario,Cargo,Rol,Plaza,Estado,Departamentos")).toBe(true);
    expect(csv).toContain("Ana Pérez");
    expect(csv).not.toContain("Ajena Total");
    // Comillas y comas escapadas; una celda que empieza con "=" no queda como fórmula.
    expect(csv).toContain('"Beto, el ""Jefe"""');
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);

    const suspended = (await a.get("/admin/members/export?status=SUSPENDED")).body as {
      csv: string;
      rows: number;
    };
    expect(suspended.rows).toBe(1);
    expect(suspended.csv).toContain("Suspendido");
    expect(suspended.csv).not.toContain("Ana Pérez");
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "member.export" },
      }),
    ).toBe(2);
  });

  it("exige members.view (o members.manage) y valida los filtros", async () => {
    const ws = await createWorkspace(ctx, "Miembros exportar permisos");
    const plain = await addMember(ctx, ws);
    expect((await api(ws.slug, plain.token).get("/admin/members/export")).status).toBe(403);
    const viewer = await withCapabilities(ws, ["members.view"]);
    expect((await api(ws.slug, viewer.token).get("/admin/members/export")).status).toBe(200);
    expect((await api(ws.slug, ws.token).get("/admin/members/export?status=NOPE")).status).toBe(
      400,
    );
  });
});

describe("importación desde CSV", () => {
  async function verifiedWorkspace(name: string) {
    const ws = await createWorkspace(ctx, name);
    await ctx.prisma.user.update({
      where: { id: ws.owner.id },
      data: { emailVerifiedAt: new Date() },
    });
    return ws;
  }

  it("la vista previa valida cada fila y la confirmación invita a las válidas", async () => {
    const ws = await verifiedWorkspace("Miembros importar");
    const a = api(ws.slug, ws.token);
    await ctx.prisma.department.create({ data: { workspaceId: ws.workspaceId, name: "Calidad" } });
    await customRole(ws, "Calidad", ["audit.view"]);
    const existing = await addMember(ctx, ws);
    const pendingEmail = uniqueEmail("pendiente");
    const memberRole = await systemRole(ws, "MEMBER");
    await a.post("/admin/invitations", { emails: [pendingEmail], roleId: memberRole.id });

    const okA = uniqueEmail("ok-a");
    const okB = uniqueEmail("ok-b");
    const csv = [
      "email,rol,departamentos,plaza",
      `${okA},Miembro,Calidad,`,
      `${okB},Calidad,,full`,
      `${existing.user.email},Miembro,,`,
      `${pendingEmail},Miembro,,`,
      "no-es-un-email,Miembro,,",
      `${okA},Miembro,,`,
      `${uniqueEmail("rol")},Inventado,,`,
      `${uniqueEmail("dep")},Miembro,Marte,`,
      `${uniqueEmail("prop")},Propietario,,`,
      `${uniqueEmail("inv")},Invitado,Calidad,`,
      `${uniqueEmail("plaza")},Miembro,,gigante`,
    ].join("\n");

    const preview = await a.post("/admin/members/import", { csv });
    expect(preview.status).toBe(200);
    const body = preview.body as {
      rows: { line: number; status: string; reason?: string; roleName?: string }[];
      summary: { ok: number; skip: number; error: number };
    };
    expect(body.summary).toEqual({ ok: 2, skip: 2, error: 7 });
    const reasons = body.rows.map((r) => r.reason ?? r.status);
    expect(reasons).toEqual([
      "ok",
      "ok",
      "already_member",
      "already_invited",
      "invalid_email",
      "duplicate_in_file",
      "unknown_role",
      "unknown_department",
      "role_not_allowed",
      "guest_departments",
      "invalid_seat",
    ]);
    expect(body.rows[0]?.roleName).toBe("Miembro");
    // La vista previa no crea nada.
    expect(await ctx.prisma.invitation.count({ where: { workspaceId: ws.workspaceId } })).toBe(1);

    const confirmed = await a.post("/admin/members/import/confirm", { csv });
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as { invited: number }).invited).toBe(2);
    const invited = await ctx.prisma.invitation.findMany({
      where: { workspaceId: ws.workspaceId, email: { in: [okA, okB] } },
      include: { role: true },
    });
    expect(invited.map((i) => i.role.name).sort()).toEqual(["Calidad", "Miembro"]);
    expect(invited.find((i) => i.email === okA)?.departmentIds).toHaveLength(1);
    // Repetir la confirmación no duplica: ya están invitadas.
    const again = await a.post("/admin/members/import/confirm", { csv });
    expect((again.body as { invited: number }).invited).toBe(0);
  });

  it("rechaza archivos sin columna de email, vacíos o demasiado grandes", async () => {
    const ws = await verifiedWorkspace("Miembros importar inválido");
    const a = api(ws.slug, ws.token);
    expect((await a.post("/admin/members/import", { csv: "nombre,rol\nAna,Miembro" })).status).toBe(
      400,
    );
    expect((await a.post("/admin/members/import", { csv: "email\n" })).status).toBe(400);
    const big = [
      "email",
      ...Array.from({ length: 501 }, (_, i) => `p${String(i)}@test.local`),
    ].join("\n");
    expect((await a.post("/admin/members/import", { csv: big })).status).toBe(400);
    expect((await a.post("/admin/members/import", { csv: "" })).status).toBe(400);
    expect((await a.post("/admin/members/import", { csv: "email", extra: 1 })).status).toBe(400);
  });

  it("la confirmación no depende de plazas libres (sin límite)", async () => {
    const ws = await verifiedWorkspace("Miembros importar sin límite");
    const a = api(ws.slug, ws.token);
    const csv = ["email", uniqueEmail(), uniqueEmail()].join("\n");
    const res = await a.post("/admin/members/import/confirm", { csv });
    expect(res.status).toBeLessThan(300);
    expect(await ctx.prisma.invitation.count({ where: { workspaceId: ws.workspaceId } })).toBe(2);
  });

  it("exige members.invite", async () => {
    const ws = await verifiedWorkspace("Miembros importar permisos");
    const manager = await withCapabilities(ws, ["members.view", "members.manage"]);
    expect(
      (
        await api(ws.slug, manager.token).post("/admin/members/import", {
          csv: "email\na@test.local",
        })
      ).status,
    ).toBe(403);
  });
});
