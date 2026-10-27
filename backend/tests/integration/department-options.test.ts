// Departamentos como opciones de un selector (Combobox): orden de árbol con nivel, y ruta al buscar.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

interface Option {
  name: string;
  depth: number;
  path: string[];
}
interface Paged<T> {
  items: T[];
  total: number;
}

describe("opciones de departamentos", () => {
  it("sin búsqueda van en orden de árbol con su nivel; al buscar, con la ruta completa", async () => {
    const ws = await createWorkspace(ctx, "Opciones árbol");
    const get = async (path: string) =>
      (
        await request(app)
          .get(`/api/v1/w/${ws.slug}/admin/departments/options${path}`)
          .set("Authorization", `Bearer ${ws.token}`)
      ).body as Paged<Option>;
    const finanzas = await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Finanzas" },
    });
    await ctx.prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Contabilidad", parentId: finanzas.id },
    });
    await ctx.prisma.department.create({ data: { workspaceId: ws.workspaceId, name: "Compras" } });

    const tree = await get("");
    expect(tree.items.map((o) => [o.name, o.depth])).toEqual([
      ["Compras", 0],
      ["Finanzas", 0],
      ["Contabilidad", 1],
    ]);
    const found = await get("?q=conta");
    expect(found.items.map((o) => o.path)).toEqual([["Finanzas", "Contabilidad"]]);
    // Paginado: de a tantos como se pidan, siguiendo el orden de árbol.
    const page2 = await get("?pageSize=2&page=2");
    expect(page2.total).toBe(3);
    expect(page2.items.map((o) => o.name)).toEqual(["Contabilidad"]);
  });
});
