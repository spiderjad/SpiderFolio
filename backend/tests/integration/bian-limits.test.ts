// Límites y reparto de consultas de Bian: precedencia persona > departamento > general siempre dentro
// del total de la empresa, avisos al 80 % y 95 %, pedir más consultas, aislamiento entre empresas y una
// tabla de uso que solo trae cantidades. No hay llamadas a Anthropic: se prueba la reserva.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTenantContext } from "../../src/middleware/tenant.ts";
import type { AdminContext } from "../../src/modules/admin/admin-context.ts";
import {
  getAiUsage,
  reserveAiQuery,
  requestMoreQueries,
  usagePeriod,
} from "../../src/modules/bian/usage.service.ts";
import { addMember, createTestContext, setLimits, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const deps = () => ({ prisma: ctx.prisma });

async function contextOf(w: PagesWorld, userId: string): Promise<AdminContext> {
  const loaded = await loadTenantContext(ctx.prisma, { id: w.ws.workspaceId }, userId);
  if (loaded === null) throw new Error("sin contexto");
  return {
    db: loaded.db,
    tenant: loaded.tenant,
    actor: { base: loaded.tenant.role.base, capabilities: loaded.tenant.capabilities },
    info: { actorId: userId, ip: null, userAgent: null },
  };
}

const put = (w: PagesWorld, body: object, token = w.ws.token) =>
  w.call("put", token, "/admin/bian/limits", body);

/** Lo que pasa al pedir una consulta: «ok» o cuál tope se agotó. */
async function ask(c: AdminContext): Promise<"ok" | "person" | "workspace"> {
  try {
    await reserveAiQuery(c, deps());
    return "ok";
  } catch (error) {
    const details = (error as { details?: { scope?: string } }).details;
    if (details?.scope === "person") return "person";
    if (details?.scope === "workspace") return "workspace";
    throw error;
  }
}

/** Total mensual de la empresa en los escenarios (por defecto no hay ninguno). */
const COMPANY_TOTAL = 100;

/** Fija el total de la empresa y deja su contador a `left` consultas. */
async function leaveCompanyWith(w: PagesWorld, left: number) {
  await setLimits(ctx, w.ws.workspaceId, { aiQueriesPerMonth: COMPANY_TOTAL });
  const c = await contextOf(w, w.ownerMembership.userId);
  const usage = await getAiUsage(c, deps());
  if (usage.limit === null) throw new Error("falta el total de la empresa");
  await ctx.prisma.usageCounter.upsert({
    where: {
      workspaceId_periodStart: { workspaceId: w.ws.workspaceId, periodStart: usage.periodStart },
    },
    create: {
      workspaceId: w.ws.workspaceId,
      periodStart: usage.periodStart,
      aiQueries: usage.limit - left,
    },
    update: { aiQueries: usage.limit - left },
  });
  return usage;
}

describe("precedencia de límites dentro del total", () => {
  it("persona > departamento > general; «sin acceso» corta; el total de la empresa manda sobre todos", async () => {
    const w = await pagesWorld(ctx, "Bian límites");
    const ventas = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Ventas" },
    });
    const ana = await addMember(ctx, w.ws, { name: "Ana de Ventas" });
    const beto = await addMember(ctx, w.ws, { name: "Beto sin área" });
    const carla = await addMember(ctx, w.ws, { name: "Carla con excepción" });
    const dani = await addMember(ctx, w.ws, { name: "Dani sin acceso" });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: ventas.id,
        membershipId: ana.membership.id,
      },
    });
    await ctx.prisma.departmentMember.create({
      data: {
        workspaceId: w.ws.workspaceId,
        departmentId: ventas.id,
        membershipId: carla.membership.id,
      },
    });

    // General: 2 por persona. Ventas: 4 por persona. Carla: sin límite. Dani: sin acceso.
    expect((await put(w, { scope: "GENERAL", mode: "LIMIT", limit: 2 })).status).toBe(200);
    expect(
      (await put(w, { scope: "DEPARTMENT", subjectId: ventas.id, mode: "LIMIT", limit: 4 })).status,
    ).toBe(200);
    expect(
      (await put(w, { scope: "PERSON", subjectId: carla.membership.id, mode: "UNLIMITED" })).status,
    ).toBe(200);
    expect(
      (await put(w, { scope: "PERSON", subjectId: dani.membership.id, mode: "BLOCKED" })).status,
    ).toBe(200);

    const as = (m: { user: { id: string } }) => contextOf(w, m.user.id);
    // Beto (sin departamento): vale el general, 2.
    const b = await as(beto);
    expect([await ask(b), await ask(b), await ask(b)]).toEqual(["ok", "ok", "person"]);
    // Ana (Ventas): vale el del departamento, 4.
    const a = await as(ana);
    const anaRuns = [];
    for (let i = 0; i < 5; i += 1) anaRuns.push(await ask(a));
    expect(anaRuns).toEqual(["ok", "ok", "ok", "ok", "person"]);
    // Carla está en Ventas pero su excepción propia (sin límite) gana.
    const c = await as(carla);
    const carlaRuns = [];
    for (let i = 0; i < 6; i += 1) carlaRuns.push(await ask(c));
    expect(carlaRuns).toEqual(Array(6).fill("ok"));
    // Dani: sin acceso, ni la primera.
    expect(await ask(await as(dani))).toBe("person");

    // Lo que ve cada una: de su límite y de la empresa, lo menor.
    const seen = await getAiUsage(b, deps());
    expect(seen.personal).toMatchObject({ used: 2, limit: 2, blocked: false, source: "general" });
    expect(seen.remaining).toBe(0);
    expect((await getAiUsage(await as(dani), deps())).personal.blocked).toBe(true);

    // El total de la empresa manda sobre todos: Carla no tiene tope, pero la empresa se queda sin cupo.
    await leaveCompanyWith(w, 1);
    expect(await ask(c)).toBe("ok");
    expect(await ask(c)).toBe("workspace");
    // Y la consulta que no pasó no le sumó nada a su contador personal.
    const after = await getAiUsage(c, deps());
    expect(after.personal.used).toBe(carlaRuns.length + 1);
    expect(after.remaining).toBe(0);
  });

  it("el total lo fija la empresa (sin él no hay tope); devolver una reserva la libera", async () => {
    const w = await pagesWorld(ctx, "Bian total");
    const owner = await contextOf(w, w.ownerMembership.userId);
    expect((await getAiUsage(owner, deps())).limit).toBeNull();
    const base = await leaveCompanyWith(w, 0);
    expect(await ask(owner)).toBe("workspace");
    // Subir el total desde Administración › Bian.
    const raised = await w.call("put", w.ws.token, "/admin/bian/total", {
      total: (base.limit ?? 0) + 2,
    });
    expect(raised.status).toBe(200);
    expect((await getAiUsage(owner, deps())).limit).toBe((base.limit ?? 0) + 2);
    const first = await reserveAiQuery(owner, deps());
    expect(await ask(owner)).toBe("ok");
    expect(await ask(owner)).toBe("workspace");
    await first.refund();
    expect(await ask(owner)).toBe("ok");
    // Sin límite: nunca se agota por la empresa.
    await w.call("put", w.ws.token, "/admin/bian/total", { total: null });
    expect(await ask(owner)).toBe("ok");
    // Quien no administra Bian no lo cambia.
    expect((await w.call("put", w.viewer.token, "/admin/bian/total", { total: 1 })).status).toBe(
      403,
    );
  });
});

describe("avisos a administradores y pedido de más consultas", () => {
  it("un aviso por umbral (80 % y 95 %) y período, solo a quienes administran Bian", async () => {
    const w = await pagesWorld(ctx, "Bian avisos");
    const usage = await leaveCompanyWith(w, 0);
    const total = usage.limit ?? 0;
    const owner = await contextOf(w, w.ownerMembership.userId);
    const member = await contextOf(w, w.editor.user.id);
    const counter = (aiQueries: number) =>
      ctx.prisma.usageCounter.update({
        where: {
          workspaceId_periodStart: {
            workspaceId: w.ws.workspaceId,
            periodStart: usage.periodStart,
          },
        },
        data: { aiQueries },
      });
    const notices = (membershipId: string) =>
      ctx.prisma.notification.findMany({
        where: { membershipId, kind: "bian_usage" },
        select: { version: true },
        orderBy: { version: "asc" },
      });

    await counter(Math.ceil(total * 0.8) - 1);
    await reserveAiQuery(member, deps());
    expect((await notices(w.ownerMembership.id)).map((n) => n.version)).toEqual([80]);
    // Repetir el cruce (devolver y volver a pedir) no duplica el aviso.
    await counter(Math.ceil(total * 0.8) - 1);
    await reserveAiQuery(member, deps());
    expect((await notices(w.ownerMembership.id)).map((n) => n.version)).toEqual([80]);
    await counter(Math.ceil(total * 0.95) - 1);
    await reserveAiQuery(owner, deps());
    expect((await notices(w.ownerMembership.id)).map((n) => n.version)).toEqual([80, 95]);
    // Quien no administra Bian no recibe nada.
    expect(await notices(w.editor.membership.id)).toEqual([]);
  });

  it("«Pedir más consultas» avisa a los administradores una vez por persona y período", async () => {
    const w = await pagesWorld(ctx, "Bian pedido");
    const member = await contextOf(w, w.editor.user.id);
    expect((await requestMoreQueries(member)).notified).toBeGreaterThan(0);
    expect((await requestMoreQueries(member)).notified).toBe(0);
    const requests = await ctx.prisma.notification.findMany({
      where: { membershipId: w.ownerMembership.id, kind: "bian_request" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.actorId).toBe(w.editor.membership.id);
    // La ruta existe para cualquier miembro.
    expect((await w.call("post", w.viewer.token, "/bian/request-more")).status).toBe(200);
  });
});

describe("administración: permisos, aislamiento y tabla de uso", () => {
  it("solo con security.manage o workspace.settings; de otra empresa, nada", async () => {
    const w = await pagesWorld(ctx, "Bian admin");
    expect((await w.call("get", w.ws.token, "/admin/bian/overview")).status).toBe(200);
    expect((await w.call("get", w.viewer.token, "/admin/bian/overview")).status).toBe(403);
    expect(
      (await put(w, { scope: "GENERAL", mode: "LIMIT", limit: 3 }, w.viewer.token)).status,
    ).toBe(403);
    expect((await w.call("get", w.outsider.token, "/admin/bian/overview")).status).toBe(404);
    const settingsRole = await ctx.prisma.role.create({
      data: {
        workspaceId: w.ws.workspaceId,
        name: "Ajustes",
        base: "ADMIN",
        capabilities: ["workspace.settings"],
      },
    });
    const finance = await addMember(ctx, w.ws, { roleId: settingsRole.id, name: "Fran Ajustes" });
    expect((await w.call("get", finance.token, "/admin/bian/overview")).status).toBe(200);
    // Reglas inválidas.
    expect((await put(w, { scope: "GENERAL", mode: "BLOCKED" })).status).toBe(400);
    expect((await put(w, { scope: "GENERAL", mode: "LIMIT" })).status).toBe(400);
    expect((await put(w, { scope: "PERSON", mode: "UNLIMITED" })).status).toBe(400);
    expect(
      (await put(w, { scope: "PERSON", subjectId: w.outsider.membershipId, mode: "BLOCKED" }))
        .status,
    ).toBe(404);
  });

  it("los límites y el uso de una empresa no aparecen en otra", async () => {
    const w = await pagesWorld(ctx, "Bian aislada");
    expect((await put(w, { scope: "GENERAL", mode: "LIMIT", limit: 7 })).status).toBe(200);
    const mine = (await w.call("get", w.ws.token, "/admin/bian/overview")).body as {
      limits: { general: { limit: number } | null };
    };
    expect(mine.limits.general?.limit).toBe(7);
    const theirs = (
      await w.call("get", w.outsider.token, "/admin/bian/overview", undefined, w.outsider.slug)
    ).body as { limits: { general: unknown; people: unknown[] } };
    expect(theirs.limits.general).toBeNull();
    expect(theirs.limits.people).toEqual([]);
    // La tabla de uso de la otra empresa no trae a nadie de esta.
    const usage = (
      await w.call("get", w.outsider.token, "/admin/bian/usage", undefined, w.outsider.slug)
    ).body as { items: { name: string }[] };
    expect(JSON.stringify(usage)).not.toContain("Edith Editora");
    // Un límite de una empresa no se puede borrar desde otra.
    const id = (
      (await w.call("get", w.ws.token, "/admin/bian/overview")).body as {
        limits: { general: { id: string } };
      }
    ).limits.general.id;
    expect(
      (
        await w.call(
          "delete",
          w.outsider.token,
          `/admin/bian/limits/${id}`,
          undefined,
          w.outsider.slug,
        )
      ).status,
    ).toBe(404);
  });

  it("la tabla de uso (y su CSV) trae solo cantidades, nunca contenido", async () => {
    const w = await pagesWorld(ctx, "Bian tabla");
    const editor = await contextOf(w, w.editor.user.id);
    await reserveAiQuery(editor, deps());
    await reserveAiQuery(editor, deps());
    // Un registro de auditoría de una consulta con contenido sensible no debe llegar a la tabla.
    const secret = "CONTRASEÑA-ULTRASECRETA-123";
    await ctx.prisma.auditLog.create({
      data: {
        workspaceId: w.ws.workspaceId,
        action: "bian.ask",
        metadata: { note: secret },
      },
    });

    const people = (
      await w.call("get", w.ws.token, "/admin/bian/usage?view=people&sort=used&dir=desc")
    ).body as {
      total: number;
      items: Record<string, unknown>[];
    };
    expect(people.items[0]).toMatchObject({ name: "Edith Editora", used: 2 });
    // Solo estos campos, todos cantidades o nombres de personas y departamentos.
    expect(Object.keys(people.items[0] ?? {}).sort()).toEqual([
      "departments",
      "limit",
      "membershipId",
      "mode",
      "name",
      "source",
      "used",
    ]);
    expect(JSON.stringify(people)).not.toContain(secret);

    const byName = (await w.call("get", w.ws.token, "/admin/bian/usage?view=people&q=zzzz"))
      .body as { items: unknown[] };
    expect(byName.items).toEqual([]);

    const csv = await w.call("get", w.ws.token, "/admin/bian/usage/export?view=people");
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text).toContain("Edith Editora");
    expect(csv.text).not.toContain(secret);
    expect(csv.text.split("\r\n")[0]).toContain("Consultas");

    const departments = (await w.call("get", w.ws.token, "/admin/bian/usage?view=departments"))
      .body as { items: Record<string, unknown>[] };
    for (const item of departments.items) {
      expect(Object.keys(item).sort()).toEqual([
        "departmentId",
        "limit",
        "mode",
        "name",
        "people",
        "source",
        "used",
      ]);
    }
    // Quien no administra Bian no la ve.
    expect((await w.call("get", w.viewer.token, "/admin/bian/usage")).status).toBe(403);
    expect((await w.call("get", w.viewer.token, "/admin/bian/usage/export")).status).toBe(403);
    // Y el período es el del contador (sanidad del escenario).
    const period = usagePeriod(new Date());
    expect(period.end.getTime()).toBeGreaterThan(period.start.getTime());
  });
});
