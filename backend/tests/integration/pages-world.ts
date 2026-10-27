// Escenario común de las pruebas de páginas: una empresa con un espacio privado y personas con cada
// nivel de acceso (edita, comenta, ve, ninguno), una segunda empresa y una página del propietario.
import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createWorkspace, type TestContext } from "./helpers.ts";

export const doc = (...content: unknown[]) => ({ type: "doc", content });
export const paragraph = (text: string, marks?: unknown[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks === undefined ? {} : { marks }) }],
});

export async function pagesWorld(ctx: TestContext, label: string) {
  const app = createApp(ctx.deps);
  const ws = await createWorkspace(ctx, label);
  const outsider = await createWorkspace(ctx, `${label} ajena`);
  const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
    where: { workspaceId: ws.workspaceId, role: { base: "OWNER" } },
  });

  const call = (
    method: "get" | "post" | "put" | "patch" | "delete",
    token: string,
    path: string,
    body?: object,
    slug = ws.slug,
  ) =>
    request(app)
      [method](`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const created = await call("post", ws.token, "/spaces", { name: "Calidad", isPrivate: true });
  expect(created.status).toBe(201);
  const spaceId = (created.body as { space: { id: string } }).space.id;

  const person = async (name: string, level: "EDIT" | "COMMENT" | "VIEW" | null) => {
    const member = await addMember(ctx, ws, { name });
    if (level !== null) {
      await ctx.prisma.permission.create({
        data: {
          workspaceId: ws.workspaceId,
          spaceId,
          membershipId: member.membership.id,
          level,
          grantedById: ownerMembership.id,
        },
      });
    }
    return member;
  };
  const editor = await person("Edith Editora", "EDIT");
  const commenter = await person("Carla Comenta", "COMMENT");
  const viewer = await person("Vera Visora", "VIEW");
  const stranger = await person("Sofía Sinacceso", null);

  const makePage = async (token = ws.token, body: object = {}) => {
    const res = await call("post", token, `/spaces/${spaceId}/pages`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { page: { node: { id: string }; revision: number } }).page;
  };
  const page = await makePage();

  const save = (token: string, pageId: string, baseRevision: number, content: unknown) =>
    call("put", token, `/pages/${pageId}/content`, { baseRevision, content });

  return {
    app,
    ws,
    outsider,
    ownerMembership,
    spaceId,
    editor,
    commenter,
    viewer,
    stranger,
    page,
    pageId: page.node.id,
    call,
    makePage,
    save,
  };
}

export type PagesWorld = Awaited<ReturnType<typeof pagesWorld>>;
