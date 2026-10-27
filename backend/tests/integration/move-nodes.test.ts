// Mover carpetas y archivos: la carpeta se lleva todo su contenido, no se mueve dentro de sí misma,
// pide edición en origen y destino (también entre espacios), resuelve nombres repetidos sin pisar
// nada sin permiso y los tamaños de carpeta solo cuentan lo que la persona puede ver.
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

const call = (slug: string, token: string, method: "get" | "post", path: string, body?: object) =>
  request(app)
    [method](`/api/v1/w/${slug}${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

interface NodeBody {
  id: string;
  name: string;
  type: string;
  totalBytes?: number | null;
  folderCount?: number | null;
}

async function world() {
  const ws = await createWorkspace(ctx, "Mover");
  const owner = await ctx.prisma.membership.findFirstOrThrow({
    where: { workspaceId: ws.workspaceId, role: { base: "OWNER" } },
  });
  // Edith edita el espacio A, solo mira el B; Vera no tiene acceso a nada (espacios privados).
  const edith = await addMember(ctx, ws, { name: "Edith Editora" });
  const vera = await addMember(ctx, ws, { name: "Vera Visora" });
  const space = async (name: string) => {
    const res = await call(ws.slug, ws.token, "post", "/spaces", { name, isPrivate: true });
    expect(res.status).toBe(201);
    return (res.body as { space: { id: string } }).space.id;
  };
  const a = await space("Espacio A");
  const b = await space("Espacio B");
  const grant = (spaceId: string, membershipId: string, level: "VIEW" | "EDIT") =>
    ctx.prisma.permission.create({
      data: { workspaceId: ws.workspaceId, spaceId, membershipId, level, grantedById: owner.id },
    });
  await grant(a, edith.membership.id, "EDIT");
  await grant(b, edith.membership.id, "VIEW");
  const folder = async (spaceId: string, name: string, parentId: string | null = null) => {
    const res = await call(ws.slug, ws.token, "post", `/spaces/${spaceId}/folders`, {
      parentId,
      name,
    });
    expect(res.status).toBe(201);
    return (res.body as { node: NodeBody }).node;
  };
  const file = async (spaceId: string, name: string, parentId: string | null, size: number) => {
    const node = await ctx.prisma.node.create({
      data: {
        workspaceId: ws.workspaceId,
        spaceId,
        parentId,
        type: "FILE",
        name,
        nameKey: name.toLowerCase(),
        position: `a${name}`,
        createdById: owner.id,
        updatedById: owner.id,
        currentVersion: 1,
        mimeType: "text/plain",
        sizeBytes: BigInt(size),
      },
    });
    return node;
  };
  const move = (token: string, id: string, body: object) =>
    call(ws.slug, token, "post", `/nodes/${id}/move`, body);
  return { ws, owner, edith, vera, a, b, folder, file, move, grant };
}
type World = Awaited<ReturnType<typeof world>>;

const parentOf = async (id: string) =>
  (await ctx.prisma.node.findUniqueOrThrow({ where: { id } })).parentId;

describe("mover carpetas", () => {
  it("una carpeta se lleva todo su contenido", async () => {
    const w = await world();
    const proyectos = await w.folder(w.a, "Proyectos");
    const finanzas = await w.folder(w.a, "Finanzas");
    const sub = await w.folder(w.a, "Sub", proyectos.id);
    const inner = await w.file(w.a, "informe.txt", sub.id, 10);
    const res = await w.move(w.ws.token, proyectos.id, { parentId: finanzas.id });
    expect(res.status).toBe(200);
    expect(await parentOf(proyectos.id)).toBe(finanzas.id);
    // Lo de adentro sigue colgando de la carpeta movida.
    expect(await parentOf(sub.id)).toBe(proyectos.id);
    expect(await parentOf(inner.id)).toBe(sub.id);
  });

  it("no se mueve dentro de sí misma ni de sus subcarpetas", async () => {
    const w = await world();
    const top = await w.folder(w.a, "Top");
    const child = await w.folder(w.a, "Hija", top.id);
    const grandchild = await w.folder(w.a, "Nieta", child.id);
    for (const target of [top.id, child.id, grandchild.id]) {
      const res = await w.move(w.ws.token, top.id, { parentId: target });
      expect(res.status, target).toBe(400);
    }
    expect(await parentOf(top.id)).toBeNull();
  });

  it("pide edición en el origen y en el destino", async () => {
    const w = await world();
    const origin = await w.folder(w.a, "Origen");
    const dest = await w.folder(w.a, "Destino");
    const docA = await w.file(w.a, "a.txt", origin.id, 1);
    const inB = await w.folder(w.b, "En B");
    const mine = await w.file(w.a, "mio.txt", null, 1);
    // Sin acceso al espacio: ni se entera de que existe.
    expect((await w.move(w.vera.token, docA.id, { parentId: dest.id })).status).toBe(404);
    // Con edición en A: mueve dentro de A…
    expect((await w.move(w.edith.token, docA.id, { parentId: dest.id })).status).toBe(200);
    // …pero B es solo lectura: no puede dejar nada allá (ni sacar de B).
    expect((await w.move(w.edith.token, mine.id, { parentId: inB.id, spaceId: w.b })).status).toBe(
      403,
    );
    const fromB = await w.file(w.b, "de-b.txt", null, 1);
    expect(
      (await w.move(w.edith.token, fromB.id, { parentId: dest.id, spaceId: w.a })).status,
    ).toBe(403);
    expect(await parentOf(mine.id)).toBeNull();
  });

  it("entre espacios: el subárbol completo cambia de espacio", async () => {
    const w = await world();
    const top = await w.folder(w.a, "Viaja");
    const child = await w.folder(w.a, "Hija", top.id);
    const doc = await w.file(w.a, "doc.txt", child.id, 5);
    const res = await w.move(w.ws.token, top.id, { parentId: null, spaceId: w.b });
    expect(res.status).toBe(200);
    for (const id of [top.id, child.id, doc.id]) {
      expect((await ctx.prisma.node.findUniqueOrThrow({ where: { id } })).spaceId, id).toBe(w.b);
    }
  });
});

describe("mover con nombres repetidos", () => {
  async function clash(w: World) {
    const dest = await w.folder(w.a, "Destino");
    const existing = await w.file(w.a, "mismo.txt", dest.id, 1);
    const incoming = await w.file(w.a, "mismo.txt", null, 2);
    return { dest, existing, incoming };
  }

  it("sin elegir, avisa del conflicto y no toca nada", async () => {
    const w = await world();
    const { dest, existing, incoming } = await clash(w);
    const res = await w.move(w.ws.token, incoming.id, { parentId: dest.id });
    expect(res.status).toBe(409);
    expect(await parentOf(incoming.id)).toBeNull();
    expect(
      (await ctx.prisma.node.findUniqueOrThrow({ where: { id: existing.id } })).trashedAt,
    ).toBeNull();
  });

  it("Conservar ambos numera el nombre", async () => {
    const w = await world();
    const { dest, incoming } = await clash(w);
    const res = await w.move(w.ws.token, incoming.id, {
      parentId: dest.id,
      onConflict: "KEEP_BOTH",
    });
    expect(res.status).toBe(200);
    expect((await ctx.prisma.node.findUniqueOrThrow({ where: { id: incoming.id } })).name).toBe(
      "mismo (2).txt",
    );
  });

  it("Reemplazar manda lo anterior a la papelera, solo con permiso de gestión sobre ello", async () => {
    const w = await world();
    const { dest, existing, incoming } = await clash(w);
    // Edith edita pero no gestiona: no puede pisar lo que hay.
    const denied = await w.move(w.edith.token, incoming.id, {
      parentId: dest.id,
      onConflict: "REPLACE",
    });
    expect(denied.status).toBe(403);
    expect(
      (await ctx.prisma.node.findUniqueOrThrow({ where: { id: existing.id } })).trashedAt,
    ).toBeNull();
    const ok = await w.move(w.ws.token, incoming.id, { parentId: dest.id, onConflict: "REPLACE" });
    expect(ok.status).toBe(200);
    expect(
      (await ctx.prisma.node.findUniqueOrThrow({ where: { id: existing.id } })).trashedAt,
    ).not.toBeNull();
    expect(await parentOf(incoming.id)).toBe(dest.id);
  });
});

describe("listado de carpetas", () => {
  it("el tamaño suma todo lo de adentro, y solo lo que la persona ve; la flecha, solo con subcarpetas", async () => {
    const w = await world();
    const top = await w.folder(w.a, "Top");
    const empty = await w.folder(w.a, "Vacia");
    const sub = await w.folder(w.a, "Sub", top.id);
    await w.file(w.a, "uno.txt", top.id, 100);
    await w.file(w.a, "dos.txt", sub.id, 50);
    const hidden = await w.file(w.a, "secreto.txt", sub.id, 1000);
    // Un archivo que solo ve quien tiene permiso propio sobre él.
    await ctx.prisma.node.update({ where: { id: hidden.id }, data: { inheritAccess: false } });

    const sizes = async (token: string) => {
      const res = await call(
        w.ws.slug,
        token,
        "get",
        `/spaces/${w.a}/nodes?parent=root&pageSize=50`,
      );
      expect(res.status).toBe(200);
      return new Map((res.body as { items: NodeBody[] }).items.map((n) => [n.name, n]));
    };
    const asOwner = await sizes(w.ws.token);
    expect(asOwner.get("Top")?.totalBytes).toBe(1150);
    expect(asOwner.get("Top")?.folderCount).toBe(1);
    expect(asOwner.get("Vacia")?.folderCount).toBe(0);
    expect(asOwner.get("Vacia")?.totalBytes).toBe(0);
    expect(empty.id).toBeTruthy();
    // Edith no ve el archivo restringido: no entra en el total.
    expect((await sizes(w.edith.token)).get("Top")?.totalBytes).toBe(150);
  });
});
