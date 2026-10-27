// Búsqueda rápida (paleta Ctrl+K): solo devuelve lo que la persona ve, por título y por código, y
// nada de otra empresa.
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

interface Quick {
  documents: { id: string; name: string; code: string | null; spaceName: string }[];
  folders: { id: string; name: string }[];
  spaces: { id: string; name: string }[];
  people: { id: string; name: string }[];
}

const quick = async (w: PagesWorld, token: string, q: string, slug = w.ws.slug) => {
  const res = await w.call(
    "get",
    token,
    `/search/quick?q=${encodeURIComponent(q)}`,
    undefined,
    slug,
  );
  expect(res.status).toBe(200);
  return res.body as Quick;
};

async function named(w: PagesWorld, name: string): Promise<string> {
  const id = (await w.makePage()).node.id;
  expect((await w.call("patch", w.ws.token, `/nodes/${id}`, { name })).status).toBe(200);
  return id;
}

describe("búsqueda rápida", () => {
  it("encuentra por título y por código, agrupado, con acentos y mayúsculas indistintas", async () => {
    const w = await pagesWorld(ctx, "Búsqueda básica");
    const page = await named(w, "Procedimiento de Limpieza");
    await w.call("post", w.ws.token, `/nodes/${page}/controlled`, { docType: "PRC" });
    const folder = (
      await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, { name: "Limpieza general" })
    ).body as { node: { id: string } };

    const byTitle = await quick(w, w.editor.token, "limpieza");
    expect(byTitle.documents.map((d) => d.id)).toEqual([page]);
    expect(byTitle.documents[0]).toMatchObject({ code: "PRC-001", spaceName: "Calidad" });
    expect(byTitle.folders.map((f) => f.id)).toEqual([folder.node.id]);

    expect((await quick(w, w.editor.token, "PRC-001")).documents.map((d) => d.id)).toEqual([page]);
    expect((await quick(w, w.editor.token, "prc-0")).documents.map((d) => d.id)).toEqual([page]);
    // Espacios y personas.
    expect((await quick(w, w.editor.token, "calid")).spaces.map((s) => s.name)).toEqual([
      "Calidad",
    ]);
    expect((await quick(w, w.ws.token, "edith")).people.map((p) => p.name)).toEqual([
      "Edith Editora",
    ]);
    // Sin texto no devuelve nada.
    expect(await quick(w, w.editor.token, "")).toEqual({
      documents: [],
      folders: [],
      spaces: [],
      people: [],
    });
  });

  it("no muestra lo que la persona no ve, ni siquiera el título, ni lo de otra empresa", async () => {
    const w = await pagesWorld(ctx, "Búsqueda permisos");
    await named(w, "Plan secreto de despidos");
    const hidden = await quick(w, w.stranger.token, "secreto");
    expect(hidden).toEqual({ documents: [], folders: [], spaces: [], people: [] });
    expect(JSON.stringify(await quick(w, w.stranger.token, "calidad"))).not.toContain("Calidad");
    // Quien lo ve, lo encuentra.
    expect((await quick(w, w.viewer.token, "secreto")).documents).toHaveLength(1);

    // Otra empresa con una página del mismo título: cada una ve solo lo suyo.
    const other = w.outsider;
    const created = await w.call(
      "post",
      other.token,
      "/spaces",
      { name: "Ajeno", isPrivate: false },
      other.slug,
    );
    const spaceId = (created.body as { space: { id: string } }).space.id;
    const page = await w.call("post", other.token, `/spaces/${spaceId}/pages`, {}, other.slug);
    const otherId = (page.body as { page: { node: { id: string } } }).page.node.id;
    await w.call(
      "patch",
      other.token,
      `/nodes/${otherId}`,
      { name: "Plan secreto ajeno" },
      other.slug,
    );
    const theirs = await quick(w, other.token, "secreto", other.slug);
    expect(theirs.documents.map((d) => d.name)).toEqual(["Plan secreto ajeno"]);
    expect(JSON.stringify(theirs)).not.toContain("despidos");
    const mine = await quick(w, w.ws.token, "secreto");
    expect(mine.documents.map((d) => d.name)).toEqual(["Plan secreto de despidos"]);
    expect(JSON.stringify(mine)).not.toContain("ajeno");
  });

  it("una carpeta compartida a una persona sin acceso al espacio le aparece, y lo de adentro también", async () => {
    const w = await pagesWorld(ctx, "Búsqueda compartido");
    const folder = (
      await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, {
        name: "Carpeta de auditoría",
      })
    ).body as { node: { id: string } };
    const insideId = (await w.makePage(w.ws.token, { parentId: folder.node.id })).node.id;
    await w.call("patch", w.ws.token, `/nodes/${insideId}`, { name: "Acta de auditoría" });
    const guest = await addMember(ctx, w.ws, { name: "Gabi Compartida" });
    expect((await quick(w, guest.token, "auditoría")).documents).toEqual([]);
    expect(
      (
        await w.call("put", w.ws.token, `/nodes/${folder.node.id}/permissions`, {
          membershipId: guest.membership.id,
          level: "VIEW",
        })
      ).status,
    ).toBe(200);
    const found = await quick(w, guest.token, "auditoría");
    expect(found.folders.map((f) => f.id)).toEqual([folder.node.id]);
    expect(found.documents.map((d) => d.id)).toEqual([insideId]);
  });

  it("«Nueva página»: solo los espacios donde puede crear", async () => {
    const w = await pagesWorld(ctx, "Búsqueda nueva página");
    const spaces = async (token: string) =>
      ((await w.call("get", token, "/search/quick?q=&spaces=writable")).body as Quick).spaces.map(
        (s) => s.name,
      );
    expect(await spaces(w.editor.token)).toEqual(["Calidad"]);
    expect(await spaces(w.viewer.token)).toEqual([]);
    expect(await spaces(w.stranger.token)).toEqual([]);
  });
});
