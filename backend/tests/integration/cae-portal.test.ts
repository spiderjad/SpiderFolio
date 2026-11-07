// The contractor's portal (docs/spec/cae.md, «Portal de contratas»), security: code tries limited and the
// access locked after too many wrong codes; one generic answer for every refusal (no oracle); a session
// only reaches its own company (another contractor's or another tenant's ids answer 404); revoking or
// expiring the access, archiving the company or turning CAE off ends the session; only PDF, JPG and PNG
// by their real bytes; an upload not started by this access can't be completed through it; a cookie set
// before entering is ignored (no fixation) and the session rotates; the information endpoint serves only
// the chosen documents; the log has no actor and never the code.
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
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

// Every test enters from the same address: the per-address limits start clean each time.
beforeEach(async () => {
  await ctx.prisma.rateLimitBucket.deleteMany({});
});

const api = (slug: string, token: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/w/${slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body),
  put: (path: string, body?: object) =>
    request(app).put(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`).send(body),
});

const PORTAL = "/api/v1/contratas";

interface Company {
  id: string;
  workerId: string;
  accessId: string;
  code: string;
}

interface World {
  ws: TestWorkspace;
  manager: Awaited<ReturnType<typeof addMember>>;
  a: Company;
  b: Company;
  workerReq: string;
  companyReq: string;
}

async function company(ws: TestWorkspace, token: string, name: string, responsibleId: string) {
  const m = api(ws.slug, token);
  const created = await m.post("/cae/companies", { name, kind: "CONTRACTOR", responsibleId });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body as { company: { id: string } }).company.id;
  const worker = await m.post(`/cae/companies/${id}/workers`, { name: `Trabajador de ${name}` });
  expect(worker.status).toBe(201);
  const issued = await m.post(`/cae/companies/${id}/portal`, { days: 7 });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const body = issued.body as { access: { id: string }; code: string };
  return {
    id,
    workerId: (worker.body as { worker: { id: string } }).worker.id,
    accessId: body.access.id,
    code: body.code,
  };
}

async function world(name: string): Promise<World> {
  const ws = await createWorkspace(ctx, name);
  const owner = api(ws.slug, ws.token);
  expect((await owner.put("/admin/safety", { enabled: true, cae: true })).status).toBe(200);
  const role = await ctx.prisma.role.create({
    data: {
      workspaceId: ws.workspaceId,
      name: "CAE",
      base: "MEMBER",
      capabilities: ["cae.manage"],
    },
  });
  const manager = await addMember(ctx, ws, { roleId: role.id, name: "Gestora CAE" });
  // The issuer edits the module's space (the portal uploads go through their access to the folder).
  const settings = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId } });
  const spaceId = (settings.settings as { safety: { spaceId: string } }).safety.spaceId;
  await ctx.prisma.permission.create({
    data: {
      workspaceId: ws.workspaceId,
      spaceId,
      membershipId: manager.membership.id,
      level: "EDIT",
      grantedById: ws.membershipId,
    },
  });
  const responsible = await addMember(ctx, ws, { base: "MEMBER", name: "Responsable" });
  const m = api(ws.slug, manager.token);
  const companyReq = await m.post("/cae/requirements", { name: "Seguro RC", scope: "COMPANY" });
  const workerReq = await m.post("/cae/requirements", { name: "Formación", scope: "WORKER" });
  return {
    ws,
    manager,
    a: await company(ws, manager.token, `${name} A`, responsible.membership.id),
    b: await company(ws, manager.token, `${name} B`, responsible.membership.id),
    companyReq: (companyReq.body as { requirement: { id: string } }).requirement.id,
    workerReq: (workerReq.body as { requirement: { id: string } }).requirement.id,
  };
}

/** A browser-like agent signed in to this access. */
async function enter(c: Company) {
  const agent = request.agent(app);
  const res = await agent.post(`${PORTAL}/${c.accessId}/session`).send({ code: c.code });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
  return agent;
}

const cookieOf = (res: { headers: Record<string, unknown> }): string | undefined => {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  const line = list.find((value) => value.startsWith("sf_cae_portal="));
  return line?.split(";")[0]?.slice("sf_cae_portal=".length);
};

describe("portal: el código", () => {
  it("la misma respuesta para todo rechazo: acceso inexistente, código malo, revocado o vencido", async () => {
    const w = await world("Portal oráculo");
    const tries = [
      await request(app).post(`${PORTAL}/no-existe/session`).send({ code: w.a.code }),
      await request(app).post(`${PORTAL}/${w.a.accessId}/session`).send({ code: "AAAA-BBBB-CCCC" }),
    ];
    await ctx.prisma.caePortalAccess.update({
      where: { id: w.b.accessId },
      data: { revokedAt: new Date() },
    });
    tries.push(
      await request(app).post(`${PORTAL}/${w.b.accessId}/session`).send({ code: w.b.code }),
    );
    await ctx.prisma.caePortalAccess.update({
      where: { id: w.a.accessId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    tries.push(
      await request(app).post(`${PORTAL}/${w.a.accessId}/session`).send({ code: w.a.code }),
    );
    const first = tries[0];
    for (const res of tries) {
      expect(res.status).toBe(first?.status);
      expect((res.body as { error: { message: string } }).error.message).toBe(
        (first?.body as { error: { message: string } }).error.message,
      );
      expect(cookieOf(res)).toBeUndefined();
    }
    expect(first?.status).toBe(400);
  });

  it("fuerza bruta: límite por acceso y dirección, y bloqueo a los 10 códigos malos", async () => {
    const w = await world("Portal fuerza bruta");
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post(`${PORTAL}/${w.a.accessId}/session`)
        .send({ code: `AAAA-BBBB-${String(1000 + i)}` });
      expect(res.status).toBe(400);
    }
    // The 11th try is cut by the limit even with the right code.
    const limited = await request(app)
      .post(`${PORTAL}/${w.a.accessId}/session`)
      .send({ code: w.a.code });
    expect(limited.status).toBe(429);
    // With the limit gone, the access is locked: the right code no longer opens it.
    await ctx.prisma.rateLimitBucket.deleteMany({});
    const locked = await request(app)
      .post(`${PORTAL}/${w.a.accessId}/session`)
      .send({ code: w.a.code });
    expect(locked.status).toBe(400);
    const access = await ctx.prisma.caePortalAccess.findUniqueOrThrow({
      where: { id: w.a.accessId },
    });
    expect(access.failedAttempts).toBeGreaterThanOrEqual(10);
    // Another access of the same company… isn't affected.
    expect((await enter(w.b)).constructor).toBeDefined();
  });

  it("la auditoría no tiene actor y nunca guarda el código", async () => {
    const w = await world("Portal auditoría");
    await request(app).post(`${PORTAL}/${w.a.accessId}/session`).send({ code: "ZZZZ-ZZZZ-ZZZZ" });
    await enter(w.a);
    const rows = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: w.ws.workspaceId, action: { startsWith: "cae.portal.login" } },
    });
    expect(rows.map((row) => row.action).sort()).toEqual([
      "cae.portal.login",
      "cae.portal.login.failure",
    ]);
    for (const row of rows) {
      expect(row.actorId).toBeNull();
      const text = JSON.stringify(row.metadata);
      expect(text).not.toContain(w.a.code);
      expect(text).not.toContain(w.a.code.replace(/-/gu, ""));
      expect(text).not.toContain("ZZZZ");
    }
    // Issuing the access doesn't log the code either.
    const issued = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: w.ws.workspaceId, action: { contains: "portal" } },
    });
    for (const row of issued) expect(JSON.stringify(row.metadata)).not.toContain(w.a.code);
  });
});

describe("portal: la sesión", () => {
  it("una cookie puesta antes de entrar se ignora y la sesión es nueva", async () => {
    const w = await world("Portal fijación");
    const preset = "token-elegido-por-el-atacante";
    const res = await request(app)
      .post(`${PORTAL}/${w.a.accessId}/session`)
      .set("Cookie", `sf_cae_portal=${preset}`)
      .send({ code: w.a.code });
    expect(res.status).toBe(204);
    const token = cookieOf(res);
    expect(token).toBeDefined();
    expect(token).not.toBe(preset);
    const withPreset = await request(app)
      .get(`${PORTAL}/${w.a.accessId}/overview`)
      .set("Cookie", `sf_cae_portal=${preset}`);
    expect(withPreset.status).toBe(401);
    const withNew = await request(app)
      .get(`${PORTAL}/${w.a.accessId}/overview`)
      .set("Cookie", `sf_cae_portal=${token ?? ""}`);
    expect(withNew.status).toBe(200);
    // The session of one access doesn't open another.
    const elsewhere = await request(app)
      .get(`${PORTAL}/${w.b.accessId}/overview`)
      .set("Cookie", `sf_cae_portal=${token ?? ""}`);
    expect(elsewhere.status).toBe(401);
  });

  it("rota el token con el uso y el cierre de sesión lo termina", async () => {
    const w = await world("Portal rotación");
    const res = await request(app)
      .post(`${PORTAL}/${w.a.accessId}/session`)
      .send({ code: w.a.code });
    const token = cookieOf(res) ?? "";
    // As if it had been in use for 20 minutes.
    await ctx.prisma.caePortalSession.updateMany({
      where: { accessId: w.a.accessId },
      data: { createdAt: new Date(Date.now() - 20 * 60_000) },
    });
    const used = await request(app)
      .get(`${PORTAL}/${w.a.accessId}/overview`)
      .set("Cookie", `sf_cae_portal=${token}`);
    expect(used.status).toBe(200);
    const next = cookieOf(used);
    expect(next).toBeDefined();
    expect(next).not.toBe(token);
    const old = await ctx.prisma.caePortalSession.findMany({
      where: { accessId: w.a.accessId },
      orderBy: { createdAt: "asc" },
    });
    // The old one only lasts a minute more.
    expect((old[0]?.expiresAt.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(61_000);
    const out = await request(app)
      .post(`${PORTAL}/${w.a.accessId}/logout`)
      .set("Cookie", `sf_cae_portal=${next ?? ""}`);
    expect(out.status).toBe(204);
    expect(
      (
        await request(app)
          .get(`${PORTAL}/${w.a.accessId}/overview`)
          .set("Cookie", `sf_cae_portal=${next ?? ""}`)
      ).status,
    ).toBe(401);
  });

  it("revocar, vencer, archivar la empresa o apagar la CAE terminan la sesión", async () => {
    const cases: [string, (w: World) => Promise<void>][] = [
      [
        "revocar",
        async (w) => {
          expect(
            (await api(w.ws.slug, w.manager.token).post(`/cae/companies/${w.a.id}/portal/revoke`))
              .status,
          ).toBe(204);
        },
      ],
      [
        "vencer",
        async (w) => {
          await ctx.prisma.caePortalAccess.update({
            where: { id: w.a.accessId },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
        },
      ],
      [
        "archivar",
        async (w) => {
          expect(
            (await api(w.ws.slug, w.manager.token).post(`/cae/companies/${w.a.id}/archive`)).status,
          ).toBe(200);
        },
      ],
      [
        "apagar",
        async (w) => {
          expect(
            (await api(w.ws.slug, w.ws.token).put("/admin/safety", { cae: false })).status,
          ).toBe(200);
        },
      ],
      [
        "quitar la capacidad a quien lo dio",
        async (w) => {
          const role = await ctx.prisma.role.findFirstOrThrow({
            where: { id: w.manager.membership.roleId },
          });
          await ctx.prisma.role.update({ where: { id: role.id }, data: { capabilities: [] } });
        },
      ],
    ];
    for (const [label, end] of cases) {
      const w = await world(`Portal fin ${label}`);
      const agent = await enter(w.a);
      expect((await agent.get(`${PORTAL}/${w.a.accessId}/overview`)).status, label).toBe(200);
      await end(w);
      expect((await agent.get(`${PORTAL}/${w.a.accessId}/overview`)).status, label).toBe(401);
      expect((await agent.get(`${PORTAL}/${w.a.accessId}/workers`)).status, label).toBe(401);
    }
  });
});

describe("portal: solo su empresa", () => {
  it("los trabajadores y requisitos de otra contrata o de otra empresa dan 404", async () => {
    const w = await world("Portal cruzado");
    const other = await world("Portal otra empresa");
    const agent = await enter(w.a);
    const base = `${PORTAL}/${w.a.accessId}`;
    const list = await agent.get(`${base}/workers`);
    expect(list.status).toBe(200);
    expect((list.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
      w.a.workerId,
    ]);
    for (const workerId of [w.b.workerId, other.a.workerId]) {
      expect((await agent.patch(`${base}/workers/${workerId}`).send({ task: "x" })).status).toBe(
        404,
      );
      expect((await agent.post(`${base}/workers/${workerId}/archive`)).status).toBe(404);
      expect(
        (
          await agent
            .post(`${base}/uploads`)
            .send({ requirementId: w.workerReq, workerId, name: "a.pdf", size: 100 })
        ).status,
      ).toBe(404);
    }
    // Another tenant's requirement doesn't exist here.
    expect(
      (
        await agent
          .post(`${base}/uploads`)
          .send({ requirementId: other.companyReq, name: "a.pdf", size: 100 })
      ).status,
    ).toBe(404);
    // Nothing of the other companies changed.
    const untouched = await ctx.prisma.caeWorker.findMany({
      where: { id: { in: [w.b.workerId, other.a.workerId] } },
    });
    expect(untouched.every((worker) => worker.task === null && worker.archivedAt === null)).toBe(
      true,
    );
  });

  it("la información solo sirve los documentos elegidos", async () => {
    const w = await world("Portal información");
    const agent = await enter(w.a);
    const space = await ctx.prisma.space.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId },
    });
    const node = await ctx.prisma.node.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: space.id,
        type: "PAGE",
        name: "Procedimiento interno",
        nameKey: "procedimiento interno",
        position: "a0",
        createdById: w.ws.membershipId,
        updatedById: w.ws.membershipId,
      },
    });
    expect((await agent.get(`${PORTAL}/${w.a.accessId}/info/${node.id}`)).status).toBe(404);
    expect((await agent.get(`${PORTAL}/${w.a.accessId}/info/no-existe`)).status).toBe(404);
  });
});

describe("portal: subidas", () => {
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
  const HTML = Buffer.from("<html><script>alert(1)</script></html>", "utf8");

  async function put(ticket: { url: string; contentType: string }, body: Buffer) {
    return await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": ticket.contentType },
      body,
    });
  }

  it("solo PDF, JPG o PNG: una extensión prohibida o un HTML con nombre .pdf se rechazan", async () => {
    const w = await world("Portal tipos");
    const agent = await enter(w.a);
    const base = `${PORTAL}/${w.a.accessId}`;
    for (const name of ["virus.exe", "pagina.html", "script.svg", "sin-extension"]) {
      const res = await agent
        .post(`${base}/uploads`)
        .send({ requirementId: w.companyReq, name, size: 100 });
      expect(res.status, name).toBe(400);
    }
    const started = await agent
      .post(`${base}/uploads`)
      .send({ requirementId: w.companyReq, name: "seguro.pdf", size: HTML.length });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const ticket = (started.body as { upload: { id: string; url: string; contentType: string } })
      .upload;
    expect((await put(ticket, HTML)).ok).toBe(true);
    const done = await agent.post(`${base}/uploads/${ticket.id}/complete`).send({});
    expect(done.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.prisma.caeDocument.count({ where: { companyId: w.a.id } })).toBe(0);
    // A real PDF goes through, as PENDING and attributed to the portal.
    const ok = await agent
      .post(`${base}/uploads`)
      .send({ requirementId: w.companyReq, name: "seguro.pdf", size: PDF.length });
    const good = (ok.body as { upload: { id: string; url: string; contentType: string } }).upload;
    expect((await put(good, PDF)).ok).toBe(true);
    const completed = await agent.post(`${base}/uploads/${good.id}/complete`).send({});
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    const doc = await ctx.prisma.caeDocument.findFirstOrThrow({ where: { companyId: w.a.id } });
    expect(doc.status).toBe("PENDING");
    expect(doc.portalAccessId).toBe(w.a.accessId);
  });

  it("no se completa una subida que no empezó este acceso", async () => {
    const w = await world("Portal subida ajena");
    const agentA = await enter(w.a);
    const agentB = await enter(w.b);
    const started = await agentB
      .post(`${PORTAL}/${w.b.accessId}/uploads`)
      .send({ requirementId: w.companyReq, name: "seguro.pdf", size: PDF.length });
    expect(started.status).toBe(201);
    const ticket = (started.body as { upload: { id: string; url: string; contentType: string } })
      .upload;
    expect((await put(ticket, PDF)).ok).toBe(true);
    const stolen = await agentA
      .post(`${PORTAL}/${w.a.accessId}/uploads/${ticket.id}/complete`)
      .send({});
    expect(stolen.status).toBe(400);
    // A member's own upload in the company can't be completed through the portal either.
    const space = await ctx.prisma.space.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId },
    });
    const member = await api(w.ws.slug, w.ws.token).post(`/spaces/${space.id}/uploads`, {
      name: "interno.pdf",
      size: PDF.length,
    });
    expect(member.status, JSON.stringify(member.body)).toBe(201);
    const memberTicket = (member.body as { upload: { id: string } }).upload;
    expect(
      (await agentA.post(`${PORTAL}/${w.a.accessId}/uploads/${memberTicket.id}/complete`).send({}))
        .status,
    ).toBe(400);
    expect(await ctx.prisma.caeDocument.count({ where: { companyId: w.a.id } })).toBe(0);
  });
});
