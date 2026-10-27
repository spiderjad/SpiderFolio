// Registro de auditoría: quién lo ve, filtros, paginación por cursor, aislamiento entre empresas,
// exportación (capacidad) y el recorte semanal según la retención que fija la empresa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneAudit } from "../../src/modules/audit/audit-log.service.ts";
import {
  addMember,
  createTestContext,
  createUser,
  setLimits,
  type TestContext,
} from "./helpers.ts";
import { pagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Event {
  id: string;
  action: string;
  actor: { name: string | null; staff: boolean } | null;
}
interface ListBody {
  items: Event[];
  total: number;
  nextCursor: string | null;
}

const DAY_MS = 24 * 3600 * 1000;

async function seed(workspaceId: string, count: number, actorId: string | null, daysAgo = 0) {
  await ctx.prisma.auditLog.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      workspaceId,
      actorId,
      action: index % 2 === 0 ? "document.published" : "node.move",
      entityType: "Node",
      entityId: `n${String(index)}`,
      createdAt: new Date(Date.now() - daysAgo * DAY_MS - index * 1000),
    })),
  });
}

describe("lista", () => {
  it("la ve quien tiene audit.view; las demás personas no; otra empresa, nada", async () => {
    const w = await pagesWorld(ctx, "Auditoría ver");
    await seed(w.ws.workspaceId, 3, w.ws.owner.id);
    const ok = await w.call("get", w.ws.token, "/admin/audit");
    expect(ok.status).toBe(200);
    expect((ok.body as ListBody).items.length).toBeGreaterThanOrEqual(3);
    expect((await w.call("get", w.viewer.token, "/admin/audit")).status).toBe(403);
    // La otra empresa no ve estos eventos ni por el mismo camino.
    const other = await w.call("get", w.outsider.token, "/admin/audit", undefined, w.outsider.slug);
    expect(other.status).toBe(200);
    expect(
      (other.body as ListBody).items.every(
        (event) => event.actor?.name !== "Dueño de Auditoría ver",
      ),
    ).toBe(true);
    expect((await w.call("get", w.outsider.token, "/admin/audit")).status).toBe(404);
  });

  it("filtra por acción, área y fechas, y pagina por cursor sin repetir", async () => {
    const w = await pagesWorld(ctx, "Auditoría filtros");
    await ctx.prisma.auditLog.deleteMany({ where: { workspaceId: w.ws.workspaceId } });
    await seed(w.ws.workspaceId, 7, w.ws.owner.id);
    await seed(w.ws.workspaceId, 2, w.ws.owner.id, 40);
    const all = (await w.call("get", w.ws.token, "/admin/audit?limit=100")).body as ListBody;
    expect(all.total).toBe(9);
    const exact = (await w.call("get", w.ws.token, "/admin/audit?action=node.move"))
      .body as ListBody;
    expect(exact.items.every((event) => event.action === "node.move")).toBe(true);
    const area = (await w.call("get", w.ws.token, "/admin/audit?action=document."))
      .body as ListBody;
    expect(area.items.every((event) => event.action.startsWith("document."))).toBe(true);
    const from = new Date(Date.now() - 10 * DAY_MS).toISOString().slice(0, 10);
    const recent = (await w.call("get", w.ws.token, `/admin/audit?from=${from}&limit=100`))
      .body as ListBody;
    expect(recent.total).toBe(7);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const url: string =
        "/admin/audit?limit=4" + (cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`);
      const page = (await w.call("get", w.ws.token, url)).body as ListBody;
      seen.push(...page.items.map((event) => event.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen.length).toBe(9);
    expect(new Set(seen).size).toBe(9);
  });

  it("un cursor inválido es 400", async () => {
    const w = await pagesWorld(ctx, "Auditoría cursor");
    expect((await w.call("get", w.ws.token, "/admin/audit?cursor=basura")).status).toBe(400);
  });

  it("filtra por persona y muestra al equipo de SpiderFolio sin su nombre", async () => {
    const w = await pagesWorld(ctx, "Auditoría personas");
    await ctx.prisma.auditLog.deleteMany({ where: { workspaceId: w.ws.workspaceId } });
    const other = await addMember(ctx, w.ws, { name: "Otra persona" });
    const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, userId: w.ws.owner.id },
    });
    await seed(w.ws.workspaceId, 2, w.ws.owner.id);
    await seed(w.ws.workspaceId, 3, other.user.id);
    const staff = await createUser(ctx.prisma, "Nombre real");
    await ctx.prisma.user.update({ where: { id: staff.id }, data: { isStaff: true } });
    await seed(w.ws.workspaceId, 1, staff.id);
    const mine = (await w.call("get", w.ws.token, `/admin/audit?memberId=${ownerMembership.id}`))
      .body as ListBody;
    expect(mine.total).toBe(2);
    const everything = (await w.call("get", w.ws.token, "/admin/audit?limit=100")).body as ListBody;
    const fromStaff = everything.items.filter((event) => event.actor?.staff === true);
    expect(fromStaff).toHaveLength(1);
    expect(fromStaff[0]?.actor?.name).toBeNull();
  });
});

describe("exportación", () => {
  it("pide audit.export y deja constancia", async () => {
    const w = await pagesWorld(ctx, "Auditoría export");
    await seed(w.ws.workspaceId, 3, w.ws.owner.id);
    expect((await w.call("get", w.viewer.token, "/admin/audit/export")).status).toBe(403);
    const csv = await w.call("get", w.ws.token, "/admin/audit/export?action=node.move");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "audit.export" },
      }),
    ).toBe(1);
  });
});

describe("recorte semanal", () => {
  it("borra lo más viejo que la retención que fija cada empresa y nada más", async () => {
    const w = await pagesWorld(ctx, "Auditoría recorte");
    const free = await pagesWorld(ctx, "Auditoría sin límite");
    await ctx.prisma.auditLog.deleteMany({
      where: { workspaceId: { in: [w.ws.workspaceId, free.ws.workspaceId] } },
    });
    await setLimits(ctx, w.ws.workspaceId, { auditRetentionDays: 30 });
    // La otra empresa no fijó retención: no se borra nada.
    await seed(w.ws.workspaceId, 4, null, 0);
    await seed(w.ws.workspaceId, 3, null, 45);
    await seed(free.ws.workspaceId, 3, null, 400);
    const result = await pruneAudit({ prisma: ctx.prisma });
    expect(result.deleted).toBeGreaterThanOrEqual(3);
    expect(await ctx.prisma.auditLog.count({ where: { workspaceId: w.ws.workspaceId } })).toBe(4);
    expect(await ctx.prisma.auditLog.count({ where: { workspaceId: free.ws.workspaceId } })).toBe(
      3,
    );
  });
});
