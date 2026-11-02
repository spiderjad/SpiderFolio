// Occupational health and safety, phase 2 (docs/spec/seguridad-salud.md, «EPIs»): the catalog, signed
// handouts, who sees whose PPE (everyone with safety.manage, leaders their area, the rest their own),
// replacement expiries (replaced by a new handout, resolved when voided, paused with the module off),
// voiding and «Le falta» by position.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { sendExpiryNotices } from "../../src/modules/expiries/expiry-notices.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const api = (slug: string, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  patch: (path: string, body?: object) =>
    request(app)
      .patch(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body?: object) =>
    request(app).put(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`).send(body),
});

/** Not a drawing, but a PNG to the server (it checks the signature is a PNG). */
const SIGNATURE = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]).toString("base64")}`;

interface World {
  ws: TestWorkspace;
  worker: Awaited<ReturnType<typeof addMember>>;
  colleague: Awaited<ReturnType<typeof addMember>>;
  leader: Awaited<ReturnType<typeof addMember>>;
  positionId: string;
}

/** A company with the module on, a position, a worker with it, a colleague and the worker's head. */
async function world(name: string): Promise<World> {
  const ws = await createWorkspace(ctx, name);
  const a = api(ws.slug, ws.token);
  expect((await a.put("/admin/safety", { enabled: true })).status).toBe(200);
  const position = await a.post("/admin/positions", { name: "Operario de cámaras" });
  const positionId = (position.body as { position: { id: string } }).position.id;
  const worker = await addMember(ctx, ws, { base: "MEMBER", name: "Ana Operaria" });
  const colleague = await addMember(ctx, ws, { base: "MEMBER", name: "Otro Operario" });
  const leader = await addMember(ctx, ws, { base: "MEMBER", name: "Jefa de Frío" });
  await a.patch(`/admin/members/${worker.membership.id}`, { positionId });
  const department = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Frío" },
  });
  await ctx.prisma.departmentMember.createMany({
    data: [
      {
        workspaceId: ws.workspaceId,
        departmentId: department.id,
        membershipId: leader.membership.id,
        position: "HEAD",
      },
      {
        workspaceId: ws.workspaceId,
        departmentId: department.id,
        membershipId: worker.membership.id,
        position: "MEMBER",
      },
    ],
  });
  return { ws, worker, colleague, leader, positionId };
}

const itemOf = (res: { body: unknown }) => (res.body as { item: { id: string } }).item.id;
const deliveryOf = (res: { body: unknown }) =>
  (res.body as { delivery: { id: string; lines: { id: string; replaceOn: string | null }[] } })
    .delivery;

describe("EPIs", () => {
  it("con el módulo apagado no existe", async () => {
    const ws = await createWorkspace(ctx, "EPIs apagado");
    const a = api(ws.slug, ws.token);
    expect((await a.get("/safety/items")).status).toBe(404);
    expect((await a.get("/safety/deliveries")).status).toBe(404);
    expect((await a.post("/safety/items", { name: "Guantes" })).status).toBe(404);
  });

  it("catálogo: solo quien gestiona; nombres sin repetir; archivado no se entrega", async () => {
    const w = await world("EPIs catálogo");
    const a = api(w.ws.slug, w.ws.token);
    expect(
      (await api(w.ws.slug, w.worker.token).post("/safety/items", { name: "Casco" })).status,
    ).toBe(403);
    const gloves = await a.post("/safety/items", {
      name: "Guantes anticorte",
      category: "Manos",
      hasSizes: true,
      lifeMonths: 6,
      positionIds: [w.positionId],
    });
    expect(gloves.status, JSON.stringify(gloves.body)).toBe(201);
    expect((await a.post("/safety/items", { name: "guantes ANTICORTE" })).status).toBe(409);
    expect((await a.post("/safety/items", { name: "Casco", positionIds: ["x"] })).status).toBe(404);
    const apron = itemOf(await a.post("/safety/items", { name: "Delantal" }));
    expect((await a.patch(`/safety/items/${apron}`, { archived: true })).status).toBe(200);
    const archived = await a.post("/safety/deliveries", {
      membershipId: w.worker.membership.id,
      lines: [{ itemId: apron, quantity: 1 }],
      signature: SIGNATURE,
    });
    expect(archived.status).toBe(400);
    const active = await a.get("/safety/items");
    expect((active.body as { items: { name: string }[] }).items.map((i) => i.name)).toEqual([
      "Guantes anticorte",
    ]);
  });

  it("entrega firmada con reposición; una nueva del mismo equipo reemplaza a la anterior", async () => {
    const w = await world("EPIs entregas");
    const a = api(w.ws.slug, w.ws.token);
    const gloves = itemOf(
      await a.post("/safety/items", { name: "Guantes", hasSizes: true, lifeMonths: 6 }),
    );
    const base = { membershipId: w.worker.membership.id, signature: SIGNATURE };
    expect(
      (await a.post("/safety/deliveries", { ...base, lines: [{ itemId: gloves, quantity: 2 }] }))
        .status,
    ).toBe(400);
    expect(
      (
        await a.post("/safety/deliveries", {
          ...base,
          signature: "data:image/png;base64,AAAA",
          lines: [{ itemId: gloves, quantity: 2, size: "8" }],
        })
      ).status,
    ).toBe(400);
    const first = await a.post("/safety/deliveries", {
      ...base,
      lines: [{ itemId: gloves, quantity: 2, size: "8" }],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const line = deliveryOf(first).lines[0];
    expect(line?.replaceOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, kind: "safety.ppe", subjectId: line?.id ?? "" },
    });
    expect(expiry).toMatchObject({
      membershipId: w.worker.membership.id,
      responsibleId: w.ws.membershipId,
      resolvedAt: null,
    });
    await a.post("/safety/deliveries", {
      ...base,
      lines: [{ itemId: gloves, quantity: 1, size: "8" }],
    });
    const replaced = await ctx.prisma.expiry.findUniqueOrThrow({ where: { id: expiry.id } });
    expect(replaced.resolvedAt).not.toBeNull();
    const signature = await a.get(`/safety/deliveries/${deliveryOf(first).id}/signature`);
    expect(signature.status).toBe(200);
    expect(signature.headers["content-type"]).toBe("image/png");
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "safety.delivery.create" },
      }),
    ).toBe(2);
  });

  it("cada uno ve lo suyo, el jefe su área y quien gestiona todo", async () => {
    const w = await world("EPIs alcance");
    const a = api(w.ws.slug, w.ws.token);
    const boots = itemOf(await a.post("/safety/items", { name: "Botas" }));
    const own = deliveryOf(
      await a.post("/safety/deliveries", {
        membershipId: w.worker.membership.id,
        lines: [{ itemId: boots, quantity: 1 }],
        signature: SIGNATURE,
      }),
    );
    const other = deliveryOf(
      await a.post("/safety/deliveries", {
        membershipId: w.colleague.membership.id,
        lines: [{ itemId: boots, quantity: 1 }],
        signature: SIGNATURE,
      }),
    );
    const ids = async (token: string) =>
      (
        (await api(w.ws.slug, token).get("/safety/deliveries")).body as { items: { id: string }[] }
      ).items.map((d) => d.id);
    expect((await ids(w.ws.token)).sort()).toEqual([own.id, other.id].sort());
    expect(await ids(w.worker.token)).toEqual([own.id]);
    expect(await ids(w.leader.token)).toEqual([own.id]);
    expect(
      (await api(w.ws.slug, w.worker.token).get(`/safety/deliveries/${other.id}`)).status,
    ).toBe(404);
    expect(
      (await api(w.ws.slug, w.worker.token).get(`/safety/people/${w.colleague.membership.id}/ppe`))
        .status,
    ).toBe(404);
    expect(
      (await api(w.ws.slug, w.leader.token).get(`/safety/people/${w.worker.membership.id}/ppe`))
        .status,
    ).toBe(200);
    // Filtering by someone they don't see gives nothing.
    const filtered = await api(w.ws.slug, w.worker.token).get(
      `/safety/deliveries?person=${w.colleague.membership.id}`,
    );
    expect((filtered.body as { total: number }).total).toBe(0);
  });

  it("anular: solo quien gestiona, con motivo, una vez; resuelve la reposición", async () => {
    const w = await world("EPIs anular");
    const a = api(w.ws.slug, w.ws.token);
    const mask = itemOf(await a.post("/safety/items", { name: "Mascarilla", lifeMonths: 1 }));
    const delivery = deliveryOf(
      await a.post("/safety/deliveries", {
        membershipId: w.worker.membership.id,
        lines: [{ itemId: mask, quantity: 5 }],
        signature: SIGNATURE,
      }),
    );
    const path = `/safety/deliveries/${delivery.id}/void`;
    expect((await api(w.ws.slug, w.leader.token).post(path, { reason: "Error" })).status).toBe(403);
    expect((await a.post(path, { reason: " " })).status).toBe(400);
    expect((await a.post(path, { reason: "Persona equivocada" })).status).toBe(200);
    expect((await a.post(path, { reason: "Otra vez" })).status).toBe(409);
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { kind: "safety.ppe", subjectId: delivery.lines[0]?.id ?? "" },
    });
    expect(expiry.resolvedAt).not.toBeNull();
    expect(
      await ctx.prisma.safetyDelivery.count({
        where: { id: delivery.id, voidedAt: { not: null } },
      }),
    ).toBe(1);
  });

  it("«Le falta»: lo que pide su puesto y no tiene, o tiene vencido", async () => {
    const w = await world("EPIs le falta");
    const a = api(w.ws.slug, w.ws.token);
    const jacket = itemOf(
      await a.post("/safety/items", { name: "Chaqueta de frío", positionIds: [w.positionId] }),
    );
    const gloves = itemOf(
      await a.post("/safety/items", {
        name: "Guantes de frío",
        lifeMonths: 3,
        positionIds: [w.positionId],
      }),
    );
    const ppe = async () =>
      (await a.get(`/safety/people/${w.worker.membership.id}/ppe`)).body as {
        person: { position: { name: string } | null };
        missing: { id: string; expired: boolean }[];
        current: { item: { id: string }; state: string }[];
      };
    expect((await ppe()).person.position?.name).toBe("Operario de cámaras");
    expect((await ppe()).missing.map((m) => m.id).sort()).toEqual([jacket, gloves].sort());
    const delivery = deliveryOf(
      await a.post("/safety/deliveries", {
        membershipId: w.worker.membership.id,
        lines: [
          { itemId: jacket, quantity: 1 },
          { itemId: gloves, quantity: 2 },
        ],
        signature: SIGNATURE,
      }),
    );
    expect((await ppe()).missing).toEqual([]);
    // The gloves' replacement day went by.
    const glovesLine = delivery.lines.find((line) => line.replaceOn !== null);
    await ctx.prisma.safetyDeliveryLine.update({
      where: { id: glovesLine?.id ?? "" },
      data: { replaceOn: new Date("2020-01-01T00:00:00Z") },
    });
    const after = await ppe();
    expect(after.missing).toEqual([{ id: gloves, name: "Guantes de frío", expired: true }]);
    expect(after.current.find((c) => c.item.id === gloves)?.state).toBe("expired");
  });

  it("lista de personas con avisos: quien gestiona ve todas, el jefe su área, el resto nadie más", async () => {
    const w = await world("EPIs personas");
    const a = api(w.ws.slug, w.ws.token);
    await a.post("/safety/items", { name: "Chaqueta", positionIds: [w.positionId] });
    const list = async (token: string, query = "") =>
      (await api(w.ws.slug, token).get(`/safety/people${query}`)).body as {
        items: { id: string; alerts: { missingPpe: number } }[];
      };
    const all = await list(w.ws.token);
    expect(all.items.find((row) => row.id === w.worker.membership.id)?.alerts.missingPpe).toBe(1);
    expect(
      (await list(w.ws.token, `?position=${w.positionId}`)).items.map((row) => row.id),
    ).toEqual([w.worker.membership.id]);
    expect((await list(w.leader.token)).items.map((row) => row.id).sort()).toEqual(
      [w.leader.membership.id, w.worker.membership.id].sort(),
    );
    expect((await list(w.colleague.token)).items.map((row) => row.id)).toEqual([
      w.colleague.membership.id,
    ]);
  });

  it("con el módulo apagado la reposición espera, sin avisar ni resolverse", async () => {
    const w = await world("EPIs pausa");
    const a = api(w.ws.slug, w.ws.token);
    const ear = itemOf(await a.post("/safety/items", { name: "Tapones", lifeMonths: 1 }));
    const delivery = deliveryOf(
      await a.post("/safety/deliveries", {
        membershipId: w.worker.membership.id,
        lines: [{ itemId: ear, quantity: 10 }],
        signature: SIGNATURE,
      }),
    );
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { kind: "safety.ppe", subjectId: delivery.lines[0]?.id ?? "" },
    });
    await ctx.prisma.expiry.update({
      where: { id: expiry.id },
      data: { dueOn: new Date(Date.now() + 2 * 86_400_000) },
    });
    await a.put("/admin/safety", { enabled: false });
    const deps = { prisma: ctx.prisma, logger: ctx.deps.logger, jobs: ctx.deps.jobs };
    await sendExpiryNotices(deps, new Date(), { anyHour: true });
    const notices = () =>
      ctx.prisma.notification.count({ where: { kind: "expiry_due", expiryId: expiry.id } });
    expect(await notices()).toBe(0);
    expect(
      (await ctx.prisma.expiry.findUniqueOrThrow({ where: { id: expiry.id } })).resolvedAt,
    ).toBe(null);
    await a.put("/admin/safety", { enabled: true });
    await sendExpiryNotices(deps, new Date(), { anyHour: true });
    // The worker and whoever handed it out.
    expect(await notices()).toBe(2);
  });
});
