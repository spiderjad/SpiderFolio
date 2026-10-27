// Menciones: solo avisan, nunca dan acceso. Quien no ve la página no recibe el aviso hasta que
// alguien que la gestiona le da acceso; darlo es una decisión explícita y con tope por plaza.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const token = (name: string, id: string) => `@[${name}](${id})`;

const comment = (w: PagesWorld, who: string, body: string) =>
  w.call("post", who, `/pages/${w.pageId}/comments`, { body });

const permissionsOf = (membershipId: string) =>
  ctx.prisma.permission.count({ where: { membershipId } });

describe("menciones en comentarios", () => {
  it("mencionar a quien no ve la página no le da acceso ni le avisa; a quien sí la ve, le avisa", async () => {
    const w = await pagesWorld(ctx, "Menciones");
    const before = await permissionsOf(w.stranger.membership.id);
    const res = await comment(
      w,
      w.editor.token,
      `Mira ${token("Sofía", w.stranger.membership.id)} y ${token("Vera", w.viewer.membership.id)}`,
    );
    expect(res.status).toBe(201);
    expect((res.body as { withoutAccess: { id: string }[] }).withoutAccess).toEqual([
      { id: w.stranger.membership.id, name: "Sofía Sinacceso" },
    ]);
    // Nada de acceso automático.
    expect(await permissionsOf(w.stranger.membership.id)).toBe(before);
    expect((await w.call("get", w.stranger.token, `/pages/${w.pageId}`)).status).toBe(404);
    const rows = await ctx.prisma.mention.findMany({ where: { nodeId: w.pageId } });
    const byPerson = new Map(rows.map((row) => [row.mentionedId, row.notifiedAt]));
    expect(byPerson.get(w.stranger.membership.id)).toBeNull();
    expect(byPerson.get(w.viewer.membership.id)).not.toBeNull();
  });

  it("no avisa dos veces por la misma mención ni se avisa uno mismo", async () => {
    const w = await pagesWorld(ctx, "Menciones repetidas");
    const body = `Hola ${token("Vera", w.viewer.membership.id)} ${token("yo", w.editor.membership.id)}`;
    const first = await comment(w, w.editor.token, body);
    const threadId = (first.body as { thread: { id: string; comments: { id: string }[] } }).thread;
    const edit = await w.call(
      "patch",
      w.editor.token,
      `/pages/${w.pageId}/comments/${threadId.id}/messages/${threadId.comments[0]?.id ?? ""}`,
      { body: `${body} (corregido)` },
    );
    expect(edit.status).toBe(200);
    const rows = await ctx.prisma.mention.findMany({ where: { nodeId: w.pageId } });
    expect(rows.filter((row) => row.mentionedId === w.viewer.membership.id)).toHaveLength(1);
    expect(rows.some((row) => row.mentionedId === w.editor.membership.id)).toBe(false);
  });

  it("una mención de alguien que no es de la empresa se ignora", async () => {
    const w = await pagesWorld(ctx, "Menciones ajenas");
    const res = await comment(w, w.editor.token, `Hola ${token("X", w.outsider.membershipId)}`);
    expect(res.status).toBe(201);
    expect(await ctx.prisma.mention.count({ where: { nodeId: w.pageId } })).toBe(0);
  });
});

describe("menciones en el texto de la página", () => {
  it("al guardar, avisa solo a quien ve la página y devuelve quiénes no la ven", async () => {
    const w = await pagesWorld(ctx, "Menciones en texto");
    const mention = (id: string, label: string) => ({
      type: "mention",
      attrs: { membershipId: id, label },
    });
    const content = doc({
      type: "paragraph",
      content: [
        mention(w.viewer.membership.id, "Vera"),
        mention(w.stranger.membership.id, "Sofía"),
      ],
    });
    const res = await w.save(w.editor.token, w.pageId, w.page.revision, content);
    expect(res.status).toBe(200);
    expect(
      (res.body as { withoutAccess: { id: string }[] }).withoutAccess.map((p) => p.id),
    ).toEqual([w.stranger.membership.id]);
    expect(await permissionsOf(w.stranger.membership.id)).toBe(0);
    // Guardar otra vez lo mismo no repite el aviso.
    const again = await w.save(w.editor.token, w.pageId, 2, content);
    expect((again.body as { withoutAccess: unknown[] }).withoutAccess).toEqual([]);
  });
});

describe("candidatos y dar acceso", () => {
  it("los candidatos dicen quién ya ve la página; sin acceso a la página, 404", async () => {
    const w = await pagesWorld(ctx, "Candidatos");
    const res = await w.call("get", w.ws.token, `/pages/${w.pageId}/mention-candidates?q=`);
    expect(res.status).toBe(200);
    const items = (res.body as { items: { id: string; hasAccess: boolean }[] }).items;
    const flag = (id: string) => items.find((item) => item.id === id)?.hasAccess;
    expect(flag(w.editor.membership.id)).toBe(true);
    expect(flag(w.stranger.membership.id)).toBe(false);
    expect(
      (await w.call("get", w.stranger.token, `/pages/${w.pageId}/mention-candidates?q=`)).status,
    ).toBe(404);
    expect(
      (await w.call("get", w.outsider.token, `/pages/${w.pageId}/mention-candidates?q=`)).status,
    ).toBe(404);
  });

  it("dar acceso pide MANAGE sobre la página, respeta los topes de lectores y envía el aviso pendiente", async () => {
    const w = await pagesWorld(ctx, "Dar acceso");
    await comment(w, w.editor.token, `Hola ${token("Sofía", w.stranger.membership.id)}`);
    const grant = (who: string, membershipId: string, level: string) =>
      w.call("put", who, `/nodes/${w.pageId}/permissions`, { membershipId, level });
    // Quien edita pero no gestiona no puede.
    expect((await grant(w.editor.token, w.stranger.membership.id, "VIEW")).status).toBe(403);
    expect((await grant(w.commenter.token, w.stranger.membership.id, "VIEW")).status).toBe(403);
    expect((await grant(w.outsider.token, w.stranger.membership.id, "VIEW")).status).toBe(404);
    expect(await permissionsOf(w.stranger.membership.id)).toBe(0);
    // Un lector (plaza de lector) no puede quedar con EDIT.
    const reader = await addMember(ctx, w.ws, { name: "Lola Lectora", seatType: "READER" });
    expect((await grant(w.ws.token, reader.membership.id, "EDIT")).status).toBe(400);
    // El propietario sí, y el aviso pendiente sale.
    const ok = await grant(w.ws.token, w.stranger.membership.id, "COMMENT");
    expect(ok.status).toBe(200);
    expect((await w.call("get", w.stranger.token, `/pages/${w.pageId}`)).status).toBe(200);
    const mention = await ctx.prisma.mention.findFirstOrThrow({
      where: { nodeId: w.pageId, mentionedId: w.stranger.membership.id },
    });
    expect(mention.notifiedAt).not.toBeNull();
    // Solo a esa página: el resto del espacio sigue sin verlo.
    const other = await w.makePage();
    expect((await w.call("get", w.stranger.token, `/pages/${other.node.id}`)).status).toBe(404);
  });

  it("no se da acceso a alguien suspendido ni a una persona de otra empresa", async () => {
    const w = await pagesWorld(ctx, "Dar acceso inválido");
    const ghost = await addMember(ctx, w.ws, { name: "Suspendido", status: "SUSPENDED" });
    const call = (membershipId: string) =>
      w.call("put", w.ws.token, `/nodes/${w.pageId}/permissions`, { membershipId, level: "VIEW" });
    expect((await call(ghost.membership.id)).status).toBe(400);
    expect((await call(w.outsider.membershipId)).status).toBe(400);
  });
});
