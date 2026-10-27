// Páginas: permisos por nivel de acceso, aislamiento entre empresas, control de conflictos
// (revisión optimista), saneado del contenido y comentarios anclados de quien solo comenta.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, paragraph } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe("páginas: crear y leer", () => {
  it("crear pide EDIT en el destino; sin acceso ni se entera de que existe", async () => {
    const w = await pagesWorld(ctx, "Páginas crear");
    const create = (token: string) => w.call("post", token, `/spaces/${w.spaceId}/pages`, {});
    expect((await create(w.editor.token)).status).toBe(201);
    expect((await create(w.commenter.token)).status).toBe(403);
    expect((await create(w.viewer.token)).status).toBe(403);
    expect((await create(w.stranger.token)).status).toBe(404);
    expect((await create(w.outsider.token)).status).toBe(404);
  });

  it("leer pide VIEW; otra empresa o sin acceso: 404", async () => {
    const w = await pagesWorld(ctx, "Páginas leer");
    expect((await w.call("get", w.viewer.token, `/pages/${w.pageId}`)).status).toBe(200);
    expect((await w.call("get", w.stranger.token, `/pages/${w.pageId}`)).status).toBe(404);
    // Una persona de otra empresa, ni con el slug propio ni con el ajeno.
    expect(
      (await w.call("get", w.outsider.token, `/pages/${w.pageId}`, undefined, w.outsider.slug))
        .status,
    ).toBe(404);
    expect((await w.call("get", w.outsider.token, `/pages/${w.pageId}`)).status).toBe(404);
  });

  it("una página puede tener subpáginas y aparecen entre sus hijos", async () => {
    const w = await pagesWorld(ctx, "Subpáginas");
    const child = await w.makePage(w.ws.token, { parentId: w.pageId, name: "Hija" });
    const list = await w.call(
      "get",
      w.ws.token,
      `/spaces/${w.spaceId}/nodes?parent=${w.pageId}&type=CONTAINER`,
    );
    expect(list.status).toBe(200);
    expect((list.body as { items: { id: string }[] }).items.map((n) => n.id)).toEqual([
      child.node.id,
    ]);
  });

  it("una página en la papelera no se lee ni se guarda", async () => {
    const w = await pagesWorld(ctx, "Papelera de páginas");
    expect((await w.call("delete", w.ws.token, `/nodes/${w.pageId}`)).status).toBe(204);
    expect((await w.call("get", w.ws.token, `/pages/${w.pageId}`)).status).toBe(404);
    expect((await w.save(w.ws.token, w.pageId, 1, doc(paragraph("x")))).status).toBe(404);
  });
});

describe("páginas: guardar", () => {
  it("la revisión evita pisar el trabajo de otra persona (409) y avanza con cada guardado", async () => {
    const w = await pagesWorld(ctx, "Conflictos");
    const first = await w.save(w.editor.token, w.pageId, w.page.revision, doc(paragraph("Edith")));
    expect(first.status).toBe(200);
    const revision = (first.body as { revision: number }).revision;
    expect(revision).toBe(w.page.revision + 1);
    // El propietario quedó con la revisión vieja: no pisa lo de Edith.
    const stale = await w.save(w.ws.token, w.pageId, w.page.revision, doc(paragraph("Dueña")));
    expect(stale.status).toBe(409);
    const stored = await ctx.prisma.pageContent.findUniqueOrThrow({ where: { nodeId: w.pageId } });
    expect(JSON.stringify(stored.content)).toContain("Edith");
    expect((await w.save(w.ws.token, w.pageId, revision, doc(paragraph("Dueña")))).status).toBe(
      200,
    );
  });

  it("dos guardados simultáneos con la misma revisión: solo uno entra", async () => {
    const w = await pagesWorld(ctx, "Carrera");
    const results = await Promise.all([
      w.save(w.editor.token, w.pageId, w.page.revision, doc(paragraph("A"))),
      w.save(w.ws.token, w.pageId, w.page.revision, doc(paragraph("B"))),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("solo EDIT cambia el texto; quien ve no guarda y sin acceso es 404", async () => {
    const w = await pagesWorld(ctx, "Permisos de guardado");
    const content = doc(paragraph("Nuevo"));
    expect((await w.save(w.viewer.token, w.pageId, 1, content)).status).toBe(403);
    expect((await w.save(w.stranger.token, w.pageId, 1, content)).status).toBe(404);
    expect((await w.save(w.outsider.token, w.pageId, 1, content)).status).toBe(404);
    expect((await w.save(w.commenter.token, w.pageId, 1, content)).status).toBe(403);
  });

  it("quien solo comenta guarda únicamente marcas de hilos de su página, no cambios de texto", async () => {
    const w = await pagesWorld(ctx, "Comentar anclado");
    const base = await w.save(w.ws.token, w.pageId, 1, doc(paragraph("hola mundo")));
    let revision = (base.body as { revision: number }).revision;
    const thread = await w.call("post", w.commenter.token, `/pages/${w.pageId}/comments`, {
      body: "¿Seguro?",
      quote: "hola",
    });
    expect(thread.status).toBe(201);
    const threadId = (thread.body as { thread: { id: string } }).thread.id;
    const marked = doc(paragraph("hola mundo", [{ type: "commentThread", attrs: { threadId } }]));
    const ok = await w.save(w.commenter.token, w.pageId, revision, marked);
    expect(ok.status).toBe(200);
    revision = (ok.body as { revision: number }).revision;
    // Cambiar el texto de paso no vale.
    const sneaky = doc(paragraph("chau mundo", [{ type: "commentThread", attrs: { threadId } }]));
    expect((await w.save(w.commenter.token, w.pageId, revision, sneaky)).status).toBe(403);
    // Ni agregar bloques nuevos.
    const extra = doc(
      paragraph("hola mundo", [{ type: "commentThread", attrs: { threadId } }]),
      paragraph("otro"),
    );
    expect((await w.save(w.commenter.token, w.pageId, revision, extra)).status).toBe(403);
    // Una marca que no es de un hilo de esta página tampoco.
    const foreign = doc(
      paragraph("hola mundo", [{ type: "commentThread", attrs: { threadId: "ajeno" } }]),
    );
    expect((await w.save(w.editor.token, w.pageId, revision, foreign)).status).toBe(400);
  });

  it("rechaza contenido inválido, enlaces peligrosos, imágenes ajenas y menciones de desconocidos", async () => {
    const w = await pagesWorld(ctx, "Saneado");
    const put = async (content: unknown) =>
      (await w.save(w.editor.token, w.pageId, 1, content)).status;
    expect(await put({ type: "doc", content: [{ type: "script" }] })).toBe(400);
    expect(
      await put(doc(paragraph("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))),
    ).toBe(400);
    expect(await put(doc({ type: "pageImage", attrs: { imageId: "no-es-de-esta-pagina" } }))).toBe(
      400,
    );
    expect(
      await put(
        doc({
          type: "paragraph",
          content: [{ type: "mention", attrs: { membershipId: "nadie", label: "Nadie" } }],
        }),
      ),
    ).toBe(400);
    expect(await put(doc(paragraph("a".repeat(950_000))))).toBeGreaterThanOrEqual(400);
    const stored = await ctx.prisma.pageContent.findUniqueOrThrow({ where: { nodeId: w.pageId } });
    expect(stored.revision).toBe(1);
  });

  it("en un espacio archivado la página es de solo lectura", async () => {
    const w = await pagesWorld(ctx, "Archivado");
    expect((await w.call("post", w.ws.token, `/spaces/${w.spaceId}/archive`)).status).toBe(200);
    const res = await w.save(w.editor.token, w.pageId, 1, doc(paragraph("tarde")));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await w.call("get", w.editor.token, `/pages/${w.pageId}`)).status).toBe(200);
    const stored = await ctx.prisma.pageContent.findUniqueOrThrow({ where: { nodeId: w.pageId } });
    expect(stored.revision).toBe(1);
  });
});
