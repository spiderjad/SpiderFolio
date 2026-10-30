// Lista de espacios para muchos espacios: filtros rápidos, orden por área, favoritos y recientes
// (lo personal de cada persona) y los datos de cada tarjeta.
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

interface SpaceBody {
  id: string;
  name: string;
  favorite: boolean;
  pageCount: number;
  fileCount: number;
  department: { id: string; name: string } | null;
}

const call = (
  slug: string,
  token: string,
  method: "get" | "post" | "put",
  path: string,
  body?: object,
) =>
  request(app)
    [method](`/api/v1/w/${slug}${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

async function world() {
  const ws = await createWorkspace(ctx, "Espacios para muchos");
  const calidad = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Calidad" },
  });
  const compras = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Compras" },
  });
  const edith = await addMember(ctx, ws, { name: "Edith Editora" });
  await ctx.prisma.departmentMember.create({
    data: {
      workspaceId: ws.workspaceId,
      departmentId: calidad.id,
      membershipId: edith.membership.id,
    },
  });
  const make = async (body: object) => {
    const res = await call(ws.slug, ws.token, "post", "/spaces", body);
    expect(res.status).toBe(201);
    return (res.body as { space: SpaceBody }).space;
  };
  const zeta = await make({ name: "Zeta de la empresa" });
  const alfa = await make({ name: "Alfa de Compras", departmentId: compras.id });
  const beta = await make({ name: "Beta de Calidad", departmentId: calidad.id });
  const privado = await make({ name: "Privado de la empresa", isPrivate: true });
  return { ws, calidad, compras, edith, zeta, alfa, beta, privado };
}

const list = async (w: Awaited<ReturnType<typeof world>>, token: string, query = "") => {
  const res = await call(w.ws.slug, token, "get", `/spaces?${query}`);
  expect(res.status).toBe(200);
  return res.body as { items: SpaceBody[]; total: number };
};

describe("lista de espacios", () => {
  it("por área: primero los de la empresa y luego cada departamento por nombre, también al paginar", async () => {
    const w = await world();
    const all = await list(w, w.ws.token, "sort=department");
    expect(all.items.map((s) => s.name)).toEqual([
      "Privado de la empresa",
      "Zeta de la empresa",
      "Beta de Calidad",
      "Alfa de Compras",
    ]);
    // Dos por página: la unión de las páginas es la misma lista, sin repetir ni saltear.
    const first = await call(w.ws.slug, w.ws.token, "get", "/spaces?sort=department&pageSize=2");
    const body = first.body as { items: SpaceBody[]; nextCursor: string | null };
    expect(body.nextCursor).not.toBeNull();
    const second = await call(
      w.ws.slug,
      w.ws.token,
      "get",
      `/spaces?sort=department&pageSize=2&cursor=${body.nextCursor ?? ""}`,
    );
    const names = [...body.items, ...(second.body as { items: SpaceBody[] }).items].map(
      (s) => s.name,
    );
    expect(names).toEqual(all.items.map((s) => s.name));
  });

  it("filtros rápidos: mis departamentos, favoritos y privados", async () => {
    const w = await world();
    const mine = await list(w, w.edith.token, "filter=mine");
    expect(mine.items.map((s) => s.name)).toEqual(["Beta de Calidad"]);
    const privates = await list(w, w.ws.token, "filter=private");
    expect(privates.items.map((s) => s.name)).toEqual(["Privado de la empresa"]);

    const mark = await call(w.ws.slug, w.edith.token, "put", `/spaces/${w.zeta.id}/favorite`, {
      favorite: true,
    });
    expect(mark.status).toBe(204);
    const favorites = await list(w, w.edith.token, "filter=favorites");
    expect(favorites.items.map((s) => [s.name, s.favorite])).toEqual([
      ["Zeta de la empresa", true],
    ]);
    // Lo favorito es personal: el propietario no lo ve marcado.
    expect((await list(w, w.ws.token, "filter=favorites")).total).toBe(0);
  });

  it("no se puede marcar ni abrir un espacio al que no se tiene acceso", async () => {
    const w = await world();
    const mark = await call(w.ws.slug, w.edith.token, "put", `/spaces/${w.privado.id}/favorite`, {
      favorite: true,
    });
    expect(mark.status).toBe(404);
    const visit = await call(w.ws.slug, w.edith.token, "post", `/spaces/${w.privado.id}/visit`);
    expect(visit.status).toBe(404);
  });

  it("cada tarjeta cuenta páginas y archivos, sin carpetas ni lo que está en la papelera", async () => {
    const w = await world();
    const node = (type: "PAGE" | "FILE" | "FOLDER", name: string, trashed = false) =>
      ctx.prisma.node.create({
        data: {
          workspaceId: w.ws.workspaceId,
          spaceId: w.zeta.id,
          type,
          name,
          nameKey: name.toLowerCase(),
          position: name,
          createdById: w.edith.membership.id,
          updatedById: w.edith.membership.id,
          ...(trashed ? { trashedAt: new Date() } : {}),
        },
      });
    await node("PAGE", "a");
    await node("PAGE", "b");
    await node("PAGE", "c", true);
    await node("FILE", "d");
    await node("FOLDER", "e");
    const { items } = await list(w, w.ws.token);
    const zeta = items.find((space) => space.id === w.zeta.id);
    expect(zeta).toMatchObject({ pageCount: 2, fileCount: 1 });
    expect(items.find((space) => space.id === w.alfa.id)).toMatchObject({
      pageCount: 0,
      fileCount: 0,
    });
  });

  it("recientes: lo último que se abrió primero, solo lo propio y con acceso", async () => {
    const w = await world();
    for (const space of [w.zeta, w.beta, w.alfa]) {
      const res = await call(w.ws.slug, w.edith.token, "post", `/spaces/${space.id}/visit`);
      expect(res.status).toBe(204);
    }
    const recent = await call(w.ws.slug, w.edith.token, "get", "/spaces/recent");
    expect((recent.body as { items: SpaceBody[] }).items.map((s) => s.name)).toEqual([
      "Alfa de Compras",
      "Beta de Calidad",
      "Zeta de la empresa",
    ]);
    const others = await call(w.ws.slug, w.ws.token, "get", "/spaces/recent");
    expect((others.body as { items: SpaceBody[] }).items).toEqual([]);
  });
});
