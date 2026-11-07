// CAE security (docs/spec/cae.md): with CAE or the module off nothing exists; who sees and changes what
// (cae.manage, cae.check, the internal responsible person and a plain member); another company's ids
// answer 404 on every endpoint family; a document's file must be inside the company's folder; the gate
// shows the ID masked; a denied worker can't be let in nor put on a permit.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

type Member = Awaited<ReturnType<typeof addMember>>;

interface World {
  ws: TestWorkspace;
  manager: Member;
  checker: Member;
  responsible: Member;
  plain: Member;
  companyId: string;
  workerId: string;
  companyReq: string;
  workerReq: string;
  /** A file inside the company's folder, and one outside it. */
  fileIn: string;
  fileOut: string;
}

async function roleWith(ws: TestWorkspace, name: string, capabilities: string[]) {
  return await ctx.prisma.role.create({
    data: { workspaceId: ws.workspaceId, name, base: "MEMBER", capabilities },
  });
}

/** A file node (metadata only) under `parentId` in `spaceId`. */
async function fileNode(ws: TestWorkspace, spaceId: string, parentId: string | null, name: string) {
  const node = await ctx.prisma.node.create({
    data: {
      workspaceId: ws.workspaceId,
      spaceId,
      parentId,
      type: "FILE",
      name,
      nameKey: name.toLowerCase(),
      position: `a${String(Math.random()).slice(2, 8)}`,
      createdById: ws.membershipId,
      updatedById: ws.membershipId,
      mimeType: "application/pdf",
      sizeBytes: 10n,
    },
  });
  return node.id;
}

/** A company with CAE on, its people, a contractor with a worker and one requirement of each scope. */
async function world(name: string): Promise<World> {
  const ws = await createWorkspace(ctx, name);
  const owner = api(ws.slug, ws.token);
  const on = await owner.put("/admin/safety", { enabled: true, cae: true, caeAccessLog: true });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  const manager = await addMember(ctx, ws, {
    roleId: (await roleWith(ws, "CAE gestión", ["cae.manage"])).id,
    name: "Gestora CAE",
  });
  const checker = await addMember(ctx, ws, {
    roleId: (await roleWith(ws, "Portería", ["cae.check"])).id,
    name: "Portero",
  });
  const responsible = await addMember(ctx, ws, { base: "MEMBER", name: "Responsable interno" });
  const plain = await addMember(ctx, ws, { base: "MEMBER", name: "Sin CAE" });
  const m = api(ws.slug, manager.token);
  const companyReq = await m.post("/cae/requirements", { name: "Seguro RC", scope: "COMPANY" });
  expect(companyReq.status, JSON.stringify(companyReq.body)).toBe(201);
  const workerReq = await m.post("/cae/requirements", { name: "Formación PRL", scope: "WORKER" });
  expect(workerReq.status).toBe(201);
  const company = await m.post("/cae/companies", {
    name: "Limpiezas Norte",
    kind: "CONTRACTOR",
    responsibleId: responsible.membership.id,
  });
  expect(company.status, JSON.stringify(company.body)).toBe(201);
  const companyId = (company.body as { company: { id: string } }).company.id;
  const worker = await m.post(`/cae/companies/${companyId}/workers`, {
    name: "Pedro Limpio",
    idNumber: "12345678Z",
  });
  expect(worker.status, JSON.stringify(worker.body)).toBe(201);
  const workerId = (worker.body as { worker: { id: string } }).worker.id;
  const row = await ctx.prisma.caeCompany.findFirstOrThrow({ where: { id: companyId } });
  const folderId = row.folderId ?? "";
  const folder = await ctx.prisma.node.findFirstOrThrow({ where: { id: folderId } });
  const fileIn = await fileNode(ws, folder.spaceId, folderId, "seguro.pdf");
  const fileOut = await fileNode(ws, folder.spaceId, folder.parentId, "otro.pdf");
  return {
    ws,
    manager,
    checker,
    responsible,
    plain,
    companyId,
    workerId,
    companyReq: (companyReq.body as { requirement: { id: string } }).requirement.id,
    workerReq: (workerReq.body as { requirement: { id: string } }).requirement.id,
    fileIn,
    fileOut,
  };
}

/** Every read endpoint family with this world's ids. */
const reads = (w: World) => [
  "/cae/companies",
  `/cae/companies/${w.companyId}`,
  `/cae/companies/${w.companyId}/workers`,
  `/cae/companies/${w.companyId}/portal`,
  `/cae/companies/${w.companyId}/info`,
  "/cae/workers",
  `/cae/workers/${w.workerId}`,
  "/cae/requirements",
  "/cae/documents",
  "/cae/check?q=Pedro",
  `/cae/check/${w.workerId}`,
  "/cae/access",
  "/cae/permits",
  "/cae/info",
];

describe("CAE: encendido y apagado", () => {
  it("con la CAE o el módulo apagados, todo /cae responde 404", async () => {
    const w = await world("CAE apagada");
    const owner = api(w.ws.slug, w.ws.token);
    expect((await owner.put("/admin/safety", { cae: false })).status).toBe(200);
    for (const path of reads(w)) {
      expect((await owner.get(path)).status, path).toBe(404);
    }
    const create = {
      name: "X",
      kind: "CONTRACTOR",
      responsibleId: w.responsible.membership.id,
    };
    expect((await owner.post("/cae/companies", create)).status).toBe(404);
    expect((await owner.post(`/cae/companies/${w.companyId}/folder`)).status).toBe(404);
    expect((await owner.put("/admin/safety", { cae: true })).status).toBe(200);
    expect((await owner.get("/cae/companies")).status).toBe(200);
    // The module off takes CAE with it.
    expect((await owner.put("/admin/safety", { enabled: false })).status).toBe(200);
    for (const path of reads(w)) {
      expect((await owner.get(path)).status, path).toBe(404);
    }
  });
});

describe("CAE: quién ve y cambia qué", () => {
  it("cae.manage gestiona; cae.check solo consulta; el responsable ve lo suyo; el resto nada", async () => {
    const w = await world("CAE permisos");
    const manager = api(w.ws.slug, w.manager.token);
    const checker = api(w.ws.slug, w.checker.token);
    const responsible = api(w.ws.slug, w.responsible.token);
    const plain = api(w.ws.slug, w.plain.token);
    // Lists: the manager and the gate see everything; the responsible, only their company.
    expect((await manager.get("/cae/companies")).status).toBe(200);
    expect((await checker.get("/cae/companies")).status).toBe(200);
    const mine = await responsible.get("/cae/companies");
    expect(mine.status).toBe(200);
    expect((mine.body as { items: { id: string }[] }).items.map((c) => c.id)).toEqual([
      w.companyId,
    ]);
    expect((await plain.get("/cae/companies")).status).toBe(403);
    // A company or a worker the plain member isn't responsible for: 404.
    expect((await plain.get(`/cae/companies/${w.companyId}`)).status).toBe(404);
    expect((await plain.get(`/cae/workers/${w.workerId}`)).status).toBe(404);
    // Changes: only cae.manage.
    for (const who of [checker, responsible, plain]) {
      expect((await who.post("/cae/requirements", { name: "Otro", scope: "COMPANY" })).status).toBe(
        403,
      );
      expect(
        (
          await who.post("/cae/companies", {
            name: "Nueva",
            kind: "CONTRACTOR",
            responsibleId: w.responsible.membership.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (await who.post(`/cae/companies/${w.companyId}/workers`, { name: "Otro" })).status,
      ).toBe(403);
      expect(
        (await who.post(`/cae/companies/${w.companyId}/block`, { reason: "No pasa" })).status,
      ).toBe(403);
      expect((await who.post(`/cae/companies/${w.companyId}/portal`, { days: 7 })).status).toBe(
        403,
      );
    }
    // The gate and the access log: cae.check (and manage), not the responsible nor the rest.
    expect((await checker.get(`/cae/check/${w.workerId}`)).status).toBe(200);
    expect((await responsible.get(`/cae/check/${w.workerId}`)).status).toBe(403);
    expect((await plain.get("/cae/access")).status).toBe(403);
    expect((await plain.get("/cae/permits")).status).toBe(403);
  });

  it("la portería ve el DNI enmascarado; quien gestiona o es responsable, entero", async () => {
    const w = await world("CAE DNI");
    const gate = await api(w.ws.slug, w.checker.token).get(`/cae/check/${w.workerId}`);
    expect((gate.body as { result: { idNumber: string } }).result.idNumber).toBe("•••78Z");
    const asChecker = await api(w.ws.slug, w.checker.token).get(`/cae/workers/${w.workerId}`);
    expect((asChecker.body as { worker: { idNumber: string } }).worker.idNumber).toBe("•••78Z");
    const asResponsible = await api(w.ws.slug, w.responsible.token).get(
      `/cae/workers/${w.workerId}`,
    );
    expect((asResponsible.body as { worker: { idNumber: string } }).worker.idNumber).toBe(
      "12345678Z",
    );
    const asManager = await api(w.ws.slug, w.manager.token).get(`/cae/workers/${w.workerId}`);
    expect((asManager.body as { worker: { idNumber: string } }).worker.idNumber).toBe("12345678Z");
  });
});

describe("CAE: documentos, portería y permisos", () => {
  it("el archivo de un documento tiene que estar en la carpeta de la empresa", async () => {
    const w = await world("CAE carpeta");
    const m = api(w.ws.slug, w.manager.token);
    const outside = await m.post("/cae/documents", {
      requirementId: w.companyReq,
      companyId: w.companyId,
      nodeId: w.fileOut,
    });
    expect(outside.status).toBe(400);
    const inside = await m.post("/cae/documents", {
      requirementId: w.companyReq,
      companyId: w.companyId,
      nodeId: w.fileIn,
    });
    expect(inside.status, JSON.stringify(inside.body)).toBe(201);
    // A worker requirement needs the worker; a company one can't take one.
    expect(
      (
        await m.post("/cae/documents", {
          requirementId: w.workerReq,
          companyId: w.companyId,
          nodeId: w.fileIn,
        })
      ).status,
    ).toBe(400);
  });

  it("un trabajador no autorizado no entra ni va en un permiso; autorizado, sí", async () => {
    const w = await world("CAE denegado");
    const gate = api(w.ws.slug, w.checker.token);
    const m = api(w.ws.slug, w.manager.token);
    const check = await gate.get(`/cae/check/${w.workerId}`);
    expect((check.body as { result: { authorized: boolean } }).result.authorized).toBe(false);
    expect((await gate.post("/cae/access", { workerId: w.workerId, direction: "IN" })).status).toBe(
      409,
    );
    // An exit always records.
    expect(
      (await gate.post("/cae/access", { workerId: w.workerId, direction: "OUT" })).status,
    ).toBe(201);
    const from = new Date(Date.now() + 3600_000).toISOString();
    const to = new Date(Date.now() + 5 * 3600_000).toISOString();
    const permit = {
      type: "HOT_WORK",
      companyId: w.companyId,
      location: "Sala de máquinas",
      validFrom: from,
      validTo: to,
      workerIds: [w.workerId],
    };
    expect((await m.post("/cae/permits", permit)).status).toBe(409);
    // With every required document accepted, the worker is authorized (the default catalog's
    // requirements stop being required, so only this test's two count).
    await ctx.prisma.caeRequirement.updateMany({
      where: { workspaceId: w.ws.workspaceId, id: { notIn: [w.companyReq, w.workerReq] } },
      data: { required: false },
    });
    const workerFolder = await m.post(`/cae/workers/${w.workerId}/folder`);
    expect(workerFolder.status, JSON.stringify(workerFolder.body)).toBe(200);
    const folderRow = await ctx.prisma.caeWorker.findFirstOrThrow({ where: { id: w.workerId } });
    const folder = await ctx.prisma.node.findFirstOrThrow({
      where: { id: folderRow.folderId ?? "" },
    });
    const workerFile = await fileNode(w.ws, folder.spaceId, folder.id, "prl.pdf");
    for (const doc of [
      { requirementId: w.companyReq, nodeId: w.fileIn },
      { requirementId: w.workerReq, nodeId: workerFile, workerId: w.workerId },
    ]) {
      const given = await m.post("/cae/documents", {
        ...doc,
        companyId: w.companyId,
        accept: true,
      });
      expect(given.status, JSON.stringify(given.body)).toBe(201);
    }
    const again = await gate.get(`/cae/check/${w.workerId}`);
    expect(
      (again.body as { result: { authorized: boolean } }).result.authorized,
      JSON.stringify(again.body),
    ).toBe(true);
    expect((await gate.post("/cae/access", { workerId: w.workerId, direction: "IN" })).status).toBe(
      201,
    );
    expect((await m.post("/cae/permits", permit)).status).toBe(201);
  });
});

describe("CAE: aislamiento entre empresas", () => {
  it("los ids de otra empresa responden 404 en cada familia de endpoints", async () => {
    const a = await world("CAE tenant A");
    const b = await world("CAE tenant B");
    const other = api(b.ws.slug, b.ws.token);
    const foreign = reads(a).filter(
      (path) => path.includes(a.companyId) || path.includes(a.workerId),
    );
    for (const path of foreign) {
      expect((await other.get(path)).status, path).toBe(404);
    }
    const writes: [string, object][] = [
      [`/cae/companies/${a.companyId}/workers`, { name: "Intruso" }],
      [`/cae/companies/${a.companyId}/block`, { reason: "Intruso" }],
      [`/cae/companies/${a.companyId}/archive`, {}],
      [`/cae/companies/${a.companyId}/portal`, { days: 7 }],
      [`/cae/companies/${a.companyId}/portal/revoke`, {}],
      [`/cae/companies/${a.companyId}/info/deliveries`, { receivedBy: "Intruso" }],
      [`/cae/workers/${a.workerId}/block`, { reason: "Intruso" }],
      [`/cae/companies/${a.companyId}/folder`, {}],
      [`/cae/workers/${a.workerId}/folder`, {}],
      ["/cae/access", { workerId: a.workerId, direction: "OUT" }],
      ["/cae/documents", { requirementId: b.companyReq, companyId: a.companyId, nodeId: a.fileIn }],
      ["/cae/documents", { requirementId: a.companyReq, companyId: b.companyId, nodeId: b.fileIn }],
      [`/cae/requirements/${a.companyReq}/archive`, {}],
    ];
    for (const [path, body] of writes) {
      expect((await other.post(path, body)).status, path).toBe(404);
    }
    expect(
      (await other.patch(`/cae/companies/${a.companyId}`, { activity: "Intruso" })).status,
    ).toBe(404);
    expect((await other.patch(`/cae/workers/${a.workerId}`, { task: "Intruso" })).status).toBe(404);
    expect(
      (await other.patch(`/cae/requirements/${a.companyReq}`, { name: "Intruso" })).status,
    ).toBe(404);
    // A's slug with B's session: not a member there.
    expect((await api(a.ws.slug, b.ws.token).get("/cae/companies")).status).toBe(404);
    // Nothing of A changed.
    const company = await ctx.prisma.caeCompany.findFirstOrThrow({ where: { id: a.companyId } });
    expect(company.blockedAt).toBeNull();
    expect(company.archivedAt).toBeNull();
    expect(await ctx.prisma.caePortalAccess.count({ where: { companyId: a.companyId } })).toBe(0);
  });
});
