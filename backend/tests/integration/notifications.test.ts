// Campana de avisos (módulo 5): se crean al compartir, nadie lee las de otra persona ni de otra
// empresa, y el job diario avisa los vencimientos una sola vez. Además, la vista «por espacio» de
// Accesos y el nivel del jefe en la matriz.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localHour } from "../../src/lib/time-zone.ts";
import { notifyExpiringAccess } from "../../src/modules/notifications/expiry-notices.ts";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Notifications {
  items: {
    id: string;
    kind: string;
    readAt: string | null;
    actor: { name: string } | null;
    target: { name: string } | null;
    permissionId: string | null;
    subject: { type: string; name: string } | null;
  }[];
  unread: number;
}

const listOf = async (w: PagesWorld, token: string, slug = w.ws.slug) => {
  const res = await w.call("get", token, "/notifications", undefined, slug);
  expect(res.status).toBe(200);
  return res.body as Notifications;
};

async function folder(w: PagesWorld, name: string) {
  const res = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, { name });
  expect(res.status).toBe(201);
  return (res.body as { node: { id: string } }).node.id;
}

const give = (w: PagesWorld, nodeId: string, body: object) =>
  w.call("put", w.ws.token, `/nodes/${nodeId}/permissions`, body);

describe("campana de avisos", () => {
  it("compartir avisa a la persona; nadie lee ni marca las de otra", async () => {
    const w = await pagesWorld(ctx, "Avisos persona");
    const shared = await folder(w, "Para Sofía");
    await give(w, shared, { membershipId: w.stranger.membership.id, level: "VIEW" });

    const sofia = await listOf(w, w.stranger.token);
    expect(sofia.unread).toBe(1);
    expect(sofia.items).toHaveLength(1);
    expect(sofia.items[0]).toMatchObject({
      kind: "shared",
      readAt: null,
      target: { name: "Para Sofía" },
    });
    expect(sofia.items[0]?.actor).not.toBeNull();
    // Quien compartió y el resto no reciben nada.
    expect((await listOf(w, w.ws.token)).items).toEqual([]);
    expect((await listOf(w, w.editor.token)).items).toEqual([]);
    const id = sofia.items[0]?.id ?? "";
    expect((await w.call("post", w.editor.token, `/notifications/${id}/read`)).status).toBe(404);
    expect(await ctx.prisma.notification.count({ where: { id, readAt: null } })).toBe(1);
    // Otra empresa: ni la ve ni la marca.
    expect(
      (await w.call("get", w.outsider.token, "/notifications", undefined, w.ws.slug)).status,
    ).toBe(404);
    expect((await listOf(w, w.outsider.token, w.outsider.slug)).items).toEqual([]);

    expect((await w.call("post", w.stranger.token, `/notifications/${id}/read`)).status).toBe(204);
    expect((await listOf(w, w.stranger.token)).unread).toBe(0);
    // Marcar todas.
    const other = await folder(w, "Otra");
    await give(w, other, { membershipId: w.stranger.membership.id, level: "VIEW" });
    expect((await listOf(w, w.stranger.token)).unread).toBe(1);
    expect((await w.call("post", w.stranger.token, "/notifications/read-all")).status).toBe(204);
    expect((await listOf(w, w.stranger.token)).unread).toBe(0);
  });

  it("al compartir con un departamento avisa a sus miembros (a las subáreas, solo si se incluyen)", async () => {
    const w = await pagesWorld(ctx, "Avisos departamento");
    const parent = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Producción" },
    });
    const child = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Envasado", parentId: parent.id },
    });
    const boss = await addMember(ctx, w.ws, { name: "Paula Producción" });
    const worker = await addMember(ctx, w.ws, { name: "Nora Envasadora" });
    for (const [who, department] of [
      [boss, parent],
      [worker, child],
    ] as const) {
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId: department.id,
          membershipId: who.membership.id,
        },
      });
    }
    const shared = await folder(w, "Para Producción");
    await give(w, shared, { departmentId: parent.id, level: "VIEW" });
    expect((await listOf(w, boss.token)).items).toHaveLength(1);
    expect((await listOf(w, worker.token)).items).toHaveLength(0);
    const second = await folder(w, "Con subáreas");
    await give(w, second, { departmentId: parent.id, level: "VIEW", includeSubareas: true });
    expect((await listOf(w, worker.token)).items).toHaveLength(1);
    expect((await listOf(w, w.stranger.token)).items).toHaveLength(0);
  });

  it("si perdió el acceso, el aviso queda sin nombre", async () => {
    const w = await pagesWorld(ctx, "Avisos sin acceso");
    const shared = await folder(w, "Secreta");
    await give(w, shared, { membershipId: w.stranger.membership.id, level: "VIEW" });
    await ctx.prisma.permission.deleteMany({ where: { nodeId: shared } });
    const list = await listOf(w, w.stranger.token);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.target).toBeNull();
  });

  /** The next whole hour that is 8:00 in Madrid (the test companies' zone). */
  const eightInMadrid = () => {
    let at = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    while (localHour(new Date(at), "Europe/Madrid") !== 8) at += 3_600_000;
    return at;
  };

  it("el job avisa los vencimientos a 2 días una sola vez, a las 8 de la empresa, a quien recibió y a quien compartió", async () => {
    const w = await pagesWorld(ctx, "Avisos vencimiento");
    const eight = eightInMadrid();
    const shared = await folder(w, "Temporal");
    const near = await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: shared,
        membershipId: w.stranger.membership.id,
        level: "VIEW",
        grantedById: w.ownerMembership.id,
        expiresAt: new Date(eight + 30 * 3600 * 1000),
      },
    });
    const far = await folder(w, "Lejana");
    await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: far,
        membershipId: w.stranger.membership.id,
        level: "VIEW",
        grantedById: w.ownerMembership.id,
        expiresAt: new Date(eight + 10 * 24 * 3600 * 1000),
      },
    });
    const deps = { prisma: ctx.prisma, logger: ctx.deps.logger };
    // At 9:00 in Madrid nothing goes out; at 8:00 it does, once even if the job runs again.
    await notifyExpiringAccess(deps, new Date(eight + 3_600_000));
    expect(
      await ctx.prisma.notification.count({
        where: { workspaceId: w.ws.workspaceId, permissionId: near.id },
      }),
    ).toBe(0);
    await notifyExpiringAccess(deps, new Date(eight));
    await notifyExpiringAccess(deps, new Date(eight));
    const rows = await ctx.prisma.notification.findMany({
      where: { workspaceId: w.ws.workspaceId, permissionId: near.id },
    });
    expect(rows.map((row) => row.membershipId).sort()).toEqual(
      [w.stranger.membership.id, w.ownerMembership.id].sort(),
    );
    expect(rows.every((row) => row.expiresAt !== null)).toBe(true);
    // Quien recibió y quien compartió reciben avisos distintos.
    const kindOf = (id: string) => rows.find((row) => row.membershipId === id)?.kind;
    expect(kindOf(w.stranger.membership.id)).toBe("expiring");
    expect(kindOf(w.ownerMembership.id)).toBe("expiring_granted");
    const sofia = await listOf(w, w.stranger.token);
    expect(sofia.items.map((i) => [i.kind, i.target?.name])).toEqual([["expiring", "Temporal"]]);
    const owner = await listOf(w, w.ws.token);
    const granted = owner.items.find((i) => i.kind === "expiring_granted");
    expect(granted).toMatchObject({
      permissionId: near.id,
      subject: { type: "person", name: "Sofía Sinacceso" },
    });
  });
});

describe("Accesos por persona y por espacio", () => {
  it("lista quién entra a cada espacio por nivel, y los elementos de una persona", async () => {
    const w = await pagesWorld(ctx, "Accesos personas");
    const shared = await folder(w, "Para Sofía");
    await give(w, shared, { membershipId: w.stranger.membership.id, level: "COMMENT" });
    interface Overview {
      items: {
        name: string;
        groups: {
          level: string;
          entries: { type: string; person?: { name: string } }[];
        }[];
        sharedInside: { items: { node: { name: string } }[] };
      }[];
    }
    const res = await w.call("get", w.ws.token, "/admin/access/spaces?pageSize=50");
    expect(res.status).toBe(200);
    const space = (res.body as Overview).items.find((item) => item.name === "Calidad");
    const named = (level: string) =>
      space?.groups
        .find((group) => group.level === level)
        ?.entries.flatMap((entry) => (entry.person === undefined ? [] : [entry.person.name]));
    expect(named("EDIT")).toContain("Edith Editora");
    expect(named("COMMENT")).toContain("Carla Comenta");
    expect(named("VIEW")).toContain("Vera Visora");
    expect(named("MANAGE")?.length).toBeGreaterThan(0); // quien creó el espacio
    expect(JSON.stringify(space?.groups)).not.toContain("Sofía");
    expect(space?.sharedInside.items.map((i) => i.node.name)).toEqual(["Para Sofía"]);

    const items = await w.call(
      "get",
      w.ws.token,
      `/admin/access/people/${w.stranger.membership.id}/items`,
    );
    expect(items.status).toBe(200);
    expect(items.body).toMatchObject({
      items: [{ node: { name: "Para Sofía" }, level: "COMMENT" }],
    });
    // Solo con la capacidad de auditar accesos.
    expect((await w.call("get", w.editor.token, "/admin/access/spaces")).status).toBe(403);
    expect(
      (await w.call("get", w.editor.token, `/admin/access/people/${w.viewer.membership.id}/items`))
        .status,
    ).toBe(403);
  });

  it("la matriz muestra el nivel del jefe además del de los miembros", async () => {
    const w = await pagesWorld(ctx, "Matriz jefe");
    const dept = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Compras" },
    });
    const created = await w.call("post", w.ws.token, "/spaces", {
      name: "De Compras",
      departmentId: dept.id,
    });
    expect(created.status).toBe(201);
    const spaceId = (created.body as { space: { id: string } }).space.id;
    const matrix = (await w.call("get", w.ws.token, "/admin/access/matrix?pageSize=100")).body as {
      cells: {
        departmentId: string;
        spaceId: string;
        level: string | null;
        leaderLevel: string | null;
      }[];
    };
    const cell = matrix.cells.find((c) => c.departmentId === dept.id && c.spaceId === spaceId);
    expect(cell).toMatchObject({ level: "EDIT", leaderLevel: "MANAGE" });
  });
});
