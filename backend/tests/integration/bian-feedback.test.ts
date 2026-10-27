// Valoraciones de Bian: se guardan solo con valoración, motivo opcional, fecha e ids de documentos de
// la empresa; se pueden cambiar y quitar con el id que devuelve el servidor; y la vista de
// Administración cuenta por documento citado, solo con lo que quien mira puede ver.
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

const vote = async (w: PagesWorld, token: string, body: object) => {
  const res = await w.call("post", token, "/bian/feedback", body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
};

interface Stats {
  total: number;
  up: number;
  down: number;
  percentUp: number | null;
  documents: {
    total: number;
    nextCursor: string | null;
    items: {
      node: { id: string };
      up: number;
      down: number;
      reasons: Record<string, number>;
    }[];
  };
}

describe("valoraciones: guardar, cambiar y quitar", () => {
  it("el 👎 guarda su motivo; cambiar a 👍 lo borra; quitar la elimina; el motivo es de una lista", async () => {
    const w = await pagesWorld(ctx, "Bian valoración");
    const id = await vote(w, w.viewer.token, {
      rating: "DOWN",
      reason: "INCOMPLETE",
      nodeIds: [w.pageId],
    });
    const row = () => ctx.prisma.bianFeedback.findUnique({ where: { id } });
    expect(await row()).toMatchObject({ rating: "DOWN", reason: "INCOMPLETE" });

    expect(
      (await w.call("patch", w.viewer.token, `/bian/feedback/${id}`, { reason: "OTHER" })).status,
    ).toBe(204);
    expect((await row())?.reason).toBe("OTHER");
    expect(
      (await w.call("patch", w.viewer.token, `/bian/feedback/${id}`, { reason: "INVENTADO" }))
        .status,
    ).toBe(400);

    // Pasar a 👍 deja la valoración sin motivo.
    await w.call("patch", w.viewer.token, `/bian/feedback/${id}`, { rating: "UP" });
    expect(await row()).toMatchObject({ rating: "UP", reason: null });

    expect((await w.call("delete", w.viewer.token, `/bian/feedback/${id}`)).status).toBe(204);
    expect(await row()).toBeNull();
    expect((await w.call("delete", w.viewer.token, `/bian/feedback/${id}`)).status).toBe(404);
  });

  it("una valoración de otra empresa no se puede tocar", async () => {
    const w = await pagesWorld(ctx, "Bian valoración ajena");
    const id = await vote(w, w.viewer.token, { rating: "UP", nodeIds: [] });
    // Con su propio espacio de trabajo, la persona de la otra empresa no la encuentra.
    const theirs = await w.call(
      "delete",
      w.outsider.token,
      `/bian/feedback/${id}`,
      undefined,
      w.outsider.slug,
    );
    expect(theirs.status).toBe(404);
    expect(await ctx.prisma.bianFeedback.count({ where: { id } })).toBe(1);
  });
});

describe("vista de Administración", () => {
  it("cuenta el % de 👍 y los 👎 por documento citado; solo lo permite security.manage", async () => {
    const w = await pagesWorld(ctx, "Bian estadísticas");
    const confusing = w.pageId;
    const good = (await w.makePage()).node.id;
    await vote(w, w.viewer.token, { rating: "UP", nodeIds: [good, confusing] });
    await vote(w, w.viewer.token, { rating: "UP", nodeIds: [good] });
    await vote(w, w.viewer.token, { rating: "DOWN", reason: "INCORRECT", nodeIds: [confusing] });
    await vote(w, w.viewer.token, { rating: "DOWN", nodeIds: [confusing] });

    const res = await w.call("get", w.ws.token, "/admin/bian/feedback");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stats = res.body as Stats;
    expect(stats).toMatchObject({ total: 4, up: 2, down: 2, percentUp: 50 });
    // Primero el que más 👎 tiene.
    expect(stats.documents.items.map((d) => d.node.id)).toEqual([confusing, good]);
    expect(stats.documents.items[0]).toMatchObject({ up: 1, down: 2 });
    expect(stats.documents.items[0]?.reasons).toMatchObject({ INCORRECT: 1, NONE: 1 });

    // Quien no gestiona la seguridad no la ve; de otra empresa, nada.
    expect((await w.call("get", w.viewer.token, "/admin/bian/feedback")).status).toBe(403);
    expect((await w.call("get", w.outsider.token, "/admin/bian/feedback")).status).toBe(404);
  });

  it("un administrador no ve los documentos confidenciales que Bian citó", async () => {
    const w = await pagesWorld(ctx, "Bian estadísticas confidencial");
    const role = await ctx.prisma.role.create({
      data: {
        workspaceId: w.ws.workspaceId,
        name: "Administra seguridad",
        base: "ADMIN",
        capabilities: ["security.manage"],
      },
    });
    const admin = await addMember(ctx, w.ws, { roleId: role.id, name: "Ada Administra" });
    const created = await w.call("post", w.ws.token, "/spaces", {
      name: "Reservado",
      isPrivate: true,
      isConfidential: true,
    });
    const secretSpace = (created.body as { space: { id: string } }).space.id;
    const page = await w.call("post", w.ws.token, `/spaces/${secretSpace}/pages`, {});
    const secret = (page.body as { page: { node: { id: string } } }).page.node.id;
    await vote(w, w.viewer.token, { rating: "DOWN", nodeIds: [secret, w.pageId] });

    const owner = (await w.call("get", w.ws.token, "/admin/bian/feedback")).body as Stats;
    expect(owner.documents.items.map((d) => d.node.id).sort()).toEqual([secret, w.pageId].sort());
    const seen = await w.call("get", admin.token, "/admin/bian/feedback");
    expect(seen.status).toBe(200);
    const adminView = seen.body as Stats;
    expect(adminView.documents.items.map((d) => d.node.id)).toEqual([w.pageId]);
    expect(JSON.stringify(adminView)).not.toContain(secret);
  });
});

describe("vista de valoraciones: filtros y paginación", () => {
  it("filtra por valoración, documento y fecha, y pagina con cursor; los totales son los de lo filtrado", async () => {
    const w = await pagesWorld(ctx, "Bian filtros");
    const pages: string[] = [w.pageId];
    for (let i = 0; i < 2; i += 1)
      pages.push((await w.makePage(w.ws.token, { name: `Documento extra ${String(i)}` })).node.id);
    await ctx.prisma.node.update({
      where: { id: pages[1] ?? "" },
      data: { name: "Manual de calidad" },
    });
    // 👎 sobre cada documento (más sobre el primero) y un 👍 sobre el segundo.
    await vote(w, w.viewer.token, { rating: "DOWN", nodeIds: [pages[0] ?? ""] });
    await vote(w, w.viewer.token, { rating: "DOWN", nodeIds: [pages[0] ?? ""] });
    await vote(w, w.viewer.token, { rating: "DOWN", nodeIds: [pages[1] ?? ""] });
    await vote(w, w.viewer.token, { rating: "UP", nodeIds: [pages[1] ?? ""] });
    await vote(w, w.viewer.token, { rating: "DOWN", nodeIds: [pages[2] ?? ""] });
    const get = async (query: string) =>
      (await w.call("get", w.ws.token, `/admin/bian/feedback${query}`)).body as Stats;

    // Paginado: de a un documento, con cursor, y el total de documentos aparte.
    const first = await get("?pageSize=1");
    expect(first.documents.total).toBe(3);
    expect(first.documents.items).toHaveLength(1);
    expect(first.documents.items[0]?.node.id).toBe(pages[0]);
    expect(first.documents.nextCursor).not.toBeNull();
    const second = await get(
      `?pageSize=1&cursor=${encodeURIComponent(first.documents.nextCursor ?? "")}`,
    );
    expect(second.documents.items).toHaveLength(1);
    expect(second.documents.items[0]?.node.id).not.toBe(pages[0]);
    expect((await w.call("get", w.ws.token, "/admin/bian/feedback?cursor=no-sirve")).status).toBe(
      400,
    );

    // Por valoración: solo los 👍.
    const ups = await get("?rating=UP");
    expect(ups).toMatchObject({ up: 1, down: 0, percentUp: 100 });
    expect(ups.documents.items.map((d) => d.node.id)).toEqual([pages[1]]);
    // Por documento (texto del nombre).
    const byName = await get("?q=manual");
    expect(byName.documents.items.map((d) => d.node.id)).toEqual([pages[1]]);
    // Por fecha: nada fuera del rango; hoy sí.
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`?from=${today}&to=${today}`)).total).toBe(5);
    expect((await get("?from=2020-01-01&to=2020-01-31")).total).toBe(0);
  });
});
