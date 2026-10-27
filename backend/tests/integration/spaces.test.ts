// Espacios, carpetas y permisos (módulo 3, parte 1): seguridad y aislamiento. Nadie ve ni toca
// contenido de otra empresa, ni de un espacio privado sin permiso; lectores e invitados no editan;
// los nombres no se repiten entre hermanos (sin mayúsculas y con NFC).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import type { TestWorkspace } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const api = (ws: Pick<TestWorkspace, "slug">, token: string) => {
  const call = (method: "get" | "post" | "put" | "patch" | "delete", path: string, body?: object) =>
    request(app)
      [method](`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  return {
    get: (path: string) => call("get", path),
    post: (path: string, body?: object) => call("post", path, body),
    put: (path: string, body?: object) => call("put", path, body),
    patch: (path: string, body?: object) => call("patch", path, body),
    delete: (path: string) => call("delete", path),
  };
};

interface Paged<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}
interface SpaceBody {
  id: string;
  name: string;
  level: string;
  canManage: boolean;
  archived: boolean;
}
interface NodeBody {
  id: string;
  name: string;
  type: string;
  level: string;
  parentId: string | null;
}

/**
 * Un workspace con: Calidad (departamento), un administrador, "Edith" (miembro de Calidad),
 * "Vera" (miembro sin departamento), "Rita" (lectora de Calidad), "Gabi" (invitada externa) y
 * un segundo workspace con su propietario.
 */
async function setup(label: string) {
  app = createApp(ctx.deps); // límite global por IP en memoria: una app nueva por escenario
  const ws = await createWorkspace(ctx, label);
  const other = await createWorkspace(ctx, `${label} ajeno`);
  const owner = api(ws, ws.token);
  const calidad = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Calidad" },
  });
  const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Adela Admin" });
  const edith = await addMember(ctx, ws, { name: "Edith Editora" });
  const vera = await addMember(ctx, ws, { name: "Vera Visora" });
  const rita = await addMember(ctx, ws, { name: "Rita Lectora", seatType: "READER" });
  const gabi = await addMember(ctx, ws, { base: "GUEST", name: "Gabi Invitada" });
  await ctx.prisma.departmentMember.createMany({
    data: [edith, rita].map((p) => ({
      workspaceId: ws.workspaceId,
      departmentId: calidad.id,
      membershipId: p.membership.id,
    })),
  });
  // Quien crea espacios sin ser administrador: un rol con spaces.create.
  const creatorRole = await ctx.prisma.role.create({
    data: {
      workspaceId: ws.workspaceId,
      name: "Creadora de espacios",
      base: "MEMBER",
      capabilities: ["spaces.create"],
    },
  });
  const creator = await addMember(ctx, ws, { roleId: creatorRole.id, name: "Carla Creadora" });
  return { ws, other, owner, calidad, admin, edith, vera, rita, gabi, creator };
}
type World = Awaited<ReturnType<typeof setup>>;

async function newSpace(w: World, body: object = { name: "Procedimientos" }) {
  const res = await w.owner.post("/spaces", body);
  expect(res.status).toBe(201);
  return (res.body as { space: SpaceBody }).space;
}

const namesOf = (page: { items: { name: string }[] }) => page.items.map((i) => i.name).sort();

describe("espacios: crear y ver", () => {
  it("solo con la capacidad spaces.create; quien crea queda como gestor", async () => {
    const w = await setup("Espacios crear");
    for (const who of [w.edith, w.vera, w.rita, w.gabi]) {
      const res = await api(w.ws, who.token).post("/spaces", { name: "Mío" });
      expect(res.status, who.user.name).toBe(403);
    }
    const res = await api(w.ws, w.creator.token).post("/spaces", {
      name: "Calidad",
      icon: "shield",
      description: "Todo lo de calidad",
    });
    expect(res.status).toBe(201);
    const space = (res.body as { space: SpaceBody }).space;
    expect(space).toMatchObject({ name: "Calidad", level: "MANAGE", canManage: true });
    const grant = await ctx.prisma.permission.findFirstOrThrow({ where: { spaceId: space.id } });
    expect(grant).toMatchObject({ membershipId: w.creator.membership.id, level: "MANAGE" });
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "space.create" },
      }),
    ).toBe(1);
  });

  it("el nombre no se repite (sin mayúsculas y con NFC)", async () => {
    const w = await setup("Espacios nombres");
    await newSpace(w, { name: "Café" });
    for (const name of ["café", "CAFÉ", "Café", "  Café  "]) {
      const res = await w.owner.post("/spaces", { name });
      expect(res.status, name).toBe(409);
    }
    expect((await w.owner.post("/spaces", { name: "Cafetería" })).status).toBe(201);
    expect((await w.owner.post("/spaces", { name: "a/b" })).status).toBe(400);
  });

  it("un espacio no privado lo ven los miembros; uno privado, solo quien tiene permiso", async () => {
    const w = await setup("Espacios visibles");
    const publico = await newSpace(w, { name: "Público" });
    const privado = await newSpace(w, { name: "Privado", isPrivate: true });
    const list = async (token: string) =>
      namesOf((await api(w.ws, token).get("/spaces")).body as Paged<{ name: string }>);
    expect(await list(w.edith.token)).toEqual(["Público"]);
    expect(await list(w.vera.token)).toEqual(["Público"]);
    expect(await list(w.rita.token)).toEqual(["Público"]);
    expect(await list(w.gabi.token)).toEqual([]); // el invitado ve solo lo compartido
    expect(await list(w.ws.token)).toEqual(["Privado", "Público"]);
    expect(await list(w.admin.token)).toEqual(["Privado", "Público"]);
    // Directo por id: el privado no existe para quien no lo ve.
    expect((await api(w.ws, w.edith.token).get(`/spaces/${privado.id}`)).status).toBe(404);
    expect((await api(w.ws, w.gabi.token).get(`/spaces/${publico.id}`)).status).toBe(404);
    expect((await api(w.ws, w.edith.token).get(`/spaces/${publico.id}`)).body).toMatchObject({
      space: { level: "VIEW", canManage: false },
    });
    // Ni los hijos del privado.
    expect((await api(w.ws, w.edith.token).get(`/spaces/${privado.id}/nodes`)).status).toBe(404);
  });

  it("un permiso a un departamento (o a una persona) abre el privado, y vencido deja de valer", async () => {
    const w = await setup("Espacios permisos");
    const privado = await newSpace(w, { name: "Privado", isPrivate: true });
    const grant = await w.owner.put(`/spaces/${privado.id}/permissions`, {
      departmentId: w.calidad.id,
      level: "VIEW",
    });
    expect(grant.status).toBe(200);
    expect((await api(w.ws, w.edith.token).get(`/spaces/${privado.id}`)).status).toBe(200);
    expect((await api(w.ws, w.vera.token).get(`/spaces/${privado.id}`)).status).toBe(404);
    const personal = await w.owner.put(`/spaces/${privado.id}/permissions`, {
      membershipId: w.vera.membership.id,
      level: "COMMENT",
    });
    expect(personal.status).toBe(200);
    expect((await api(w.ws, w.vera.token).get(`/spaces/${privado.id}`)).body).toMatchObject({
      space: { level: "COMMENT" },
    });
    // Un permiso vencido (se fuerza en la base) deja de valer.
    await ctx.prisma.permission.updateMany({
      where: { spaceId: privado.id, membershipId: w.vera.membership.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await api(w.ws, w.vera.token).get(`/spaces/${privado.id}`)).status).toBe(404);
  });
});

describe("miembros del espacio", () => {
  it("solo quien gestiona el espacio los ve y los cambia", async () => {
    const w = await setup("Miembros espacio permisos");
    const space = await newSpace(w);
    for (const who of [w.edith, w.vera, w.rita]) {
      const a = api(w.ws, who.token);
      expect((await a.get(`/spaces/${space.id}/access`)).status).toBe(403);
      expect(
        (
          await a.put(`/spaces/${space.id}/permissions`, {
            departmentId: w.calidad.id,
            level: "EDIT",
          })
        ).status,
      ).toBe(403);
      expect((await a.patch(`/spaces/${space.id}`, { name: "Otro" })).status).toBe(403);
      expect((await a.post(`/spaces/${space.id}/archive`)).status).toBe(403);
    }
    // Quien no ve el espacio ni sabe que existe.
    expect((await api(w.ws, w.gabi.token).get(`/spaces/${space.id}/access`)).status).toBe(404);
    // Un gestor del espacio (permiso MANAGE de persona) sí.
    expect(
      (
        await w.owner.put(`/spaces/${space.id}/permissions`, {
          membershipId: w.vera.membership.id,
          level: "MANAGE",
        })
      ).status,
    ).toBe(200);
    expect((await api(w.ws, w.vera.token).get(`/spaces/${space.id}/access`)).status).toBe(200);
  });

  it("lista los accesos dados con sus nombres, no duplica y permite quitar", async () => {
    const w = await setup("Miembros espacio lista");
    const space = await newSpace(w);
    await w.owner.put(`/spaces/${space.id}/permissions`, {
      membershipId: w.vera.membership.id,
      level: "VIEW",
    });
    await w.owner.put(`/spaces/${space.id}/permissions`, {
      departmentId: w.calidad.id,
      level: "EDIT",
    });
    const list = (await w.owner.get(`/spaces/${space.id}/access`)).body as {
      grants: { id: string; subject: { type: string; name: string }; level: string }[];
    };
    expect(list.grants.map((g) => [g.subject.type, g.subject.name, g.level]).sort()).toEqual(
      [
        ["department", "Calidad", "EDIT"],
        ["person", expect.any(String), "MANAGE"], // quien creó el espacio
        ["person", "Vera Visora", "VIEW"],
      ].sort(),
    );
    // Volver a dar el permiso al mismo sujeto cambia el nivel (no duplica).
    await w.owner.put(`/spaces/${space.id}/permissions`, {
      departmentId: w.calidad.id,
      level: "COMMENT",
    });
    expect(
      await ctx.prisma.permission.count({
        where: { spaceId: space.id, departmentId: w.calidad.id },
      }),
    ).toBe(1);
    const toRemove = list.grants.find((g) => g.subject.type === "department");
    expect((await w.owner.delete(`/permissions/${toRemove?.id ?? ""}`)).status).toBe(204);
    expect((await w.owner.delete(`/permissions/${toRemove?.id ?? ""}`)).status).toBe(404);
  });

  it("las opciones de departamentos las ve solo quien gestiona el espacio", async () => {
    const w = await setup("Miembros espacio opciones");
    const space = await newSpace(w);
    const options = (await w.owner.get(`/spaces/${space.id}/members/options?q=cal`)).body as Paged<{
      name: string;
    }>;
    expect(options.items.map((d) => d.name)).toEqual(["Calidad"]);
    expect((await api(w.ws, w.vera.token).get(`/spaces/${space.id}/members/options`)).status).toBe(
      403,
    );
    expect((await api(w.ws, w.gabi.token).get(`/spaces/${space.id}/members/options`)).status).toBe(
      404,
    );
    // Un gestor del espacio que no es administrador también las ve.
    await w.owner.put(`/spaces/${space.id}/permissions`, {
      membershipId: w.vera.membership.id,
      level: "MANAGE",
    });
    expect((await api(w.ws, w.vera.token).get(`/spaces/${space.id}/members/options`)).status).toBe(
      200,
    );
  });

  it("el backend rechaza EDIT y MANAGE para lectores e invitados, y valida el sujeto", async () => {
    const w = await setup("Miembros espacio límites");
    const space = await newSpace(w);
    for (const who of [w.rita, w.gabi]) {
      for (const level of ["EDIT", "MANAGE"]) {
        const res = await w.owner.put(`/spaces/${space.id}/permissions`, {
          membershipId: who.membership.id,
          level,
        });
        expect(res.status, `${who.user.name} ${level}`).toBe(400);
      }
      expect(
        (
          await w.owner.put(`/spaces/${space.id}/permissions`, {
            membershipId: who.membership.id,
            level: "COMMENT",
          })
        ).status,
      ).toBe(200);
    }
    const bad: object[] = [
      { level: "VIEW" },
      { departmentId: w.calidad.id, membershipId: w.vera.membership.id, level: "VIEW" },
      { departmentId: w.calidad.id, level: "MUCHO" },
      { membershipId: w.vera.membership.id, level: "VIEW", expiresAt: "2020-01-01T00:00:00Z" },
    ];
    for (const body of bad) {
      expect((await w.owner.put(`/spaces/${space.id}/permissions`, body)).status).toBe(400);
    }
    // Departamento o persona de otro workspace: no existen.
    const foreign = await addMember(ctx, w.other, { name: "Ajena" });
    expect(
      (
        await w.owner.put(`/spaces/${space.id}/permissions`, {
          membershipId: foreign.membership.id,
          level: "VIEW",
        })
      ).status,
    ).toBe(400);
    const foreignDept = await ctx.prisma.department.create({
      data: { workspaceId: w.other.workspaceId, name: "Ajeno" },
    });
    expect(
      (
        await w.owner.put(`/spaces/${space.id}/permissions`, {
          departmentId: foreignDept.id,
          level: "VIEW",
        })
      ).status,
    ).toBe(404);
  });

  it("un departamento con EDIT no le da más que COMMENT a su lectora", async () => {
    const w = await setup("Miembros espacio lectora");
    const space = await newSpace(w);
    await w.owner.put(`/spaces/${space.id}/permissions`, {
      departmentId: w.calidad.id,
      level: "EDIT",
    });
    const rita = api(w.ws, w.rita.token);
    expect((await rita.get(`/spaces/${space.id}`)).body).toMatchObject({
      space: { level: "COMMENT" },
    });
    expect((await rita.post(`/spaces/${space.id}/folders`, { name: "Intento" })).status).toBe(403);
    // Edith (plaza completa, mismo departamento) sí edita.
    expect(
      (await api(w.ws, w.edith.token).post(`/spaces/${space.id}/folders`, { name: "Mía" })).status,
    ).toBe(201);
  });
});

describe("carpetas", () => {
  it("se crean, se anidan y se listan con las carpetas primero y paginadas", async () => {
    const w = await setup("Carpetas listado");
    const space = await newSpace(w);
    const folder = async (name: string, parentId?: string) =>
      (
        (await w.owner.post(`/spaces/${space.id}/folders`, { name, parentId })).body as {
          node: NodeBody;
        }
      ).node;
    const root = await folder("Procedimientos");
    await folder("Calidad", root.id);
    await folder("Anexos", root.id);
    await folder("Zeta");
    const top = (await w.owner.get(`/spaces/${space.id}/nodes?pageSize=1`)).body as Paged<NodeBody>;
    expect(top.total).toBe(2);
    expect(top.items.map((n) => n.name)).toEqual(["Procedimientos"]);
    expect(top.nextCursor).not.toBeNull();
    const inside = (await w.owner.get(`/spaces/${space.id}/nodes?parent=${root.id}`))
      .body as Paged<NodeBody>;
    expect(inside.items.map((n) => n.name)).toEqual(["Anexos", "Calidad"]);
    const searched = (await w.owner.get(`/spaces/${space.id}/nodes?parent=${root.id}&q=cal`))
      .body as Paged<NodeBody>;
    expect(searched.items.map((n) => n.name)).toEqual(["Calidad"]);
    const detail = (await w.owner.get(`/nodes/${inside.items[0]?.id ?? ""}`)).body as {
      ancestors: { name: string }[];
      space: { name: string };
    };
    expect(detail.ancestors.map((a) => a.name)).toEqual(["Procedimientos"]);
    expect(detail.space.name).toBe("Procedimientos");
  });

  it("no repite nombres entre hermanos, pero sí en carpetas distintas", async () => {
    const w = await setup("Carpetas nombres");
    const space = await newSpace(w);
    const make = (name: string, parentId?: string) =>
      w.owner.post(`/spaces/${space.id}/folders`, { name, parentId });
    const a = ((await make("Informes")).body as { node: NodeBody }).node;
    for (const name of ["informes", "INFORMES", "Informes"]) {
      expect((await make(name)).status, name).toBe(409);
    }
    expect((await make("Informes", a.id)).status).toBe(201);
    const other = ((await make("Otra")).body as { node: NodeBody }).node;
    // Renombrar y mover también respetan el nombre.
    expect((await w.owner.patch(`/nodes/${other.id}`, { name: "informes" })).status).toBe(409);
    const inner = ((await make("Dentro", a.id)).body as { node: NodeBody }).node;
    const clash = ((await make("Informes", other.id)).body as { node: NodeBody }).node;
    expect((await w.owner.post(`/nodes/${clash.id}/move`, { parentId: a.id })).status).toBe(409);
    expect((await w.owner.post(`/nodes/${inner.id}/move`, { parentId: null })).status).toBe(
      201 - 1,
    );
    // La comparación sigue después de renombrar con otra capitalización del mismo nombre.
    expect((await w.owner.patch(`/nodes/${a.id}`, { name: "INFORMES" })).status).toBe(200);
  });

  it("mover pide EDIT; no se mete una carpeta dentro de sí misma ni cruza espacios", async () => {
    const w = await setup("Carpetas mover");
    const space = await newSpace(w);
    const other = await newSpace(w, { name: "Otro" });
    const make = async (name: string, parentId?: string) =>
      (
        (await w.owner.post(`/spaces/${space.id}/folders`, { name, parentId })).body as {
          node: NodeBody;
        }
      ).node;
    const a = await make("A");
    const b = await make("B", a.id);
    const c = await make("C", b.id);
    for (const parentId of [a.id, b.id, c.id]) {
      expect((await w.owner.post(`/nodes/${a.id}/move`, { parentId })).status).toBe(400);
    }
    const foreign = (
      (await w.owner.post(`/spaces/${other.id}/folders`, { name: "Fuera" })).body as {
        node: NodeBody;
      }
    ).node;
    expect((await w.owner.post(`/nodes/${c.id}/move`, { parentId: foreign.id })).status).toBe(404);
    // Mover pide EDIT (no MANAGE): quien solo comenta (Rita, lectora) recibe 403 y Edith puede.
    await w.owner.put(`/spaces/${space.id}/permissions`, {
      departmentId: w.calidad.id,
      level: "EDIT",
    });
    const rita = api(w.ws, w.rita.token);
    expect((await rita.post(`/nodes/${c.id}/move`, { parentId: null })).status).toBe(403);
    const edith = api(w.ws, w.edith.token);
    expect((await edith.patch(`/nodes/${c.id}`, { name: "C2" })).status).toBe(200);
    expect((await edith.post(`/nodes/${c.id}/move`, { parentId: null })).status).toBe(200);
    expect((await ctx.prisma.node.findUniqueOrThrow({ where: { id: c.id } })).parentId).toBeNull();
  });

  it("limita la profundidad", async () => {
    const w = await setup("Carpetas profundidad");
    const space = await newSpace(w);
    let parentId: string | undefined;
    for (let level = 1; level <= 30; level++) {
      const res = await w.owner.post(`/spaces/${space.id}/folders`, {
        name: `n${String(level)}`,
        parentId,
      });
      expect(res.status, String(level)).toBe(201);
      parentId = (res.body as { node: NodeBody }).node.id;
    }
    expect(
      (await w.owner.post(`/spaces/${space.id}/folders`, { name: "demasiado", parentId })).status,
    ).toBe(400);
  });

  it("quien solo ve no crea, renombra ni mueve; sin acceso no existe", async () => {
    const w = await setup("Carpetas ver");
    const space = await newSpace(w);
    const folder = (
      (await w.owner.post(`/spaces/${space.id}/folders`, { name: "Doc" })).body as {
        node: NodeBody;
      }
    ).node;
    const vera = api(w.ws, w.vera.token);
    expect((await vera.get(`/spaces/${space.id}/nodes`)).status).toBe(200);
    expect((await vera.post(`/spaces/${space.id}/folders`, { name: "Nueva" })).status).toBe(403);
    expect((await vera.patch(`/nodes/${folder.id}`, { name: "Otra" })).status).toBe(403);
    expect((await vera.post(`/nodes/${folder.id}/move`, { parentId: null })).status).toBe(403);
    const gabi = api(w.ws, w.gabi.token);
    expect((await gabi.get(`/nodes/${folder.id}`)).status).toBe(404);
    expect((await gabi.patch(`/nodes/${folder.id}`, { name: "X" })).status).toBe(404);
    expect((await gabi.post(`/spaces/${space.id}/folders`, { name: "X" })).status).toBe(404);
  });

  it("una carpeta sin herencia se oculta a quien no tiene permiso en ella", async () => {
    const w = await setup("Carpetas herencia");
    const space = await newSpace(w);
    const open = (
      (await w.owner.post(`/spaces/${space.id}/folders`, { name: "Abierta" })).body as {
        node: NodeBody;
      }
    ).node;
    const closed = (
      (await w.owner.post(`/spaces/${space.id}/folders`, { name: "Cerrada" })).body as {
        node: NodeBody;
      }
    ).node;
    const secret = (
      (
        await w.owner.post(`/spaces/${space.id}/folders`, {
          name: "Secreta",
          parentId: closed.id,
        })
      ).body as { node: NodeBody }
    ).node;
    await ctx.prisma.node.update({ where: { id: closed.id }, data: { inheritAccess: false } });
    const vera = api(w.ws, w.vera.token);
    const visible = (await vera.get(`/spaces/${space.id}/nodes`)).body as Paged<NodeBody>;
    expect(visible.items.map((n) => n.name)).toEqual(["Abierta"]);
    expect(visible.total).toBe(1);
    expect((await vera.get(`/nodes/${closed.id}`)).status).toBe(404);
    expect((await vera.get(`/nodes/${secret.id}`)).status).toBe(404);
    expect((await vera.get(`/spaces/${space.id}/nodes?parent=${closed.id}`)).status).toBe(404);
    expect((await vera.get(`/nodes/${open.id}`)).status).toBe(200);
    // Un permiso explícito en la carpeta cerrada la abre (y a sus hijos).
    await w.owner.post(`/nodes/${closed.id}/move`, { parentId: null });
    await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: closed.id,
        membershipId: w.vera.membership.id,
        level: "VIEW",
        grantedById: w.ws.membershipId,
      },
    });
    expect((await vera.get(`/nodes/${closed.id}`)).status).toBe(200);
    expect((await vera.get(`/nodes/${secret.id}`)).status).toBe(200);
    expect(
      ((await vera.get(`/spaces/${space.id}/nodes`)).body as Paged<NodeBody>).items.map(
        (n) => n.name,
      ),
    ).toEqual(["Abierta", "Cerrada"]);
  });
});

describe("archivar", () => {
  it("un espacio archivado no se lista, se lee pero no se escribe, y se restaura", async () => {
    const w = await setup("Espacios archivar");
    const space = await newSpace(w);
    expect((await w.owner.post(`/spaces/${space.id}/archive`)).body).toMatchObject({
      space: { archived: true },
    });
    expect(namesOf((await w.owner.get("/spaces")).body as Paged<{ name: string }>)).toEqual([]);
    expect(
      namesOf((await w.owner.get("/spaces?archived=true")).body as Paged<{ name: string }>),
    ).toEqual(["Procedimientos"]);
    // Quien no gestiona espacios no ve la lista de archivados.
    expect(
      ((await api(w.ws, w.vera.token).get("/spaces?archived=true")).body as Paged<unknown>).total,
    ).toBe(0);
    expect((await w.owner.post(`/spaces/${space.id}/folders`, { name: "Nueva" })).status).toBe(409);
    expect(
      (
        await w.owner.put(`/spaces/${space.id}/permissions`, {
          departmentId: w.calidad.id,
          level: "VIEW",
        })
      ).status,
    ).toBe(409);
    // Su nombre queda libre para otro espacio activo; restaurarlo entonces falla.
    await newSpace(w);
    expect((await w.owner.post(`/spaces/${space.id}/restore`)).status).toBe(409);
  });

  it("al restaurarlo vuelve a verse y a escribirse", async () => {
    const w = await setup("Espacios restaurar");
    const space = await newSpace(w);
    await w.owner.post(`/spaces/${space.id}/archive`);
    expect((await w.owner.post(`/spaces/${space.id}/restore`)).status).toBe(200);
    expect((await w.owner.post(`/spaces/${space.id}/folders`, { name: "Nueva" })).status).toBe(201);
    for (const action of ["space.archive", "space.restore"]) {
      expect(
        await ctx.prisma.auditLog.count({ where: { workspaceId: w.ws.workspaceId, action } }),
      ).toBe(1);
    }
  });
});

describe("aislamiento entre empresas", () => {
  it("nadie ve ni toca espacios, carpetas o permisos de otra empresa", async () => {
    const w = await setup("Aislamiento contenido");
    const space = await newSpace(w);
    const folder = (
      (await w.owner.post(`/spaces/${space.id}/folders`, { name: "Interna" })).body as {
        node: NodeBody;
      }
    ).node;
    const outsider = api(w.other, w.other.token); // propietario de la otra empresa
    // Con el slug de la otra empresa, los ids ajenos no existen.
    expect((await outsider.get(`/spaces/${space.id}`)).status).toBe(404);
    expect((await outsider.get(`/spaces/${space.id}/nodes`)).status).toBe(404);
    expect((await outsider.get(`/nodes/${folder.id}`)).status).toBe(404);
    expect((await outsider.patch(`/nodes/${folder.id}`, { name: "Robada" })).status).toBe(404);
    expect((await outsider.post(`/nodes/${folder.id}/move`, { parentId: null })).status).toBe(404);
    expect((await outsider.post(`/spaces/${space.id}/folders`, { name: "X" })).status).toBe(404);
    expect(
      (
        await outsider.put(`/spaces/${space.id}/permissions`, {
          membershipId: w.ws.membershipId,
          level: "MANAGE",
        })
      ).status,
    ).toBe(404);
    expect(namesOf((await outsider.get("/spaces")).body as Paged<{ name: string }>)).toEqual([]);
    // Con el slug de la propia empresa, un token ajeno no entra.
    expect((await api(w.ws, w.other.token).get(`/spaces/${space.id}`)).status).toBe(404);
    // Un permiso de la otra empresa no se puede crear apuntando a un id nuestro.
    const nodeInOther = await ctx.prisma.node.findFirstOrThrow({ where: { id: folder.id } });
    await expect(
      ctx.prisma.permission.create({
        data: {
          workspaceId: w.other.workspaceId,
          nodeId: nodeInOther.id,
          membershipId: w.other.membershipId,
          level: "VIEW",
          grantedById: w.other.membershipId,
        },
      }),
    ).rejects.toThrow();
    // Y el contenido de la otra empresa no cambió.
    expect(await ctx.prisma.node.count({ where: { workspaceId: w.other.workspaceId } })).toBe(0);
  });
});
