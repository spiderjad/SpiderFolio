// Versiones y papelera (módulo 3, parte 4): seguridad, aislamiento y cuota. Borrar y restaurar piden
// MANAGE; restaurar una versión pide EDIT; lo borrado no se ve, no se descarga y no recibe subidas;
// eliminar para siempre libera la cuota y encola el borrado de los objetos de S3.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { deleteObjects, expireTrash } from "../../src/jobs/handlers.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import type { TestWorkspace } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  const versions = await ctx.prisma.fileVersion.findMany({
    where: { workspace: { name: { startsWith: "Papelera " } } },
    select: { storageKey: true },
  });
  for (const row of versions) await ctx.deps.storage.delete(row.storageKey);
  await ctx.close();
});

const api = (ws: Pick<TestWorkspace, "slug">, token: string) => {
  const call = (method: "get" | "post" | "put" | "patch" | "delete", path: string, body?: object) =>
    request(app)
      [method](`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  return {
    get: (path: string) => call("get", path),
    post: (path: string, body?: object) => call("post", path, body),
    put: (path: string, body?: object) => call("put", path, body),
    delete: (path: string) => call("delete", path),
  };
};

interface Paged<T> {
  items: T[];
  total: number;
}
interface NodeBody {
  id: string;
  name: string;
  currentVersion: number;
  sizeBytes: number | null;
}
interface TrashBody {
  id: string;
  name: string;
  items: number;
  trashedAt: string;
  purgeAt: string;
}

async function setup(label: string) {
  app = createApp(ctx.deps);
  const ws = await createWorkspace(ctx, `Papelera ${label}`);
  const other = await createWorkspace(ctx, `Papelera ${label} ajeno`);
  const owner = api(ws, ws.token);
  const calidad = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Calidad" },
  });
  const editor = await addMember(ctx, ws, { name: "Edith Editora" });
  const viewer = await addMember(ctx, ws, { name: "Vera Visora" });
  const guest = await addMember(ctx, ws, { base: "GUEST", name: "Gabi Invitada" });
  await ctx.prisma.departmentMember.create({
    data: {
      workspaceId: ws.workspaceId,
      departmentId: calidad.id,
      membershipId: editor.membership.id,
    },
  });
  const space = (
    (await owner.post("/spaces", { name: "Procedimientos" })).body as { space: { id: string } }
  ).space;
  await owner.put(`/spaces/${space.id}/permissions`, { departmentId: calidad.id, level: "EDIT" });
  return { ws, other, owner, editor, viewer, guest, space };
}
type World = Awaited<ReturnType<typeof setup>>;

const text = (content: string) => Buffer.from(content, "utf8");

async function upload(
  w: World,
  token: string,
  name: string,
  content: Buffer,
  extra: { parentId?: string | null; onConflict?: string } = {},
) {
  const a = api(w.ws, token);
  const started = await a.post(`/spaces/${w.space.id}/uploads`, {
    name,
    size: content.length,
    ...extra,
  });
  expect(started.status).toBe(201);
  const ticket = (
    started.body as { upload: { id: string; nodeId: string; url: string; contentType: string } }
  ).upload;
  const put = await fetch(ticket.url, {
    method: "PUT",
    headers: { "Content-Type": ticket.contentType },
    body: content,
  });
  expect(put.ok).toBe(true);
  const done = await a.post(`/uploads/${ticket.id}/complete`);
  expect(done.status).toBe(200);
  return { nodeId: ticket.nodeId, node: (done.body as { node: NodeBody }).node };
}

async function folder(w: World, name: string, parentId?: string) {
  const res = await w.owner.post(`/spaces/${w.space.id}/folders`, { name, parentId });
  expect(res.status).toBe(201);
  return (res.body as { node: NodeBody }).node;
}

async function bytesOf(url: string): Promise<string> {
  return await (await fetch(url)).text();
}

describe("versiones", () => {
  it("lista el historial, descarga una versión vieja y vuelve a una anterior", async () => {
    const w = await setup("versiones");
    const first = await upload(w, w.editor.token, "Manual.txt", text("uno"));
    await upload(w, w.editor.token, "Manual.txt", text("dos dos"), { onConflict: "replace" });
    await upload(w, w.editor.token, "Manual.txt", text("tres tres tres"), {
      onConflict: "replace",
    });
    const a = api(w.ws, w.viewer.token);
    const list = (await a.get(`/files/${first.nodeId}/versions`)).body as Paged<{
      version: number;
      current: boolean;
      uploadedBy: string | null;
      sizeBytes: number;
    }>;
    expect(list.items.map((v) => [v.version, v.current, v.uploadedBy])).toEqual([
      [3, true, "Edith Editora"],
      [2, false, "Edith Editora"],
      [1, false, "Edith Editora"],
    ]);
    // Descargar la versión 1: el contenido viejo; sin versión, la vigente.
    const old = (await a.get(`/files/${first.nodeId}/download?version=1`)).body as { url: string };
    expect(await bytesOf(old.url)).toBe("uno");
    const current = (await a.get(`/files/${first.nodeId}/download`)).body as { url: string };
    expect(await bytesOf(current.url)).toBe("tres tres tres");
    // Quien solo ve no restaura; el invitado ni sabe que existe.
    expect((await a.post(`/files/${first.nodeId}/versions/1/restore`)).status).toBe(403);
    expect(
      (await api(w.ws, w.guest.token).post(`/files/${first.nodeId}/versions/1/restore`)).status,
    ).toBe(404);
    expect((await api(w.ws, w.guest.token).get(`/files/${first.nodeId}/versions`)).status).toBe(
      404,
    );
    // Quien edita sí: la 1 pasa a ser la vigente (tamaño y contenido).
    const editor = api(w.ws, w.editor.token);
    const restored = await editor.post(`/files/${first.nodeId}/versions/1/restore`);
    expect(restored.status).toBe(200);
    expect((restored.body as { node: NodeBody }).node).toMatchObject({
      currentVersion: 1,
      sizeBytes: 3,
    });
    const after = (await a.get(`/files/${first.nodeId}/download`)).body as { url: string };
    expect(await bytesOf(after.url)).toBe("uno");
    expect((await editor.post(`/files/${first.nodeId}/versions/9/restore`)).status).toBe(404);
    // La siguiente subida toma el número más alto + 1 (no choca con la 2 y la 3 que existen).
    const next = await upload(w, w.editor.token, "Manual.txt", text("cuatro"), {
      onConflict: "replace",
    });
    expect(next.node.currentVersion).toBe(4);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "file.restore_version" },
      }),
    ).toBe(1);
  });

  it("otra empresa no ve ni restaura versiones", async () => {
    const w = await setup("versiones ajeno");
    const file = await upload(w, w.editor.token, "a.txt", text("x"));
    const outsider = api(w.other, w.other.token);
    expect((await outsider.get(`/files/${file.nodeId}/versions`)).status).toBe(404);
    expect((await outsider.post(`/files/${file.nodeId}/versions/1/restore`)).status).toBe(404);
    expect((await api(w.ws, w.other.token).get(`/files/${file.nodeId}/versions`)).status).toBe(404);
  });
});

describe("papelera: borrar y ver", () => {
  it("borrar pide MANAGE; lo borrado no se ve ni se descarga ni recibe subidas", async () => {
    const w = await setup("borrar");
    const dir = await folder(w, "Anexos");
    const inner = await upload(w, w.editor.token, "a.txt", text("hola"), { parentId: dir.id });
    const loose = await upload(w, w.editor.token, "suelto.txt", text("suelto"));
    // Edith edita pero no gestiona; Vera solo ve; Gabi no ve: ninguno borra.
    expect((await api(w.ws, w.editor.token).delete(`/nodes/${dir.id}`)).status).toBe(403);
    expect((await api(w.ws, w.viewer.token).delete(`/nodes/${dir.id}`)).status).toBe(403);
    expect((await api(w.ws, w.guest.token).delete(`/nodes/${dir.id}`)).status).toBe(404);
    expect((await w.owner.delete(`/nodes/${dir.id}`)).status).toBe(204);
    // Desaparece de la lista, del detalle y de las descargas, también lo que tenía dentro.
    const list = (await w.owner.get(`/spaces/${w.space.id}/nodes`)).body as Paged<NodeBody>;
    expect(list.items.map((n) => n.name)).toEqual(["suelto.txt"]);
    expect((await w.owner.get(`/nodes/${dir.id}`)).status).toBe(404);
    expect((await w.owner.get(`/nodes/${inner.nodeId}`)).status).toBe(404);
    expect((await w.owner.get(`/files/${inner.nodeId}/download`)).status).toBe(404);
    expect((await w.owner.get(`/spaces/${w.space.id}/nodes?parent=${dir.id}`)).status).toBe(404);
    const dest = await w.owner.post(`/spaces/${w.space.id}/uploads`, {
      name: "b.txt",
      size: 3,
      parentId: dir.id,
    });
    expect(dest.status).toBe(404);
    // Borrar dos veces no existe; lo suelto sigue en su lugar.
    expect((await w.owner.delete(`/nodes/${dir.id}`)).status).toBe(404);
    expect((await w.owner.get(`/files/${loose.nodeId}/download`)).status).toBe(200);
    expect(
      await ctx.prisma.node.count({ where: { trashRootId: dir.id, trashedAt: { not: null } } }),
    ).toBe(2);
  });

  it("el nombre de lo borrado queda libre; un espacio archivado no deja borrar", async () => {
    const w = await setup("nombre libre");
    const file = await upload(w, w.editor.token, "Informe.txt", text("v1"));
    expect((await w.owner.delete(`/nodes/${file.nodeId}`)).status).toBe(204);
    const again = await upload(w, w.editor.token, "Informe.txt", text("v2"));
    expect(again.nodeId).not.toBe(file.nodeId);
    await w.owner.post(`/spaces/${w.space.id}/archive`);
    expect((await w.owner.delete(`/nodes/${again.nodeId}`)).status).toBe(409);
  });

  it("la papelera la ve quien puede restaurar (MANAGE); trae el plazo y cuántos elementos", async () => {
    const w = await setup("ver papelera");
    const dir = await folder(w, "Viejo");
    await upload(w, w.editor.token, "a.txt", text("a"), { parentId: dir.id });
    await upload(w, w.editor.token, "b.txt", text("b"), { parentId: dir.id });
    await w.owner.delete(`/nodes/${dir.id}`);
    const seen = (await w.owner.get(`/spaces/${w.space.id}/trash`)).body as Paged<TrashBody>;
    expect(seen.items).toHaveLength(1);
    expect(seen.items[0]).toMatchObject({ id: dir.id, name: "Viejo", items: 3 });
    const days =
      (new Date(seen.items[0]?.purgeAt ?? 0).getTime() -
        new Date(seen.items[0]?.trashedAt ?? 0).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(30);
    // Edith (EDIT) y Vera (VIEW) no ven la papelera; Gabi no ve el espacio.
    for (const who of [w.editor, w.viewer]) {
      const res = (await api(w.ws, who.token).get(`/spaces/${w.space.id}/trash`))
        .body as Paged<TrashBody>;
      expect(res.items, who.user.name).toEqual([]);
    }
    expect((await api(w.ws, w.guest.token).get(`/spaces/${w.space.id}/trash`)).status).toBe(404);
    expect((await api(w.other, w.other.token).get(`/spaces/${w.space.id}/trash`)).status).toBe(404);
  });
});

describe("papelera: restaurar", () => {
  it("vuelve con todo su subárbol; solo MANAGE restaura", async () => {
    const w = await setup("restaurar");
    const dir = await folder(w, "Anexos");
    const inner = await upload(w, w.editor.token, "a.txt", text("hola"), { parentId: dir.id });
    await w.owner.delete(`/nodes/${dir.id}`);
    expect((await api(w.ws, w.editor.token).post(`/nodes/${dir.id}/restore`)).status).toBe(403);
    expect((await api(w.ws, w.guest.token).post(`/nodes/${dir.id}/restore`)).status).toBe(404);
    expect((await api(w.other, w.other.token).post(`/nodes/${dir.id}/restore`)).status).toBe(404);
    // Lo que no es raíz de la papelera no se restaura por separado.
    expect((await w.owner.post(`/nodes/${inner.nodeId}/restore`)).status).toBe(404);
    expect((await w.owner.post(`/nodes/${dir.id}/restore`)).status).toBe(200);
    expect(
      (
        (await w.owner.get(`/spaces/${w.space.id}/nodes?parent=${dir.id}`)).body as Paged<NodeBody>
      ).items.map((n) => n.name),
    ).toEqual(["a.txt"]);
    expect((await w.owner.get(`/files/${inner.nodeId}/download`)).status).toBe(200);
    expect(
      ((await w.owner.get(`/spaces/${w.space.id}/trash`)).body as Paged<TrashBody>).items,
    ).toEqual([]);
  });

  it("si su carpeta ya no está, vuelve a la raíz; si el nombre se ocupó, se numera", async () => {
    const w = await setup("restaurar destino");
    const parent = await folder(w, "Padre");
    const child = await upload(w, w.editor.token, "Informe.txt", text("v1"), {
      parentId: parent.id,
    });
    await w.owner.delete(`/nodes/${child.nodeId}`);
    await upload(w, w.editor.token, "Informe.txt", text("v2"), { parentId: parent.id });
    // El nombre está ocupado en el mismo lugar: se numera.
    const same = await w.owner.post(`/nodes/${child.nodeId}/restore`);
    expect((same.body as { node: { name: string; parentId: string } }).node).toMatchObject({
      name: "Informe (2).txt",
      parentId: parent.id,
    });
    // Se borra la carpeta con todo: restaurar lo suelto que quedó en la papelera lo lleva a la raíz.
    const other = await upload(w, w.editor.token, "Otro.txt", text("o"), { parentId: parent.id });
    await w.owner.delete(`/nodes/${other.nodeId}`);
    await w.owner.delete(`/nodes/${parent.id}`);
    const moved = await w.owner.post(`/nodes/${other.nodeId}/restore`);
    expect((moved.body as { node: { parentId: string | null } }).node.parentId).toBeNull();
  });
});

describe("papelera: eliminar para siempre", () => {
  it("borra las filas, libera la cuota y encola el borrado de los objetos", async () => {
    const w = await setup("purgar");
    const dir = await folder(w, "Adiós");
    const file = await upload(w, w.editor.token, "a.txt", text("12345"), { parentId: dir.id });
    await upload(w, w.editor.token, "a.txt", text("1234567"), {
      parentId: dir.id,
      onConflict: "replace",
    });
    const versions = await ctx.prisma.fileVersion.findMany({
      where: { nodeId: file.nodeId },
      select: { storageKey: true },
    });
    expect(versions).toHaveLength(2);
    const used = () =>
      ctx.prisma.workspace
        .findUniqueOrThrow({ where: { id: w.ws.workspaceId } })
        .then((workspace) => workspace.storageUsedBytes);
    expect(await used()).toBe(12n);
    // Solo desde la papelera y con MANAGE.
    expect((await w.owner.delete(`/nodes/${dir.id}/purge`)).status).toBe(404);
    await w.owner.delete(`/nodes/${dir.id}`);
    expect((await api(w.ws, w.editor.token).delete(`/nodes/${dir.id}/purge`)).status).toBe(403);
    expect((await api(w.ws, w.guest.token).delete(`/nodes/${dir.id}/purge`)).status).toBe(404);
    expect((await api(w.other, w.other.token).delete(`/nodes/${dir.id}/purge`)).status).toBe(404);
    expect((await w.owner.delete(`/nodes/${dir.id}/purge`)).status).toBe(204);
    expect(
      await ctx.prisma.node.count({
        where: { workspaceId: w.ws.workspaceId, type: { not: "FOLDER" } },
      }),
    ).toBe(0);
    expect(await ctx.prisma.fileVersion.count({ where: { workspaceId: w.ws.workspaceId } })).toBe(
      0,
    );
    expect(await used()).toBe(0n);
    // Los objetos se borran por un job con las claves; acá se corre su manejador.
    const queued = await ctx.prisma.$queryRawUnsafe<{ keys: string[] }[]>(
      `select data->'keys' as keys from pgboss.job where name = 'objects-delete' and data->'keys' ? $1`,
      versions[0]?.storageKey ?? "",
    );
    expect(queued.length).toBeGreaterThan(0);
    const keys = versions.map((v) => v.storageKey);
    for (const key of keys) expect(await ctx.deps.storage.head(key)).not.toBeNull();
    await deleteObjects({ storage: ctx.deps.storage, logger: ctx.deps.logger }, { keys });
    for (const key of keys) expect(await ctx.deps.storage.head(key)).toBeNull();
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "node.purge" },
      }),
    ).toBe(1);
  });

  it("a los 30 días el job diario lo elimina; antes, no", async () => {
    const w = await setup("vencida");
    const fresh = await upload(w, w.editor.token, "nueva.txt", text("n"));
    const old = await upload(w, w.editor.token, "vieja.txt", text("vv"));
    await w.owner.delete(`/nodes/${fresh.nodeId}`);
    await w.owner.delete(`/nodes/${old.nodeId}`);
    const oldKey = (
      await ctx.prisma.fileVersion.findFirstOrThrow({ where: { nodeId: old.nodeId } })
    ).storageKey;
    await ctx.prisma.node.update({
      where: { id: old.nodeId },
      data: { trashedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    const result = await expireTrash(
      { prisma: ctx.prisma, logger: ctx.deps.logger, jobs: ctx.deps.jobs },
      {},
    );
    expect(result.failed).toBe(0);
    expect(await ctx.prisma.node.count({ where: { id: old.nodeId } })).toBe(0);
    expect(await ctx.prisma.node.count({ where: { id: fresh.nodeId } })).toBe(1);
    const used = (await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } }))
      .storageUsedBytes;
    expect(used).toBe(1n);
    await ctx.deps.storage.delete(oldKey);
  });
});
