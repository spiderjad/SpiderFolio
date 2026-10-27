// Comentarios de páginas: quién lee, quién comenta, quién edita o borra lo propio y lo ajeno, quién
// resuelve, y aislamiento entre empresas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Thread {
  id: string;
  status: string;
  canResolve: boolean;
  comments: { id: string; body: string; mine: boolean; canDelete: boolean; deleted: boolean }[];
}

const open = async (w: PagesWorld, token: string, body = "Hola") => {
  const res = await w.call("post", token, `/pages/${w.pageId}/comments`, { body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { thread: Thread }).thread;
};
const base = (w: PagesWorld, threadId: string) => `/pages/${w.pageId}/comments/${threadId}`;

describe("comentarios: ver y escribir", () => {
  it("ver pide VIEW, comentar pide COMMENT (los lectores pueden); sin acceso o de otra empresa, 404", async () => {
    const w = await pagesWorld(ctx, "Comentarios permisos");
    const list = (token: string, slug?: string) =>
      w.call("get", token, `/pages/${w.pageId}/comments`, undefined, slug);
    expect((await list(w.viewer.token)).status).toBe(200);
    expect((await list(w.stranger.token)).status).toBe(404);
    expect((await list(w.outsider.token)).status).toBe(404);
    expect((await list(w.outsider.token, w.outsider.slug)).status).toBe(404);

    const post = (token: string) =>
      w.call("post", token, `/pages/${w.pageId}/comments`, { body: "Hola" });
    expect((await post(w.viewer.token)).status).toBe(403);
    expect((await post(w.stranger.token)).status).toBe(404);
    expect((await post(w.commenter.token)).status).toBe(201);
    expect((await post(w.editor.token)).status).toBe(201);
  });

  it("no acepta comentarios vacíos ni de más de 4.000 caracteres", async () => {
    const w = await pagesWorld(ctx, "Comentarios tamaño");
    const post = (body: string) =>
      w.call("post", w.commenter.token, `/pages/${w.pageId}/comments`, { body });
    expect((await post("   ")).status).toBe(400);
    expect((await post("a".repeat(4001))).status).toBe(400);
  });

  it("en un espacio archivado no se comenta", async () => {
    const w = await pagesWorld(ctx, "Comentarios archivado");
    await w.call("post", w.ws.token, `/spaces/${w.spaceId}/archive`);
    const res = await w.call("post", w.commenter.token, `/pages/${w.pageId}/comments`, {
      body: "Tarde",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("comentarios: editar, borrar y resolver", () => {
  it("solo se edita lo propio", async () => {
    const w = await pagesWorld(ctx, "Comentarios editar");
    const thread = await open(w, w.commenter.token);
    const comment = thread.comments[0];
    const url = `${base(w, thread.id)}/messages/${comment?.id ?? ""}`;
    expect((await w.call("patch", w.editor.token, url, { body: "Cambiado" })).status).toBe(403);
    expect((await w.call("patch", w.ws.token, url, { body: "Cambiado" })).status).toBe(403);
    expect((await w.call("patch", w.commenter.token, url, { body: "Corregido" })).status).toBe(200);
  });

  it("lo propio se borra; lo ajeno solo con MANAGE", async () => {
    const w = await pagesWorld(ctx, "Comentarios borrar");
    const thread = await open(w, w.commenter.token);
    await w.call("post", w.editor.token, `${base(w, thread.id)}/replies`, { body: "Respuesta" });
    const first = thread.comments[0]?.id ?? "";
    const url = `${base(w, thread.id)}/messages/${first}`;
    // Quien edita la página pero no la gestiona no borra lo de otra persona.
    expect((await w.call("delete", w.editor.token, url)).status).toBe(403);
    // El propietario (MANAGE) sí: queda el hueco porque hay una respuesta.
    const removed = await w.call("delete", w.ws.token, url);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ threadDeleted: false });
    // Si era lo único, el hilo desaparece entero.
    const alone = await open(w, w.commenter.token, "Solo yo");
    const gone = await w.call(
      "delete",
      w.commenter.token,
      `${base(w, alone.id)}/messages/${alone.comments[0]?.id ?? ""}`,
    );
    expect(gone.body).toMatchObject({ threadDeleted: true });
    const list = await w.call("get", w.ws.token, `/pages/${w.pageId}/comments?status=all`);
    expect((list.body as { items: { id: string }[] }).items.map((t) => t.id)).not.toContain(
      alone.id,
    );
  });

  it("resuelve quien abrió el hilo o quien edita; un hilo resuelto no admite respuestas hasta reabrirlo", async () => {
    const w = await pagesWorld(ctx, "Comentarios resolver");
    const thread = await open(w, w.commenter.token);
    // Otra persona que solo comenta (no abrió el hilo) no lo resuelve.
    const second = await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: w.stranger.membership.id,
        level: "COMMENT",
        grantedById: w.ownerMembership.id,
      },
    });
    expect(second.id).toBeTruthy();
    expect((await w.call("post", w.stranger.token, `${base(w, thread.id)}/resolve`)).status).toBe(
      403,
    );
    expect((await w.call("post", w.viewer.token, `${base(w, thread.id)}/resolve`)).status).toBe(
      403,
    );
    expect((await w.call("post", w.editor.token, `${base(w, thread.id)}/resolve`)).status).toBe(
      200,
    );
    const reply = () =>
      w.call("post", w.commenter.token, `${base(w, thread.id)}/replies`, { body: "Una más" });
    expect((await reply()).status).toBe(409);
    expect((await w.call("post", w.commenter.token, `${base(w, thread.id)}/reopen`)).status).toBe(
      200,
    );
    expect((await reply()).status).toBe(201);
  });

  it("los filtros separan abiertos, resueltos y los que abrí yo", async () => {
    const w = await pagesWorld(ctx, "Comentarios filtros");
    const mine = await open(w, w.commenter.token, "Mío");
    const theirs = await open(w, w.editor.token, "De Edith");
    await w.call("post", w.editor.token, `${base(w, theirs.id)}/resolve`);
    const ids = async (query: string, token = w.commenter.token) =>
      (
        (await w.call("get", token, `/pages/${w.pageId}/comments?${query}`)).body as {
          items: { id: string }[];
        }
      ).items.map((t) => t.id);
    expect(await ids("status=open")).toEqual([mine.id]);
    expect(await ids("status=resolved")).toEqual([theirs.id]);
    expect((await ids("status=all&mine=true")).sort()).toEqual([mine.id]);
  });
});
