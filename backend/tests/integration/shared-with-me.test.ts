// «Compartido conmigo» (módulo 5): ver lo compartido sí, subir a la carpeta superior no, los accesos a
// un departamento con y sin subáreas, y el aislamiento entre empresas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface SharedList {
  items: {
    id: string;
    name: string;
    level: string;
    spaceName: string;
    sharedBy: string | null;
    via: string;
  }[];
  nextCursor: string | null;
}

const sharedOf = async (w: PagesWorld, token: string, slug = w.ws.slug) => {
  const res = await w.call("get", token, "/shared-with-me", undefined, slug);
  expect(res.status).toBe(200);
  return res.body as SharedList;
};

async function folder(w: PagesWorld, name: string, parentId: string | null = null) {
  const res = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, { name, parentId });
  expect(res.status).toBe(201);
  return (res.body as { node: { id: string } }).node.id;
}

const give = (w: PagesWorld, nodeId: string, body: object) =>
  w.call("put", w.ws.token, `/nodes/${nodeId}/permissions`, body);

describe("compartido conmigo", () => {
  it("lista lo compartido fuera de los espacios que ya ve, sin repetir sus subcarpetas", async () => {
    const w = await pagesWorld(ctx, "Compartido lista");
    const parent = await folder(w, "Dirección");
    const shared = await folder(w, "Para Sofía", parent);
    await folder(w, "Adentro", shared);
    expect((await sharedOf(w, w.stranger.token)).items).toEqual([]);

    expect(
      (await give(w, shared, { membershipId: w.stranger.membership.id, level: "EDIT" })).status,
    ).toBe(200);
    const list = await sharedOf(w, w.stranger.token);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: shared,
      name: "Para Sofía",
      level: "EDIT",
      spaceName: "Calidad",
      via: "person",
    });
    expect(list.items[0]?.sharedBy).not.toBeNull();
    // Quien ya ve el espacio no lo tiene en «Compartido conmigo».
    expect((await sharedOf(w, w.viewer.token)).items).toEqual([]);
    // Un acceso vencido no cuenta.
    await ctx.prisma.permission.updateMany({
      where: { nodeId: shared },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await sharedOf(w, w.stranger.token)).items).toEqual([]);
  });

  it("también lo compartido con un departamento de la persona", async () => {
    const w = await pagesWorld(ctx, "Compartido departamento");
    const dept = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Compras" },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: dept.id,
        membershipId: w.stranger.membership.id,
      },
    });
    const shared = await folder(w, "Para Compras");
    expect((await give(w, shared, { departmentId: dept.id, level: "VIEW" })).status).toBe(200);
    const list = await sharedOf(w, w.stranger.token);
    expect(list.items.map((i) => [i.name, i.via, i.level])).toEqual([
      ["Para Compras", "department", "VIEW"],
    ]);
  });

  it("se navega solo dentro de lo compartido: la carpeta de arriba no se abre ni se sube a ella", async () => {
    const w = await pagesWorld(ctx, "Compartido navegar");
    const parent = await folder(w, "Dirección");
    const shared = await folder(w, "Para Sofía", parent);
    expect(
      (await give(w, shared, { membershipId: w.stranger.membership.id, level: "EDIT" })).status,
    ).toBe(200);
    const sofia = w.stranger.token;

    const detail = await w.call("get", sofia, `/nodes/${shared}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      shareRoot: { id: shared },
      ancestors: [{ id: parent, name: "Dirección", accessible: false }],
    });
    // Se ve la ruta, pero lo de arriba no se abre.
    expect((await w.call("get", sofia, `/nodes/${parent}`)).status).toBe(404);
    expect((await w.call("get", sofia, `/spaces/${w.spaceId}`)).status).toBe(404);
    expect((await w.call("get", sofia, `/spaces/${w.spaceId}/nodes?parent=${parent}`)).status).toBe(
      404,
    );
    expect((await w.call("get", sofia, `/spaces/${w.spaceId}/nodes?parent=root`)).status).toBe(404);
    expect((await w.call("get", sofia, `/spaces/${w.spaceId}/nodes?parent=${shared}`)).status).toBe(
      200,
    );
    // Subir o crear en la carpeta superior no; en la compartida (con EDIT) sí.
    const create = (parentId: string) =>
      w.call("post", sofia, `/spaces/${w.spaceId}/folders`, { name: "Nueva", parentId });
    expect((await create(parent)).status).toBe(404);
    expect(
      (await w.call("post", sofia, `/spaces/${w.spaceId}/folders`, { name: "Raíz" })).status,
    ).toBe(404);
    expect((await create(shared)).status).toBe(201);
    // Con solo VER, tampoco en la compartida.
    expect(
      (await give(w, shared, { membershipId: w.stranger.membership.id, level: "VIEW" })).status,
    ).toBe(200);
    expect((await create(shared)).status).toBe(403);
  });

  it("no mezcla empresas", async () => {
    const w = await pagesWorld(ctx, "Compartido aislado");
    const shared = await folder(w, "Para Sofía");
    await give(w, shared, { membershipId: w.stranger.membership.id, level: "VIEW" });
    // Alguien de otra empresa no ve nada de esta, ni usando su propio token en este workspace.
    expect((await sharedOf(w, w.outsider.token, w.outsider.slug)).items).toEqual([]);
    expect((await w.call("get", w.outsider.token, "/shared-with-me")).status).toBe(404);
    // Y no se le puede compartir a alguien de otra empresa.
    expect(
      (await give(w, shared, { membershipId: w.outsider.membershipId, level: "VIEW" })).status,
    ).toBe(400);
  });
});

describe("accesos a un departamento: incluir subáreas", () => {
  it("por defecto solo el departamento elegido; con la casilla, también sus subáreas", async () => {
    const w = await pagesWorld(ctx, "Subáreas");
    const parent = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Producción" },
    });
    const child = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Envasado", parentId: parent.id },
    });
    const worker = await addMember(ctx, w.ws, { name: "Nora Envasadora" });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: child.id,
        membershipId: worker.membership.id,
      },
    });
    const shared = await folder(w, "Para Producción");
    const sees = async () => (await w.call("get", worker.token, `/nodes/${shared}`)).status;

    // Sin subáreas: la persona del subdepartamento no entra.
    expect((await give(w, shared, { departmentId: parent.id, level: "VIEW" })).status).toBe(200);
    expect(await sees()).toBe(404);
    expect((await sharedOf(w, worker.token)).items).toEqual([]);
    // Con subáreas, sí.
    expect(
      (await give(w, shared, { departmentId: parent.id, level: "VIEW", includeSubareas: true }))
        .status,
    ).toBe(200);
    expect(await sees()).toBe(200);
    expect((await sharedOf(w, worker.token)).items.map((i) => i.name)).toEqual(["Para Producción"]);
    // Dar el acceso al subdepartamento mismo siempre alcanza a su gente.
    await give(w, shared, { departmentId: parent.id, level: "VIEW", includeSubareas: false });
    expect(await sees()).toBe(404);
    expect((await give(w, shared, { departmentId: child.id, level: "VIEW" })).status).toBe(200);
    expect(await sees()).toBe(200);
  });
});

describe("avisos de lo compartido, visibilidad para quien comparte y matriz", () => {
  it("lo compartido es nuevo hasta que se abre, y el contador baja", async () => {
    const w = await pagesWorld(ctx, "Compartido nuevo");
    const shared = await folder(w, "Para Sofía");
    await give(w, shared, { membershipId: w.stranger.membership.id, level: "VIEW" });
    const summary = async () =>
      (await w.call("get", w.stranger.token, "/shared-with-me/summary")).body as {
        unseen: number;
      };
    expect((await summary()).unseen).toBe(1);
    expect((await sharedOf(w, w.stranger.token)).items[0]).toMatchObject({ isNew: true });
    // Abrirlo (el servidor lo marca) apaga «Nuevo».
    expect((await w.call("get", w.stranger.token, `/nodes/${shared}`)).status).toBe(200);
    expect((await summary()).unseen).toBe(0);
    expect((await sharedOf(w, w.stranger.token)).items[0]).toMatchObject({ isNew: false });
    // Marcar como visto algo que no se ve no guarda nada.
    const other = await folder(w, "Otra");
    expect((await w.call("post", w.stranger.token, `/nodes/${other}/seen`)).status).toBe(204);
    expect(
      await ctx.prisma.sharedSeen.count({
        where: { nodeId: other, membershipId: w.stranger.membership.id },
      }),
    ).toBe(0);
  });

  it("quien comparte ve el resumen y la lista «por mí»; un jefe, también lo de su área", async () => {
    const w = await pagesWorld(ctx, "Compartido por mí");
    const dept = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Compras" },
    });
    const head = await addMember(ctx, w.ws, { name: "Hugo Jefe" });
    const mario = await addMember(ctx, w.ws, { name: "Mario Miembro" });
    for (const [who, position] of [
      [head, "HEAD"],
      [mario, "MEMBER"],
    ] as const) {
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId: dept.id,
          membershipId: who.membership.id,
          position,
        },
      });
    }
    // Mario puede gestionar el espacio y comparte una carpeta con Sofía.
    await w.call("put", w.ws.token, `/spaces/${w.spaceId}/permissions`, {
      membershipId: mario.membership.id,
      level: "MANAGE",
    });
    const shared = await folder(w, "Para Sofía");
    expect(
      (
        await w.call("put", mario.token, `/nodes/${shared}/permissions`, {
          membershipId: w.stranger.membership.id,
          level: "VIEW",
        })
      ).status,
    ).toBe(200);

    interface ByMe {
      items: { target: { name: string; type: string }; mine: boolean; canRemove: boolean }[];
    }
    const byMe = async (token: string) =>
      (await w.call("get", token, "/shared-by-me")).body as ByMe;
    const mine = await byMe(mario.token);
    expect(mine.items.map((i) => [i.target.name, i.mine, i.canRemove])).toEqual([
      ["Para Sofía", true, true],
    ]);
    // El jefe ve lo que dio su área, pero no puede quitarlo si no gestiona lo compartido.
    const area = await byMe(head.token);
    expect(area.items.map((i) => [i.target.name, i.mine])).toEqual([["Para Sofía", false]]);
    expect(area.items[0]?.canRemove).toBe(false);
    // Nadie más lo ve; y el acceso que se dio a sí misma quien creó el espacio no cuenta.
    expect((await byMe(w.viewer.token)).items).toEqual([]);
    // Los cuatro accesos al espacio que dio el propietario (editor, comenta, ve y Mario): no cuenta el suyo.
    const owner = (await byMe(w.ws.token)).items.filter((i) => i.target.type === "space");
    expect(owner).toHaveLength(4);

    // El ícono de «compartido» solo llega a quien gestiona la carpeta.
    const rows = async (token: string) =>
      (
        (await w.call("get", token, `/spaces/${w.spaceId}/nodes?parent=root`)).body as {
          items: { id: string; sharing: { count: number; names: string[] } | null }[];
        }
      ).items.find((item) => item.id === shared)?.sharing;
    expect(await rows(mario.token)).toMatchObject({ count: 1, names: ["Sofía Sinacceso"] });
    expect(await rows(w.editor.token)).toBeNull();
  });

  it("la matriz marca lo parcial y muestra el detalle, con subáreas en jerarquía", async () => {
    const w = await pagesWorld(ctx, "Matriz parcial");
    const parent = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Producción" },
    });
    const child = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Envasado", parentId: parent.id },
    });
    const shared = await folder(w, "Para Producción");
    await give(w, shared, { departmentId: parent.id, level: "EDIT", includeSubareas: true });
    interface Matrix {
      departments: { items: { id: string; name: string; depth: number }[] };
      partials: { departmentId: string; spaceId: string; count: number }[];
    }
    const matrix = (await w.call("get", w.ws.token, "/admin/access/matrix?pageSize=100"))
      .body as Matrix;
    const at = (name: string) => matrix.departments.items.findIndex((d) => d.name === name);
    expect(at("Envasado")).toBe(at("Producción") + 1);
    expect(matrix.departments.items[at("Envasado")]?.depth).toBe(1);
    const partial = (id: string) =>
      matrix.partials.find((p) => p.departmentId === id && p.spaceId === w.spaceId)?.count;
    expect(partial(parent.id)).toBe(1);
    expect(partial(child.id)).toBe(1); // llega por «incluir subáreas»

    const cell = await w.call(
      "get",
      w.ws.token,
      `/admin/access/matrix/cell?departmentId=${child.id}&spaceId=${w.spaceId}`,
    );
    expect(cell.status).toBe(200);
    expect(cell.body).toMatchObject({
      spaceAccess: null,
      items: {
        total: 1,
        items: [{ node: { name: "Para Producción" }, level: "EDIT", via: { inherited: true } }],
      },
    });
    // Solo con la capacidad de auditar accesos.
    expect(
      (
        await w.call(
          "get",
          w.editor.token,
          `/admin/access/matrix/cell?departmentId=${child.id}&spaceId=${w.spaceId}`,
        )
      ).status,
    ).toBe(403);
  });
});
