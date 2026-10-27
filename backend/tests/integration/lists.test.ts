// Listas del panel (CLAUDE.md, sección 17): paginan, ordenan y filtran en el servidor. Jerarquía
// de Miembros, vista por departamento, departamentos, roles e invitaciones.
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

const api = (ws: Pick<TestWorkspace, "slug" | "token">) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${ws.slug}${path}`).set("Authorization", `Bearer ${ws.token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${ws.token}`)
      .send(body),
});

interface MemberBody {
  id: string;
  name: string;
  roleBase: string;
  seatType: string;
  managedDepartments: { id: string; name: string; position: string }[];
}
interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
const names = (list: { items: { name: string }[] }) => list.items.map((m) => m.name);

/** Dueño + administrador + jefe + dos miembros + lector, con nombres que ordenan al revés. */
async function hierarchyWorkspace(label: string) {
  const ws = await createWorkspace(ctx, label);
  const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Zoe Admin" });
  const manager = await addMember(ctx, ws, { name: "Yago Jefe" });
  const member1 = await addMember(ctx, ws, { name: "Xavi Miembro" });
  const member2 = await addMember(ctx, ws, { name: "Ana Miembro" });
  const reader = await addMember(ctx, ws, { name: "Bea Lectora", seatType: "READER" });
  const it = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "IT" },
  });
  await ctx.prisma.departmentMember.createMany({
    data: [manager, member1, member2].map((m) => ({
      workspaceId: ws.workspaceId,
      departmentId: it.id,
      membershipId: m.membership.id,
      position: m === manager ? ("HEAD" as const) : ("MEMBER" as const),
    })),
  });
  return { ws, admin, manager, member1, member2, reader, it };
}

describe("Miembros por jerarquía", () => {
  it("ordena propietario, administradores, jefes y el resto, y después por nombre", async () => {
    const { ws } = await hierarchyWorkspace("Lista jerarquía");
    const list = (await api(ws).get("/admin/members")).body as Paged<MemberBody>;
    expect(list.total).toBe(6);
    expect(names(list)).toEqual([
      "Dueño de Lista jerarquía",
      "Zoe Admin",
      "Yago Jefe",
      "Ana Miembro",
      "Bea Lectora",
      "Xavi Miembro",
    ]);
    expect(list.items[2]?.managedDepartments.map((d) => d.name)).toEqual(["IT"]);

    const reversed = (await api(ws).get("/admin/members?dir=desc")).body as Paged<MemberBody>;
    expect(names(reversed)).toEqual([...names(list)].reverse());
  });

  it("la paginación cruza los escalones sin repetir ni saltear a nadie", async () => {
    const { ws } = await hierarchyWorkspace("Lista jerarquía páginas");
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = (await api(ws).get(`/admin/members?pageSize=2&page=${String(page)}`))
        .body as Paged<MemberBody>;
      expect(res).toMatchObject({ total: 6, page, pageSize: 2 });
      seen.push(...names(res));
    }
    expect(seen).toEqual([
      "Dueño de Lista jerarquía páginas",
      "Zoe Admin",
      "Yago Jefe",
      "Ana Miembro",
      "Bea Lectora",
      "Xavi Miembro",
    ]);
    // Una página de más: vacía, con el total.
    const beyond = (await api(ws).get("/admin/members?pageSize=2&page=4"))
      .body as Paged<MemberBody>;
    expect(beyond).toMatchObject({ items: [], total: 6 });
  });

  it("filtra por grupo y el resumen da el total (la jefatura es un cargo, no suma)", async () => {
    const { ws, manager, reader } = await hierarchyWorkspace("Lista grupos");
    const group = async (name: string) =>
      (await api(ws).get(`/admin/members?group=${name}`)).body as Paged<MemberBody>;
    expect(names(await group("owner"))).toEqual(["Dueño de Lista grupos"]);
    expect(names(await group("admins"))).toEqual(["Zoe Admin"]);
    expect(names(await group("direction"))).toEqual(["Dueño de Lista grupos", "Zoe Admin"]);
    expect(names(await group("managers"))).toEqual(["Yago Jefe"]);
    expect(names(await group("readers"))).toEqual(["Bea Lectora"]);
    // Por rol y plaza: quien además es jefe sigue siendo miembro.
    expect(names(await group("members"))).toEqual(["Yago Jefe", "Ana Miembro", "Xavi Miembro"]);

    const summary = (await api(ws).get("/admin/members/summary")).body as Record<string, number>;
    expect(summary).toEqual({
      owners: 1,
      admins: 1,
      managers: 1,
      members: 3,
      readers: 1,
      total: 6,
    });
    expect(manager.membership.id).not.toBe(reader.membership.id);
    expect((await api(ws).get("/admin/members?group=otro")).status).toBe(400);
  });

  it("un administrador que lidera un departamento cuenta como administrador y como jefe", async () => {
    const { ws, admin, it } = await hierarchyWorkspace("Lista admin jefe");
    const back = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Back" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: back.id,
        membershipId: admin.membership.id,
        position: "HEAD",
      },
    });
    expect(it.id).toBeDefined();
    const summary = (await api(ws).get("/admin/members/summary")).body as Record<string, number>;
    expect(summary).toMatchObject({ admins: 1, managers: 2, total: 6 });
    const managers = (await api(ws).get("/admin/members?group=managers")).body as Paged<MemberBody>;
    expect(names(managers)).toEqual(["Zoe Admin", "Yago Jefe"]);
  });

  it("combina grupo con búsqueda y otros filtros", async () => {
    const { ws } = await hierarchyWorkspace("Lista combinada");
    const res = (await api(ws).get("/admin/members?group=members&q=xavi"))
      .body as Paged<MemberBody>;
    expect(names(res)).toEqual(["Xavi Miembro"]);
  });
});

describe("Organigrama: personas por departamento", () => {
  it("un bloque por departamento con jefe, subjefes y las primeras personas, y Sin departamento", async () => {
    const { ws, manager, member1, member2 } = await hierarchyWorkspace("Por depto");
    await ctx.prisma.department.create({ data: { workspaceId: ws.workspaceId, name: "Calidad" } });
    const res = (await api(ws).get("/admin/members/org-chart?preview=1")).body as {
      direction?: unknown;
      unassigned: { members: { items: MemberBody[]; total: number } };
      departments: Paged<{
        department: { name: string; memberCount: number };
        head: MemberBody | null;
        deputies: MemberBody[];
        members: { items: MemberBody[]; total: number };
      }>;
    };
    // Sin bloque "Dirección": dueño, administrador y lectora no tienen departamento.
    expect(res.direction).toBeUndefined();
    expect(res.unassigned.members.total).toBe(3);
    expect(res.unassigned.members.items).toHaveLength(1);
    expect(res.departments).toMatchObject({ total: 2, page: 1 });
    const [calidad, it] = res.departments.items;
    expect(calidad?.department.name).toBe("Calidad");
    expect(calidad?.head).toBeNull();
    expect(calidad?.members).toMatchObject({ items: [], total: 0 });
    expect(it?.head?.id).toBe(manager.membership.id);
    // El jefe cuenta como persona del departamento (3) pero va aparte de los miembros.
    expect(it?.department.memberCount).toBe(3);
    expect(it?.members.total).toBe(2);
    expect(it?.members.items.map((m) => m.id)).toEqual([member2.membership.id]);
    expect(member1.membership.id).toBeDefined();
  });

  it("pagina los departamentos y limita las personas por bloque", async () => {
    const ws = await createWorkspace(ctx, "Por depto páginas");
    for (const name of ["Compras", "Logística", "Producción"]) {
      await ctx.prisma.department.create({ data: { workspaceId: ws.workspaceId, name } });
    }
    const page2 = (await api(ws).get("/admin/members/org-chart?pageSize=2&page=2")).body as {
      departments: Paged<{ department: { name: string } }>;
    };
    expect(page2.departments).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page2.departments.items.map((b) => b.department.name)).toEqual(["Producción"]);
    expect((await api(ws).get("/admin/members/org-chart?preview=100")).status).toBe(400);
  });

  it('"Ver más": las personas de un departamento se piden de a páginas, solo miembros si se pide', async () => {
    const { ws, it, manager } = await hierarchyWorkspace("Ver más");
    const all = (await api(ws).get(`/admin/departments/${it.id}/members?pageSize=2`))
      .body as Paged<MemberBody>;
    expect(all).toMatchObject({ total: 3, pageSize: 2 });
    expect(names(all)).toEqual(["Ana Miembro", "Xavi Miembro"]);
    const page2 = (await api(ws).get(`/admin/departments/${it.id}/members?pageSize=2&page=2`))
      .body as Paged<MemberBody>;
    expect(names(page2)).toEqual(["Yago Jefe"]);
    const withoutBoss = (await api(ws).get(`/admin/departments/${it.id}/members?positions=members`))
      .body as Paged<MemberBody>;
    expect(withoutBoss.total).toBe(2);
    expect(withoutBoss.items.map((m) => m.id)).not.toContain(manager.membership.id);
    const search = (await api(ws).get(`/admin/departments/${it.id}/members?q=xavi`))
      .body as Paged<MemberBody>;
    expect(names(search)).toEqual(["Xavi Miembro"]);
  });
});

describe("Departamentos", () => {
  it("pagina, busca, filtra por padre y ordena por nombre o por personas", async () => {
    const ws = await createWorkspace(ctx, "Deptos lista");
    const root = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Planta" },
    });
    for (const name of ["Envasado", "Mantenimiento", "Recepción"]) {
      await ctx.prisma.department.create({
        data: { workspaceId: ws.workspaceId, name, parentId: root.id },
      });
    }
    const person = await addMember(ctx, ws);
    const envasado = await ctx.prisma.department.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, name: "Envasado" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: envasado.id,
        membershipId: person.membership.id,
      },
    });
    const get = async (query: string) =>
      (await api(ws).get(`/admin/departments?${query}`)).body as Paged<{
        name: string;
        memberCount: number;
      }>;
    const page = await get("pageSize=2&page=2");
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(names(page)).toEqual(["Planta", "Recepción"]);
    expect(names(await get("parent=" + root.id))).toEqual([
      "Envasado",
      "Mantenimiento",
      "Recepción",
    ]);
    expect(names(await get("parent=root"))).toEqual(["Planta"]);
    expect(names(await get("q=ENVA"))).toEqual(["Envasado"]);
    expect(names(await get("sort=members&dir=desc")).at(0)).toBe("Envasado");
    expect((await get("sort=members&dir=desc")).items[0]?.memberCount).toBe(1);
    expect((await api(ws).get("/admin/departments?pageSize=101")).status).toBe(400);
  });

  it("options trae hasta 100 para los selectores, filtrables por nombre", async () => {
    const ws = await createWorkspace(ctx, "Deptos options");
    await ctx.prisma.department.createMany({
      data: ["Alfa", "Beta"].map((name) => ({ workspaceId: ws.workspaceId, name })),
    });
    const all = (await api(ws).get("/admin/departments/options")).body as Paged<{
      id: string;
      name: string;
    }>;
    expect(names(all)).toEqual(["Alfa", "Beta"]);
    expect(
      names((await api(ws).get("/admin/departments/options?q=bet")).body as typeof all),
    ).toEqual(["Beta"]);
    expect(
      names((await api(ws).get("/admin/departments/options?pageSize=1&page=2")).body as typeof all),
    ).toEqual(["Beta"]);
    const beta = all.items[1];
    expect(
      names(
        (await api(ws).get(`/admin/departments/options?ids=${beta?.id ?? ""}`)).body as typeof all,
      ),
    ).toEqual(["Beta"]);
  });

  it("mueve a una persona de un departamento a otro; el jefe pierde el cargo en el de origen", async () => {
    const { ws, it, manager, member1 } = await hierarchyWorkspace("Mover persona");
    const calidad = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Calidad" },
    });
    const a = api(ws);
    // Mover a una persona común.
    const moved = await a.post(
      `/admin/departments/${it.id}/members/${member1.membership.id}/move`,
      {
        toDepartmentId: calidad.id,
      },
    );
    expect(moved.status).toBe(204);
    const inCalidad = (await a.get(`/admin/departments/${calidad.id}/members`))
      .body as Paged<MemberBody>;
    expect(inCalidad.items.map((m) => m.id)).toEqual([member1.membership.id]);
    expect(
      ((await a.get(`/admin/departments/${it.id}/members`)).body as Paged<MemberBody>).items.map(
        (m) => m.id,
      ),
    ).not.toContain(member1.membership.id);

    // Mover al jefe: el de origen queda sin jefe y en el nuevo entra sin cargo.
    await a.post(`/admin/departments/${it.id}/members/${manager.membership.id}/move`, {
      toDepartmentId: calidad.id,
    });
    expect(
      await ctx.prisma.departmentMember.count({ where: { departmentId: it.id, position: "HEAD" } }),
    ).toBe(0);
    expect(
      (
        await ctx.prisma.departmentMember.findUniqueOrThrow({
          where: {
            departmentId_membershipId: {
              departmentId: calidad.id,
              membershipId: manager.membership.id,
            },
          },
        })
      ).position,
    ).toBe("MEMBER");

    // Al mismo departamento, a uno inexistente o con alguien que no está: error.
    expect(
      (
        await a.post(`/admin/departments/${calidad.id}/members/${member1.membership.id}/move`, {
          toDepartmentId: calidad.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await a.post(`/admin/departments/${calidad.id}/members/${member1.membership.id}/move`, {
          toDepartmentId: "no-existe",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await a.post(`/admin/departments/${it.id}/members/${member1.membership.id}/move`, {
          toDepartmentId: calidad.id,
        })
      ).status,
    ).toBe(404);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: ws.workspaceId, action: "department.members.move" },
      }),
    ).toBe(2);
  });
});

describe("Roles", () => {
  it("pagina, busca, filtra por tipo y ordena; options trae todos para los selectores", async () => {
    const ws = await createWorkspace(ctx, "Roles lista");
    for (const name of ["Auditor", "Calidad", "Compras"]) {
      await ctx.prisma.role.create({
        data: { workspaceId: ws.workspaceId, name, base: "MEMBER", capabilities: [] },
      });
    }
    const get = async (query: string) =>
      (await api(ws).get(`/admin/roles?${query}`)).body as Paged<{
        name: string;
        isSystem: boolean;
      }>;
    const first = await get("pageSize=5");
    expect(first).toMatchObject({ total: 7, pageSize: 5 });
    // Nivel: los de sistema primero (propietario, administrador, miembro, invitado).
    expect(names(first).slice(0, 4)).toEqual([
      "Propietario",
      "Administrador",
      "Miembro",
      "Invitado",
    ]);
    expect(names(await get("pageSize=5&page=2"))).toHaveLength(2);
    expect(names(await get("kind=custom&sort=name"))).toEqual(["Auditor", "Calidad", "Compras"]);
    expect(names(await get("kind=system"))).toHaveLength(4);
    expect(names(await get("q=ca&kind=custom"))).toEqual(["Calidad"]);
    expect(names(await get("kind=custom&sort=name&dir=desc"))[0]).toBe("Compras");
    expect((await get("sort=members&dir=desc")).items[0]?.name).toBe("Propietario");
    const options = (await api(ws).get("/admin/roles/options?pageSize=100")).body as Paged<{
      name: string;
    }>;
    expect(options.total).toBe(7);
    expect(names(options).slice(0, 2)).toEqual(["Propietario", "Administrador"]);
    expect(names((await api(ws).get("/admin/roles/options?q=ca")).body as typeof options)).toEqual([
      "Calidad",
    ]);
    expect((await api(ws).get("/admin/roles?sort=capabilities")).status).toBe(400);
  });
});

describe("Invitaciones", () => {
  it("pagina, busca por email y filtra por estado", async () => {
    const ws = await createWorkspace(ctx, "Invitaciones lista");
    await ctx.prisma.user.update({
      where: { id: ws.owner.id },
      data: { emailVerifiedAt: new Date() },
    });
    const a = api(ws);
    const role = await ctx.prisma.role.findFirstOrThrow({
      where: {
        workspaceId: ws.workspaceId,
        base: "MEMBER",
        isSystem: true,
      },
    });
    const emails = ["ana@lista.test", "beto@lista.test", "carla@lista.test"];
    const created = await a.post("/admin/invitations", { emails, roleId: role.id });
    expect(created.status).toBe(201);
    await ctx.prisma.invitation.updateMany({
      where: { workspaceId: ws.workspaceId, email: "ana@lista.test" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const get = async (query: string) =>
      (await a.get(`/admin/invitations?${query}`)).body as Paged<{ email: string; status: string }>;
    const page = await get("pageSize=2&sort=email&dir=asc");
    expect(page).toMatchObject({ total: 3, pageSize: 2 });
    expect(page.items.map((i) => i.email)).toEqual(["ana@lista.test", "beto@lista.test"]);
    expect((await get("pageSize=2&sort=email&dir=asc&page=2")).items.map((i) => i.email)).toEqual([
      "carla@lista.test",
    ]);
    expect((await get("status=expired")).items.map((i) => i.email)).toEqual(["ana@lista.test"]);
    expect((await get("status=pending")).total).toBe(2);
    expect((await get("q=BETO")).items.map((i) => i.email)).toEqual(["beto@lista.test"]);
    expect((await a.get("/admin/invitations?sort=tokenHash")).status).toBe(400);
  });
});

describe("Organigrama", () => {
  it("trae la raíz con la empresa y el propietario, y las ramas se piden por padre", async () => {
    const { ws, it, manager } = await hierarchyWorkspace("Organigrama");
    const sub = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Soporte", parentId: it.id },
    });
    const root = (await api(ws).get("/admin/members/org-chart")).body as {
      company: { name: string; owner: { name: string } | null };
      departments: Paged<{
        department: { id: string; name: string; childCount: number };
        head: MemberBody | null;
      }>;
      unassigned: { members: { total: number } } | null;
    };
    expect(root.company.owner?.name).toBe("Dueño de Organigrama");
    expect(root.departments.items.map((b) => b.department.name)).toEqual(["IT"]);
    expect(root.departments.items[0]?.department.childCount).toBe(1);
    expect(root.departments.items[0]?.head?.id).toBe(manager.membership.id);
    expect(root.unassigned?.members.total).toBe(3);

    const branch = (await api(ws).get(`/admin/members/org-chart?parent=${it.id}`)).body as {
      departments: Paged<{ department: { id: string } }>;
      unassigned: unknown;
    };
    expect(branch.departments.items.map((b) => b.department.id)).toEqual([sub.id]);
    expect(branch.unassigned).toBeNull();
  });

  it("el buscador devuelve el camino desde la raíz hasta el departamento de la persona", async () => {
    const { ws, it, member1 } = await hierarchyWorkspace("Organigrama búsqueda");
    const sub = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Soporte", parentId: it.id },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: sub.id,
        membershipId: member1.membership.id,
      },
    });
    const res = (await api(ws).get("/admin/members/org-chart/search?q=xavi")).body as {
      hits: { membershipId: string; places: { departmentId: string; path: string[] }[] }[];
    };
    const hit = res.hits[0];
    expect(hit?.membershipId).toBe(member1.membership.id);
    expect(hit?.places.find((p) => p.departmentId === sub.id)?.path).toEqual([it.id, sub.id]);
    expect((await api(ws).get("/admin/members/org-chart/search?q=x")).status).toBe(400);
  });
});

describe("Departamentos como opciones de un selector", () => {
  it("sin búsqueda van en orden de árbol con su nivel; al buscar, con la ruta completa", async () => {
    const ws = await createWorkspace(ctx, "Opciones árbol");
    const finanzas = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Finanzas" },
    });
    await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Contabilidad", parentId: finanzas.id },
    });
    await ctx.prisma.department.create({ data: { workspaceId: ws.workspaceId, name: "Compras" } });
    interface Option {
      name: string;
      depth: number;
      path: string[];
    }
    const tree = (await api(ws).get("/admin/departments/options")).body as Paged<Option>;
    expect(tree.items.map((o) => [o.name, o.depth])).toEqual([
      ["Compras", 0],
      ["Finanzas", 0],
      ["Contabilidad", 1],
    ]);
    const found = (await api(ws).get("/admin/departments/options?q=conta")).body as Paged<Option>;
    expect(found.items.map((o) => o.path)).toEqual([["Finanzas", "Contabilidad"]]);
    // Paginado: de a tantos como se pidan, siguiendo el orden de árbol.
    const page2 = (await api(ws).get("/admin/departments/options?pageSize=2&page=2"))
      .body as Paged<Option>;
    expect(page2).toMatchObject({ total: 3 });
    expect(page2.items.map((o) => o.name)).toEqual(["Contabilidad"]);
  });
});
