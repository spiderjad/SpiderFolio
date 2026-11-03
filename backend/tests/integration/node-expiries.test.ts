// Expiries of files and pages (docs/spec/vencimientos.md): who sees and sets them, the lists only show
// what the person sees, another company's element is 404, a department's heads and deputies get the
// notices, the trash waits and «Sugerir con Bian» never saves and respects permissions and the quota.
import type Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { indexNode } from "../../src/modules/bian/indexer.ts";
import { sendExpiryNotices } from "../../src/modules/expiries/expiry-notices.ts";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { doc, pagesWorld, paragraph, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

interface ExpiryReply {
  expiry: {
    dueOn: string;
    state: string;
    responsible: { type: string; id: string; name: string } | null;
    responsibleCantSee: boolean;
  } | null;
  canEdit: boolean;
}

async function world(label: string) {
  const w = await pagesWorld(ctx, label);
  // Another private space nobody but the owner sees.
  const other = await w.call("post", w.ws.token, "/spaces", { name: "Dirección", isPrivate: true });
  expect(other.status).toBe(201);
  const hiddenSpace = (other.body as { space: { id: string } }).space.id;
  const hidden = await w.call("post", w.ws.token, `/spaces/${hiddenSpace}/pages`, {});
  const hiddenPage = (hidden.body as { page: { node: { id: string } } }).page.node.id;
  const put = (token: string, nodeId: string, body: object) =>
    w.call("put", token, `/nodes/${nodeId}/expiry`, body);
  return { ...w, hiddenSpace, hiddenPage, put };
}

const notifyDeps = () => ({ prisma: ctx.prisma, logger: ctx.deps.logger, jobs: ctx.deps.jobs });

const expiryOf = (nodeId: string) =>
  ctx.prisma.expiry.findFirst({ where: { kind: "node", subjectId: nodeId } });

describe("permisos", () => {
  let w: Awaited<ReturnType<typeof world>>;
  beforeAll(async () => {
    w = await world("Vencimientos permisos");
  });

  it("quien edita lo pone; quien solo ve lo ve en solo lectura; sin acceso es 404", async () => {
    const set = await w.put(w.editor.token, w.pageId, { dueOn: day(10) });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((set.body as ExpiryReply).expiry?.dueOn).toBe(day(10));

    const seen = await w.call("get", w.viewer.token, `/nodes/${w.pageId}/expiry`);
    expect(seen.status).toBe(200);
    expect((seen.body as ExpiryReply).canEdit).toBe(false);
    expect((seen.body as ExpiryReply).expiry?.dueOn).toBe(day(10));
    expect((await w.put(w.viewer.token, w.pageId, { dueOn: day(20) })).status).toBe(403);
    expect((await w.call("delete", w.viewer.token, `/nodes/${w.pageId}/expiry`)).status).toBe(403);
    expect(
      (await w.call("get", w.viewer.token, `/nodes/${w.pageId}/expiry/responsible-options`)).status,
    ).toBe(403);

    expect((await w.call("get", w.stranger.token, `/nodes/${w.pageId}/expiry`)).status).toBe(404);
    expect((await w.put(w.stranger.token, w.pageId, { dueOn: day(20) })).status).toBe(404);
    expect((await expiryOf(w.pageId))?.dueOn.toISOString().slice(0, 10)).toBe(day(10));
  });

  it("sin responsable elegido, el responsable es quien lo pone", async () => {
    const set = await w.put(w.editor.token, w.pageId, { dueOn: day(12), responsible: null });
    expect((set.body as ExpiryReply).expiry?.responsible).toMatchObject({
      type: "person",
      id: w.editor.membership.id,
    });
  });

  it("avisa si la persona responsable no ve el elemento", async () => {
    const set = await w.put(w.editor.token, w.pageId, {
      dueOn: day(12),
      responsible: { type: "person", id: w.stranger.membership.id },
    });
    expect((set.body as ExpiryReply).expiry?.responsibleCantSee).toBe(true);
  });

  it("expirations.manage lo pone en lo que ve, aunque no lo edite; no en lo que no ve", async () => {
    const role = await ctx.prisma.role.create({
      data: {
        workspaceId: w.ws.workspaceId,
        name: "Gestor de vencimientos",
        base: "MEMBER",
        capabilities: ["expirations.manage"],
      },
    });
    const manager = await addMember(ctx, w.ws, { roleId: role.id, name: "Gonzalo Gestor" });
    await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: manager.membership.id,
        level: "VIEW",
        grantedById: w.ownerMembership.id,
      },
    });
    expect((await w.put(manager.token, w.pageId, { dueOn: day(30) })).status).toBe(200);
    expect((await w.put(manager.token, w.hiddenPage, { dueOn: day(30) })).status).toBe(404);
  });

  it("una persona o un departamento de otra empresa no puede ser responsable", async () => {
    const foreign = await ctx.prisma.membership.findFirstOrThrow({
      where: { workspaceId: w.outsider.workspaceId },
    });
    const res = await w.put(w.ws.token, w.pageId, {
      dueOn: day(30),
      responsible: { type: "person", id: foreign.id },
    });
    expect(res.status).toBe(404);
    const department = await ctx.prisma.department.create({
      data: { workspaceId: w.outsider.workspaceId, name: "Ajeno" },
    });
    expect(
      (
        await w.put(w.ws.token, w.pageId, {
          dueOn: day(30),
          responsible: { type: "department", id: department.id },
        })
      ).status,
    ).toBe(404);
  });

  it("las listas, el CSV, los filtros y las insignias solo muestran lo que la persona ve", async () => {
    await w.put(w.ws.token, w.hiddenPage, { dueOn: day(3) });
    const ids = (body: unknown) =>
      (body as { items: { node: { id: string } }[] }).items.map((row) => row.node.id);
    const mine = await w.call("get", w.viewer.token, "/expiries");
    expect(ids(mine.body)).toContain(w.pageId);
    expect(ids(mine.body)).not.toContain(w.hiddenPage);
    expect(ids((await w.call("get", w.ws.token, "/expiries")).body)).toContain(w.hiddenPage);

    const csv = await w.call("get", w.viewer.token, "/expiries/export");
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain("Dirección");

    const filters = await w.call("get", w.viewer.token, "/expiries/filters");
    const spaces = (filters.body as { spaces: { id: string }[] }).spaces.map((s) => s.id);
    expect(spaces).toEqual([w.spaceId]);

    expect((await w.call("get", w.viewer.token, `/expiries/space/${w.hiddenSpace}`)).body).toEqual({
      items: [],
    });
  });

  it("queda en la auditoría", async () => {
    const actions = await ctx.prisma.auditLog.findMany({
      where: {
        workspaceId: w.ws.workspaceId,
        entityId: w.pageId,
        action: { startsWith: "node.expiry" },
      },
      select: { action: true },
    });
    expect(actions.map((row) => row.action)).toContain("node.expiry.set");
    expect((await w.call("delete", w.editor.token, `/nodes/${w.pageId}/expiry`)).status).toBe(204);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, entityId: w.pageId, action: "node.expiry.remove" },
      }),
    ).toBe(1);
  });
});

describe("aislamiento entre empresas", () => {
  it("el elemento de otra empresa es 404 en todas las rutas", async () => {
    const w = await world("Vencimientos aislamiento");
    await w.put(w.ws.token, w.pageId, { dueOn: day(5) });
    const slug = w.outsider.slug;
    const token = w.outsider.token;
    const paths: ["get" | "put" | "delete" | "post", string][] = [
      ["get", `/nodes/${w.pageId}/expiry`],
      ["put", `/nodes/${w.pageId}/expiry`],
      ["delete", `/nodes/${w.pageId}/expiry`],
      ["get", `/nodes/${w.pageId}/expiry/responsible-options`],
      ["post", `/nodes/${w.pageId}/expiry/suggest`],
      ["get", `/expiries/space/${w.spaceId}`],
    ];
    for (const [method, path] of paths) {
      const res = await w.call(method, token, path, { dueOn: day(1) }, slug);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const list = await w.call("get", token, "/expiries", undefined, slug);
    expect((list.body as { items: unknown[] }).items).toEqual([]);
    expect((await expiryOf(w.pageId))?.dueOn.toISOString().slice(0, 10)).toBe(day(5));
  });
});

describe("avisos", () => {
  /** A department with a head, a deputy and a plain member; only the given ones see the space. */
  async function department(w: Awaited<ReturnType<typeof world>>, seeing: ("head" | "deputy")[]) {
    const created = await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Calidad" },
    });
    const people = {
      head: await addMember(ctx, w.ws, { name: "Julia Jefa" }),
      deputy: await addMember(ctx, w.ws, { name: "Sergio Subjefe" }),
      plain: await addMember(ctx, w.ws, { name: "Mario Miembro" }),
    };
    const positions = { head: "HEAD", deputy: "DEPUTY", plain: "MEMBER" } as const;
    for (const key of ["head", "deputy", "plain"] as const) {
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.ws.workspaceId,
          departmentId: created.id,
          membershipId: people[key].membership.id,
          position: positions[key],
        },
      });
    }
    for (const key of [...seeing, "plain" as const]) {
      await ctx.prisma.permission.create({
        data: {
          workspaceId: w.ws.workspaceId,
          spaceId: w.spaceId,
          membershipId: people[key].membership.id,
          level: "VIEW",
          grantedById: w.ownerMembership.id,
        },
      });
    }
    return { id: created.id, ...people };
  }

  const toldAbout = async (nodeId: string) => {
    const expiry = await expiryOf(nodeId);
    await sendExpiryNotices(notifyDeps(), new Date(), { anyHour: true });
    const rows = await ctx.prisma.notification.findMany({
      where: { kind: "expiry_due", expiryId: expiry?.id ?? "" },
      select: { membershipId: true },
    });
    return rows.map((row) => row.membershipId).sort();
  };

  it("un departamento avisa a sus jefes y subjefes que ven el elemento, no al resto", async () => {
    const w = await world("Vencimientos departamento");
    const team = await department(w, ["head"]);
    const set = await w.put(w.editor.token, w.pageId, {
      dueOn: day(2),
      responsible: { type: "department", id: team.id },
    });
    expect((set.body as ExpiryReply).expiry?.responsibleCantSee).toBe(false);
    // The deputy can't see the page: the notice would give its name away.
    expect(await toldAbout(w.pageId)).toEqual([team.head.membership.id]);
    expect((await w.call("get", team.head.token, "/expiries/mine/count")).body).toEqual({
      count: 1,
      expired: 0,
    });
    for (const other of [team.deputy, team.plain]) {
      expect((await w.call("get", other.token, "/expiries/mine/count")).body).toEqual({
        count: 0,
        expired: 0,
      });
    }
  });

  it("si nadie del departamento ve el elemento, avisa a quien lo puso", async () => {
    const w = await world("Vencimientos departamento ciego");
    const team = await department(w, []);
    const set = await w.put(w.editor.token, w.pageId, {
      dueOn: day(2),
      responsible: { type: "department", id: team.id },
    });
    expect((set.body as ExpiryReply).expiry?.responsibleCantSee).toBe(true);
    expect(await toldAbout(w.pageId)).toEqual([w.editor.membership.id]);
  });

  it("si la persona responsable no ve el elemento, avisa a quien lo puso y no a ella", async () => {
    const w = await world("Vencimientos persona ciega");
    await w.put(w.editor.token, w.pageId, {
      dueOn: day(2),
      responsible: { type: "person", id: w.stranger.membership.id },
    });
    expect(await toldAbout(w.pageId)).toEqual([w.editor.membership.id]);
  });

  it("si nadie que deba enterarse lo ve, no avisa a nadie", async () => {
    const w = await world("Vencimientos nadie");
    await w.put(w.editor.token, w.pageId, {
      dueOn: day(2),
      responsible: { type: "person", id: w.stranger.membership.id },
    });
    // Whoever set it lost access afterwards.
    await ctx.prisma.permission.deleteMany({
      where: { spaceId: w.spaceId, membershipId: w.editor.membership.id },
    });
    expect(await toldAbout(w.pageId)).toEqual([]);
  });

  it("el contador separa los vencidos", async () => {
    const w = await world("Vencimientos contador");
    const second = await w.makePage();
    await w.put(w.editor.token, w.pageId, { dueOn: day(-2) });
    await w.put(w.editor.token, second.node.id, { dueOn: day(4) });
    expect((await w.call("get", w.editor.token, "/expiries/mine/count")).body).toEqual({
      count: 2,
      expired: 1,
    });
  });

  it("en la papelera espera; al restaurar vuelve a avisar; borrado para siempre, desaparece", async () => {
    const w = await world("Vencimientos papelera");
    await w.put(w.editor.token, w.pageId, { dueOn: day(2) });
    const expiry = await expiryOf(w.pageId);
    const notices = () =>
      ctx.prisma.notification.count({ where: { kind: "expiry_due", expiryId: expiry?.id ?? "" } });

    expect((await w.call("delete", w.ws.token, `/nodes/${w.pageId}`)).status).toBe(204);
    await sendExpiryNotices(notifyDeps(), new Date(), { anyHour: true });
    expect(await notices()).toBe(0);
    expect((await expiryOf(w.pageId))?.resolvedAt).toBe(null);
    // Not in the lists either while it's in the trash.
    expect(
      ((await w.call("get", w.ws.token, "/expiries")).body as { items: unknown[] }).items,
    ).toEqual([]);

    expect((await w.call("post", w.ws.token, `/nodes/${w.pageId}/restore`)).status).toBe(200);
    await sendExpiryNotices(notifyDeps(), new Date(), { anyHour: true });
    expect(await notices()).toBe(1);

    expect((await w.call("delete", w.ws.token, `/nodes/${w.pageId}`)).status).toBe(204);
    expect((await w.call("delete", w.ws.token, `/nodes/${w.pageId}/purge`)).status).toBe(204);
    expect(await expiryOf(w.pageId)).toBe(null);
  });
});

describe("Sugerir con Bian", () => {
  function fakeModel() {
    const calls: unknown[] = [];
    let reply: object = { dueOn: "", evidence: "", note: "", responsible: "" };
    const client = {
      messages: {
        create(params: unknown) {
          calls.push(params);
          return Promise.resolve({
            stop_reason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 20 },
            content: [{ type: "text", text: JSON.stringify(reply) }],
          });
        },
      },
    };
    return {
      client: client as unknown as Anthropic,
      calls,
      say(next: object) {
        reply = next;
      },
    };
  }

  async function bianWorld(label: string) {
    const w = await world(label);
    const model = fakeModel();
    const app = createApp({ ...ctx.deps, anthropic: model.client });
    const suggest = (token: string, nodeId: string) =>
      request(app)
        .post(`/api/v1/w/${w.ws.slug}/nodes/${nodeId}/expiry/suggest`)
        .set("Authorization", `Bearer ${token}`)
        .send();
    const used = async (token: string) =>
      (
        (
          await request(app)
            .get(`/api/v1/w/${w.ws.slug}/bian/usage`)
            .set("Authorization", `Bearer ${token}`)
        ).body as { usage: { used: number } }
      ).usage.used;
    return { ...w, model, suggest, used };
  }

  async function withText(w: PagesWorld, text: string) {
    expect((await w.save(w.ws.token, w.pageId, w.page.revision, doc(paragraph(text)))).status).toBe(
      200,
    );
    await indexNode({ prisma: ctx.prisma }, { workspaceId: w.ws.workspaceId, nodeId: w.pageId });
  }

  it("propone fecha, nota y responsable sin guardar nada y gasta una consulta", async () => {
    const w = await bianWorld("Vencimientos Bian");
    await withText(
      w,
      "Certificado de calibración. Válido hasta el 31/03/2027. Lo renueva Calidad.",
    );
    await ctx.prisma.department.create({
      data: { workspaceId: w.ws.workspaceId, name: "Calidad" },
    });
    w.model.say({
      dueOn: "2027-03-31",
      evidence: "Válido hasta el 31/03/2027.",
      note: "Renovar la calibración.",
      responsible: "calidad",
    });
    const before = await w.used(w.editor.token);
    const res = await w.suggest(w.editor.token, w.pageId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { suggestion: unknown }).suggestion).toMatchObject({
      dueOn: "2027-03-31",
      note: "Renovar la calibración.",
      responsible: { type: "department", name: "Calidad" },
    });
    expect(await w.used(w.editor.token)).toBe(before + 1);
    expect(await expiryOf(w.pageId)).toBe(null);
    // The document goes as data, never in the prompt.
    const sent = JSON.stringify(w.model.calls[0]);
    expect(sent).toContain('"type":"document"');
    expect((w.model.calls[0] as { system: string }).system).not.toContain("31/03/2027");
  });

  it("una fecha que no es fecha no se propone", async () => {
    const w = await bianWorld("Vencimientos Bian fecha");
    await withText(w, "Procedimiento sin fecha.");
    w.model.say({ dueOn: "pronto", evidence: "", note: "", responsible: "Nadie Conocido" });
    const res = await w.suggest(w.ws.token, w.pageId);
    expect((res.body as { suggestion: unknown }).suggestion).toEqual({
      dueOn: null,
      evidence: null,
      note: null,
      responsible: null,
    });
  });

  it("quien solo ve el elemento, o no lo ve, no puede pedirlo ni gasta consultas", async () => {
    const w = await bianWorld("Vencimientos Bian permisos");
    await withText(w, "Válido hasta el 01/01/2028.");
    const before = await w.used(w.viewer.token);
    expect((await w.suggest(w.viewer.token, w.pageId)).status).toBe(403);
    expect((await w.suggest(w.stranger.token, w.pageId)).status).toBe(404);
    expect(await w.used(w.viewer.token)).toBe(before);
    expect(w.model.calls).toHaveLength(0);
  });

  it("con Bian apagado en la empresa no se puede", async () => {
    const w = await bianWorld("Vencimientos Bian apagado");
    await withText(w, "Válido hasta el 01/01/2028.");
    const row = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } });
    await ctx.prisma.workspace.update({
      where: { id: w.ws.workspaceId },
      data: { settings: { ...(row.settings as object), bianEnabled: false } },
    });
    const res = await w.suggest(w.ws.token, w.pageId);
    expect(res.status).not.toBe(200);
    expect(w.model.calls).toHaveLength(0);
  });
});
