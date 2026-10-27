// Jefe de departamento (docs/spec/personas.md): el cargo (jefe o subjefe) es la única fuente de sus
// permisos, sobre su departamento y subáreas. No hay un rol "Jefe de departamento".
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
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
  put: (path: string, body?: object) =>
    request(app)
      .put(`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  patch: (path: string, body?: object) =>
    request(app)
      .patch(`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  delete: (path: string) =>
    request(app).delete(`/api/v1/w/${ws.slug}${path}`).set("Authorization", `Bearer ${token}`),
});

interface PatchBody {
  department: { id: string; head: { membershipId: string } | null };
  needsFullSeat: boolean;
}
interface Paged<T> {
  items: T[];
  total: number;
}

async function department(ws: TestWorkspace, name: string) {
  return await ctx.prisma.department.create({ data: { workspaceId: ws.workspaceId, name } });
}

async function inDepartment(
  ws: TestWorkspace,
  departmentId: string,
  members: { membership: { id: string } }[],
) {
  await ctx.prisma.departmentMember.createMany({
    data: members.map((m) => ({
      workspaceId: ws.workspaceId,
      departmentId,
      membershipId: m.membership.id,
    })),
  });
}

/** Workspace con dos departamentos, una jefa (por cargo, con rol Miembro) y personas. */
async function setup(label: string) {
  const ws = await createWorkspace(ctx, label);
  const owner = api(ws, ws.token);
  const calidad = await department(ws, "Calidad");
  const compras = await department(ws, "Compras");
  const boss = await addMember(ctx, ws, { name: "Jefa de Calidad" });
  const ana = await addMember(ctx, ws, { name: "Ana" });
  const luis = await addMember(ctx, ws, { name: "Luis" });
  await inDepartment(ws, calidad.id, [boss, ana]);
  await inDepartment(ws, compras.id, [luis]);
  const granted = await owner.patch(`/admin/departments/${calidad.id}`, {
    headId: boss.membership.id,
  });
  expect(granted.status).toBe(200);
  return { ws, owner, calidad, compras, boss, ana, luis, granted: granted.body as PatchBody };
}

describe("el cargo es la única fuente de los permisos de jefe", () => {
  it('no existe un rol "Jefe de departamento": los roles de sistema son cuatro', async () => {
    const { ws, boss, granted } = await setup("Jefe sin rol de plantilla");
    expect(granted).toMatchObject({ needsFullSeat: false });
    expect(granted.department.head?.membershipId).toBe(boss.membership.id);
    const roles = await ctx.prisma.role.findMany({
      where: { workspaceId: ws.workspaceId, isSystem: true },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    expect(roles.map((r) => r.name)).toEqual([
      "Administrador",
      "Invitado",
      "Miembro",
      "Propietario",
    ]);
  });

  it("nombrar jefe no cambia el rol de la persona", async () => {
    const ws = await createWorkspace(ctx, "Jefe no cambia rol");
    const dept = await department(ws, "Calidad");
    const person = await addMember(ctx, ws);
    const res = await api(ws, ws.token).patch(`/admin/departments/${dept.id}`, {
      headId: person.membership.id,
    });
    expect(res.body).toMatchObject({ needsFullSeat: false });
    expect(
      (await ctx.prisma.membership.findUniqueOrThrow({ where: { id: person.membership.id } }))
        .roleId,
    ).toBe(person.role.id);
  });

  it("un lector nombrado jefe: avisa que hace falta plaza completa y no gana alcance", async () => {
    const ws = await createWorkspace(ctx, "Jefe lector");
    const dept = await department(ws, "Calidad");
    const reader = await addMember(ctx, ws, { seatType: "READER" });
    const plain = await api(ws, ws.token).patch(`/admin/departments/${dept.id}`, {
      headId: reader.membership.id,
    });
    expect(plain.body).toMatchObject({ needsFullSeat: true });
    expect((await api(ws, reader.token).get(`/admin/departments/${dept.id}/members`)).status).toBe(
      403,
    );
  });

  it("un administrador puede ser jefe sin que se le cambie el rol", async () => {
    const ws = await createWorkspace(ctx, "Jefe permisos");
    const dept = await department(ws, "Calidad");
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    const res = await api(ws, ws.token).patch(`/admin/departments/${dept.id}`, {
      headId: admin.membership.id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needsFullSeat: false });
    expect(
      (await ctx.prisma.membership.findUniqueOrThrow({ where: { id: admin.membership.id } }))
        .roleId,
    ).toBe(admin.role.id);
  });

  it("ya no se puede pedir el rol al nombrar jefe ni crear roles con capacidades .own", async () => {
    const ws = await createWorkspace(ctx, "Jefe sin .own");
    const dept = await department(ws, "Calidad");
    const person = await addMember(ctx, ws);
    const owner = api(ws, ws.token);
    expect(
      (
        await owner.patch(`/admin/departments/${dept.id}`, {
          headId: person.membership.id,
          grantManagerRole: true,
        })
      ).status,
    ).toBe(400);
    const role = await owner.post("/admin/roles", {
      name: "Con alcance",
      base: "MEMBER",
      capabilities: ["departments.members.own"],
    });
    expect(role.status).toBe(400);
    const info = (await owner.get("/admin/capabilities")).body as { all: string[] };
    expect(info.all).not.toContain("departments.members.own");
    expect(info.all).not.toContain("documents.approve.own");
  });
});

describe("capacidades con alcance", () => {
  it("el jefe gestiona a las personas de su departamento y lo deja en la auditoría", async () => {
    const { ws, boss, calidad, ana } = await setup("Alcance gestiona");
    const jefa = api(ws, boss.token);
    const members = (await jefa.get(`/admin/departments/${calidad.id}/members`)).body as Paged<{
      id: string;
    }>;
    expect(members.total).toBe(2);

    const nueva = await addMember(ctx, ws, { name: "Nueva" });
    const added = await jefa.post(`/admin/departments/${calidad.id}/members`, {
      membershipIds: [nueva.membership.id],
    });
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ added: 1 });
    expect(
      (await jefa.delete(`/admin/departments/${calidad.id}/members/${ana.membership.id}`)).status,
    ).toBe(204);
    const events = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: ws.workspaceId, action: { startsWith: "department.members" } },
    });
    expect(events.length).toBe(2);
    expect(events.every((e) => (e.metadata as { scope?: string } | null)?.scope === "own")).toBe(
      true,
    );
    expect(events.every((e) => e.actorId === boss.user.id)).toBe(true);
  });

  it("no rige en departamentos que no lidera", async () => {
    const { ws, owner, boss, compras, luis } = await setup("Alcance ajeno");
    const jefa = api(ws, boss.token);
    // Con "toda la empresa" lo ve (solo lectura), pero no lo gestiona: 403.
    const seen = await jefa.get(`/admin/departments/${compras.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ department: { access: "read" } });
    expect((await jefa.get(`/admin/departments/${compras.id}/members`)).status).toBe(403);
    expect(
      (
        await jefa.post(`/admin/departments/${compras.id}/members`, {
          membershipIds: [luis.membership.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (await jefa.delete(`/admin/departments/${compras.id}/members/${luis.membership.id}`)).status,
    ).toBe(403);
    // Si no lo ve (solo su departamento), no existe: 404.
    await owner.patch("/admin/security", { memberVisibility: "department" });
    expect((await jefa.get(`/admin/departments/${compras.id}`)).status).toBe(404);
    expect(
      (
        await jefa.post(`/admin/departments/${compras.id}/members`, {
          membershipIds: [luis.membership.id],
        })
      ).status,
    ).toBe(404);
  });

  it("mover personas exige liderar los dos departamentos", async () => {
    const { ws, owner, boss, calidad, compras, ana } = await setup("Alcance mover");
    const jefa = api(ws, boss.token);
    const toOther = await jefa.post(
      `/admin/departments/${calidad.id}/members/${ana.membership.id}/move`,
      { toDepartmentId: compras.id },
    );
    expect(toOther.status).toBe(403);

    const logistica = await department(ws, "Logística");
    await owner.patch(`/admin/departments/${logistica.id}`, { headId: boss.membership.id });
    const ok = await jefa.post(
      `/admin/departments/${calidad.id}/members/${ana.membership.id}/move`,
      { toDepartmentId: logistica.id },
    );
    expect(ok.status).toBe(204);
  });

  it("no toca a quien tiene un rol igual o superior: administradores, propietarios, otros jefes ni a sí mismo", async () => {
    const { ws, owner, boss, calidad, compras } = await setup("Alcance jerarquía");
    const jefa = api(ws, boss.token);
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    const otroJefe = await addMember(ctx, ws, { name: "Otro jefe" });
    await owner.patch(`/admin/departments/${compras.id}`, {
      headId: otroJefe.membership.id,
    });
    for (const target of [admin.membership.id, otroJefe.membership.id, boss.membership.id]) {
      const res = await jefa.post(`/admin/departments/${calidad.id}/members`, {
        membershipIds: [target],
      });
      expect(res.status, target).toBe(403);
    }
    expect(
      (await jefa.delete(`/admin/departments/${calidad.id}/members/${boss.membership.id}`)).status,
    ).toBe(403);
    // El propietario sí puede con cualquiera.
    expect(
      (
        await owner.post(`/admin/departments/${calidad.id}/members`, {
          membershipIds: [admin.membership.id],
        })
      ).status,
    ).toBe(200);
  });

  it("perder la jefatura quita el alcance al instante", async () => {
    const { ws, owner, boss, calidad } = await setup("Alcance se pierde");
    const jefa = api(ws, boss.token);
    expect((await jefa.get(`/admin/departments/${calidad.id}/members`)).status).toBe(200);
    await owner.patch(`/admin/departments/${calidad.id}`, { headId: null });
    expect((await jefa.get(`/admin/departments/${calidad.id}/members`)).status).toBe(403);
    // Lo sigue viendo (solo lectura), pero ya no lo gestiona.
    expect((await jefa.get(`/admin/departments/${calidad.id}`)).body).toMatchObject({
      department: { access: "read" },
    });
    // Su rol no cambió: solo perdió el alcance.
    const after = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: boss.membership.id },
      include: { role: true },
    });
    expect(after.role.name).toBe("Miembro");
  });

  it("el cargo da alcance por sí solo, sin necesidad de un rol especial", async () => {
    const ws = await createWorkspace(ctx, "Alcance sin rol");
    const dept = await department(ws, "Calidad");
    const person = await addMember(ctx, ws);
    await api(ws, ws.token).patch(`/admin/departments/${dept.id}`, {
      headId: person.membership.id,
    });
    const res = await api(ws, person.token).get(`/admin/departments/${dept.id}/members`);
    expect(res.status).toBe(200);
    // Sin cargo, nada: el alcance sale del cargo, no del rol.
    const plain = await addMember(ctx, ws);
    expect((await api(ws, plain.token).get(`/admin/departments/${dept.id}/members`)).status).toBe(
      403,
    );
  });

  it("no escala: un jefe no edita, borra ni crea departamentos ni da roles", async () => {
    const { ws, boss, calidad, ana } = await setup("Alcance escala");
    const jefa = api(ws, boss.token);
    expect((await jefa.patch(`/admin/departments/${calidad.id}`, { name: "Otro" })).status).toBe(
      403,
    );
    expect((await jefa.delete(`/admin/departments/${calidad.id}`)).status).toBe(403);
    expect((await jefa.post("/admin/departments", { name: "Nuevo" })).status).toBe(403);
    expect(
      (await jefa.patch(`/admin/members/${ana.membership.id}`, { jobTitle: "x" })).status,
    ).toBe(403);
  });

  it("la tabla de departamentos de quien solo tiene un cargo muestra los que lidera", async () => {
    const ws = await createWorkspace(ctx, "Alcance listado");
    const own = await department(ws, "Calidad");
    await department(ws, "Compras");
    const boss = await addMember(ctx, ws);
    await api(ws, ws.token).patch(`/admin/departments/${own.id}`, {
      headId: boss.membership.id,
    });
    const jefa = api(ws, boss.token);

    const led = (await jefa.get("/admin/departments?led=true")).body as Paged<{ name: string }>;
    expect(led.items.map((d) => d.name)).toEqual(["Calidad"]);
    const options = (await jefa.get("/admin/departments/options")).body as Paged<{ name: string }>;
    expect(options.items.map((d) => d.name)).toEqual(["Calidad"]);
    // Quien administra ve todos con led=false.
    const all = (await api(ws, ws.token).get("/admin/departments")).body as Paged<{ name: string }>;
    expect(all.total).toBe(2);
  });

  it("la ficha lista los departamentos que lidera", async () => {
    const { owner, boss } = await setup("Alcance ficha");
    const list = (await owner.get("/admin/members?group=managers")).body as Paged<{
      id: string;
      managedDepartments: { name: string }[];
    }>;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: boss.membership.id,
      managedDepartments: [{ name: "Calidad" }],
    });
  });
});

describe("cargos: jefe, subjefe y miembro", () => {
  it("un solo jefe por departamento: nombrar a otro pasa al anterior a miembro", async () => {
    const { ws, owner, calidad, boss, ana } = await setup("Cargo un jefe");
    const res = await owner.put(
      `/admin/departments/${calidad.id}/members/${ana.membership.id}/position`,
      { position: "HEAD" },
    );
    expect(res.status).toBe(200);
    const rows = await ctx.prisma.departmentMember.findMany({
      where: { departmentId: calidad.id },
    });
    expect(rows.filter((r) => r.position === "HEAD").map((r) => r.membershipId)).toEqual([
      ana.membership.id,
    ]);
    expect(rows.find((r) => r.membershipId === boss.membership.id)?.position).toBe("MEMBER");
    expect(ws.slug).toBeTruthy();
  });

  it("el índice único parcial impide dos jefes aunque se escriba directo", async () => {
    const { calidad, boss, ana } = await setup("Cargo índice");
    expect(boss.membership.id).not.toBe(ana.membership.id);
    await expect(
      ctx.prisma.departmentMember.update({
        where: {
          departmentId_membershipId: { departmentId: calidad.id, membershipId: ana.membership.id },
        },
        data: { position: "HEAD" },
      }),
    ).rejects.toThrow();
  });

  it("el subjefe tiene el mismo alcance que el jefe, subdepartamentos incluidos", async () => {
    const { ws, owner, calidad, ana } = await setup("Cargo subjefe");
    const hija = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Laboratorio", parentId: calidad.id },
    });
    const sub = await addMember(ctx, ws, { name: "Subjefa" });
    await inDepartment(ws, calidad.id, [sub]);
    const res = await owner.put(
      `/admin/departments/${calidad.id}/members/${sub.membership.id}/position`,
      { position: "DEPUTY" },
    );
    expect(res.status).toBe(200);
    const subjefa = api(ws, sub.token);
    expect((await subjefa.get(`/admin/departments/${calidad.id}/members`)).status).toBe(200);
    // Los subdepartamentos entran en su alcance.
    expect((await subjefa.get(`/admin/departments/${hija.id}/members`)).status).toBe(200);
    const added = await subjefa.post(`/admin/departments/${hija.id}/members`, {
      membershipIds: [ana.membership.id],
    });
    expect(added.status).toBe(200);
    // Un departamento fuera de su rama sigue vedado.
    const otro = await department(ws, "Mantenimiento");
    expect((await subjefa.get(`/admin/departments/${otro.id}/members`)).status).toBe(403);
  });

  it("el jefe también alcanza a los subdepartamentos, y salir del departamento quita el cargo", async () => {
    const { ws, owner, calidad, boss } = await setup("Cargo hijas");
    const hija = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Laboratorio", parentId: calidad.id },
    });
    expect((await api(ws, boss.token).get(`/admin/departments/${hija.id}/members`)).status).toBe(
      200,
    );
    await owner.delete(`/admin/departments/${calidad.id}/members/${boss.membership.id}`);
    expect((await api(ws, boss.token).get(`/admin/departments/${hija.id}/members`)).status).toBe(
      403,
    );
  });

  it("un administrador puede ser jefe y cuenta en la tarjeta de jefes", async () => {
    const ws = await createWorkspace(ctx, "Cargo admin jefe");
    const dept = await department(ws, "Back Office");
    const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Marta" });
    await api(ws, ws.token).patch(`/admin/departments/${dept.id}`, { headId: admin.membership.id });
    const summary = (await api(ws, ws.token).get("/admin/members/summary")).body as {
      managers: number;
      admins: number;
      total: number;
    };
    expect(summary).toMatchObject({ managers: 1, admins: 1, total: 2 });
  });
});
