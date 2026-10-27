// Imágenes de páginas: solo quien edita las sube, solo JPG/PNG/WebP reales del tamaño pedido, se
// leen con los permisos de la página, cuentan para la cuota y no se pueden usar en otra página.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(64),
]);

/** Pide la subida y manda los bytes a S3; devuelve el id y la clave (sin confirmar). */
async function upload(w: PagesWorld, token: string, pageId: string, bytes: Buffer) {
  const start = await w.call("post", token, `/pages/${pageId}/images`, {
    contentType: "image/webp",
    size: bytes.length,
  });
  if (start.status !== 201) return { start };
  const { imageId, url } = start.body as { imageId: string; url: string };
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/webp" },
    body: new Uint8Array(bytes),
  });
  expect(put.ok).toBe(true);
  return { start, imageId };
}

const confirm = (w: PagesWorld, token: string, pageId: string, imageId: string) =>
  w.call("post", token, `/pages/${pageId}/images/${imageId}/confirm`);

const usedBytes = async (w: PagesWorld) =>
  (await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } }))
    .storageUsedBytes;

describe("subir una imagen a una página", () => {
  it("pide EDIT; sin acceso es 404; el tamaño tiene tope", async () => {
    const w = await pagesWorld(ctx, "Imágenes permisos");
    const ask = (token: string, size = 100) =>
      w.call("post", token, `/pages/${w.pageId}/images`, { contentType: "image/webp", size });
    expect((await ask(w.editor.token)).status).toBe(201);
    expect((await ask(w.commenter.token)).status).toBe(403);
    expect((await ask(w.viewer.token)).status).toBe(403);
    expect((await ask(w.stranger.token)).status).toBe(404);
    expect((await ask(w.outsider.token)).status).toBe(404);
    expect((await ask(w.editor.token, 10 * 1024 * 1024 + 1)).status).toBe(400);
    // Solo imágenes: no se pide subir otro tipo de archivo.
    const bad = await w.call("post", w.editor.token, `/pages/${w.pageId}/images`, {
      contentType: "text/html",
      size: 100,
    });
    expect(bad.status).toBe(400);
  });

  it("lo que no es una imagen real se descarta al confirmar, aunque se haya declarado WebP", async () => {
    const w = await pagesWorld(ctx, "Imágenes falsas");
    const sent = await upload(
      w,
      w.editor.token,
      w.pageId,
      Buffer.from("<html><script>x</script></html>"),
    );
    const imageId = sent.imageId ?? "";
    const res = await confirm(w, w.editor.token, w.pageId, imageId);
    expect(res.status).toBe(400);
    expect(await ctx.prisma.pageImage.count({ where: { id: imageId } })).toBe(0);
    expect(await usedBytes(w)).toBe(0n);
  });

  it("un tamaño distinto del pedido tampoco se confirma", async () => {
    const w = await pagesWorld(ctx, "Imágenes tamaño");
    const start = await w.call("post", w.editor.token, `/pages/${w.pageId}/images`, {
      contentType: "image/webp",
      size: WEBP.length + 100,
    });
    const { imageId, url } = start.body as { imageId: string; url: string };
    // El navegador no puede mandar otra cosa (el tamaño va firmado); si S3 lo aceptara, se descarta.
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: new Uint8Array(WEBP),
    }).catch(() => undefined);
    const res = await confirm(w, w.editor.token, w.pageId, imageId);
    expect(res.status).toBe(400);
    expect(await usedBytes(w)).toBe(0n);
  });

  it("confirma una imagen válida, suma a la cuota y la leen quienes ven la página", async () => {
    const w = await pagesWorld(ctx, "Imágenes ok");
    const sent = await upload(w, w.editor.token, w.pageId, WEBP);
    const imageId = sent.imageId ?? "";
    // Solo quien la pidió la confirma.
    expect((await confirm(w, w.ws.token, w.pageId, imageId)).status).toBe(404);
    expect((await confirm(w, w.editor.token, w.pageId, imageId)).status).toBe(200);
    expect(await usedBytes(w)).toBe(BigInt(WEBP.length));
    const read = (token: string, pageId = w.pageId) =>
      w.call("get", token, `/pages/${pageId}/images/${imageId}`);
    expect((await read(w.viewer.token)).status).toBe(200);
    expect((await read(w.stranger.token)).status).toBe(404);
    expect((await read(w.outsider.token)).status).toBe(404);
    // Con el id de otra página no se lee.
    const other = await w.makePage();
    expect((await read(w.ws.token, other.node.id)).status).toBe(404);
  });
});

describe("usar la imagen en el texto", () => {
  it("solo imágenes confirmadas de la misma página", async () => {
    const w = await pagesWorld(ctx, "Imágenes en el texto");
    const other = await w.makePage();
    const pending = await upload(w, w.editor.token, w.pageId, WEBP);
    const confirmed = await upload(w, w.editor.token, w.pageId, WEBP);
    await confirm(w, w.editor.token, w.pageId, confirmed.imageId ?? "");
    const foreign = await upload(w, w.editor.token, other.node.id, WEBP);
    await confirm(w, w.editor.token, other.node.id, foreign.imageId ?? "");
    const withImage = (id: string) => doc({ type: "pageImage", attrs: { imageId: id, alt: "" } });
    const put = async (id: string) =>
      (await w.save(w.editor.token, w.pageId, w.page.revision, withImage(id))).status;
    expect(await put(pending.imageId ?? "")).toBe(400);
    expect(await put(foreign.imageId ?? "")).toBe(400);
    expect(await put(confirmed.imageId ?? "")).toBe(200);
  });

  it("al purgar la página de la papelera se libera la cuota y se borran los archivos", async () => {
    const w = await pagesWorld(ctx, "Imágenes purga");
    const page = await w.makePage();
    const sent = await upload(w, w.editor.token, page.node.id, WEBP);
    await confirm(w, w.editor.token, page.node.id, sent.imageId ?? "");
    expect(await usedBytes(w)).toBe(BigInt(WEBP.length));
    const key = (
      await ctx.prisma.pageImage.findUniqueOrThrow({ where: { id: sent.imageId ?? "" } })
    ).storageKey;
    expect((await w.call("delete", w.ws.token, `/nodes/${page.node.id}`)).status).toBe(204);
    expect((await w.call("delete", w.ws.token, `/nodes/${page.node.id}/purge`)).status).toBe(204);
    expect(await usedBytes(w)).toBe(0n);
    expect(await ctx.prisma.pageImage.count({ where: { nodeId: page.node.id } })).toBe(0);
    // El borrado del objeto lo hace el worker (cola): la fila y la cuota ya no existen.
    expect(key).toContain(page.node.id);
  });
});
