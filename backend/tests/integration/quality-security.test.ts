// Food quality security (docs/spec/calidad.md, «Permisos»): with the module off nothing exists; only the
// owner turns it on; who sees and changes what (quality.manage, quality.view, a nonconformity's owner, an
// action's responsible, the heads of its department, a plain member, a guest); the life cycle can't be
// skipped; another company's ids answer 404; a record opens its nonconformity only for whoever may.
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

interface NcBody {
  nc: {
    id: string;
    code: string;
    status: string;
    access: string;
    actionItems: { id: string; canEdit: boolean; canComplete: boolean }[];
  };
}

interface World {
  ws: TestWorkspace;
  manager: Member;
  viewer: Member;
  owner: Member;
  responsible: Member;
  head: Member;
  plain: Member;
  guest: Member;
  departmentId: string;
  spaceId: string;
}

async function roleWith(ws: TestWorkspace, name: string, capabilities: string[]) {
  return await ctx.prisma.role.create({
    data: { workspaceId: ws.workspaceId, name, base: "MEMBER", capabilities },
  });
}

/** A company with the module on, its people and a department with its head. */
async function world(name: string): Promise<World> {
  const ws = await createWorkspace(ctx, name);
  const on = await api(ws.slug, ws.token).put("/admin/quality", { enabled: true });
  expect(on.status).toBe(200);
  const spaceId = (on.body as { quality: { space: { id: string } } }).quality.space.id;
  const managerRole = await roleWith(ws, "Calidad", ["quality.manage"]);
  const viewerRole = await roleWith(ws, "Dirección", ["quality.view"]);
  const manager = await addMember(ctx, ws, { roleId: managerRole.id, name: "Marta Calidad" });
  const viewer = await addMember(ctx, ws, { roleId: viewerRole.id, name: "Diego Dirección" });
  const owner = await addMember(ctx, ws, { name: "Oscar Responsable" });
  const responsible = await addMember(ctx, ws, { name: "Rita Acción" });
  const head = await addMember(ctx, ws, { name: "Hugo Jefe" });
  const plain = await addMember(ctx, ws, { name: "Pablo Planta" });
  const guest = await addMember(ctx, ws, { base: "GUEST", name: "Gina Invitada" });
  const department = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Producción" },
  });
  await ctx.prisma.departmentMember.create({
    data: {
      workspaceId: ws.workspaceId,
      departmentId: department.id,
      membershipId: head.membership.id,
      position: "HEAD",
    },
  });
  return {
    ws,
    manager,
    viewer,
    owner,
    responsible,
    head,
    plain,
    guest,
    departmentId: department.id,
    spaceId,
  };
}

const ncInput = (ownerId: string, departmentId: string | null = null) => ({
  title: "Temperatura fuera de límite",
  description: "La cámara 2 marcó 7 °C.",
  detectedOn: "2026-11-01",
  origin: "INTERNAL",
  severity: "MAJOR",
  ownerId,
  departmentId,
});

async function createNc(w: World, departmentId: string | null = null): Promise<NcBody["nc"]> {
  const res = await api(w.ws.slug, w.manager.token).post(
    "/quality/ncs",
    ncInput(w.owner.membership.id, departmentId),
  );
  expect(res.status).toBe(201);
  return (res.body as NcBody).nc;
}

async function addAction(w: World, ncId: string, token: string, responsibleId: string) {
  return await api(w.ws.slug, token).post(`/quality/ncs/${ncId}/actions`, {
    kind: "CORRECTIVE",
    description: "Calibrar el termostato",
    responsibleId,
    dueOn: "2026-12-01",
  });
}

let w: World;

beforeAll(async () => {
  w = await world("Calidad seguridad");
});

describe("calidad: módulo y ajustes", () => {
  it("con el módulo apagado, todo /quality responde 404, también al propietario", async () => {
    const off = await createWorkspace(ctx, "Calidad apagada");
    const owner = api(off.slug, off.token);
    for (const path of ["/quality/summary", "/quality/ncs", "/quality/actions", "/quality/ncs/x"]) {
      expect((await owner.get(path)).status).toBe(404);
    }
    expect(
      (
        await owner.post("/quality/ncs/report", {
          title: "x",
          description: "x",
          detectedOn: "2026-11-01",
        })
      ).status,
    ).toBe(404);
  });

  it("solo el propietario lo activa: un administrador no", async () => {
    const other = await createWorkspace(ctx, "Calidad admin");
    const admin = await addMember(ctx, other, { base: "ADMIN" });
    expect(
      (await api(other.slug, admin.token).put("/admin/quality", { enabled: true })).status,
    ).toBe(403);
    expect((await api(other.slug, admin.token).get("/admin/quality")).status).toBe(403);
  });

  it("al activarlo crea el espacio del área Calidad", async () => {
    const space = await ctx.prisma.space.findFirstOrThrow({ where: { id: w.spaceId } });
    expect(space.area).toBe("QUALITY");
    expect(space.workspaceId).toBe(w.ws.workspaceId);
  });

  it("los días de verificación se validan en el servidor", async () => {
    const owner = api(w.ws.slug, w.ws.token);
    expect((await owner.put("/admin/quality", { verifyDays: 0 })).status).toBe(400);
    expect((await owner.put("/admin/quality", { verifyDays: 366 })).status).toBe(400);
  });
});

describe("calidad: quién ve y cambia qué", () => {
  it("un miembro sin relación no ve la no conformidad: 404, y no aparece en su lista", async () => {
    const nc = await createNc(w);
    const plain = api(w.ws.slug, w.plain.token);
    expect((await plain.get(`/quality/ncs/${nc.id}`)).status).toBe(404);
    expect((await plain.patch(`/quality/ncs/${nc.id}`, { title: "x" })).status).toBe(404);
    expect((await plain.get(`/quality/ncs/${nc.id}/events`)).status).toBe(404);
    const list = (await plain.get("/quality/ncs?status=all")).body as { items: { id: string }[] };
    expect(list.items.map((item) => item.id)).not.toContain(nc.id);
    expect((await plain.get("/quality/ncs/export")).status).toBe(403);
    expect((await plain.post("/quality/ncs", ncInput(w.plain.membership.id))).status).toBe(403);
  });

  it("quality.view lee todo y exporta, pero no cambia nada", async () => {
    const nc = await createNc(w);
    const viewer = api(w.ws.slug, w.viewer.token);
    const res = await viewer.get(`/quality/ncs/${nc.id}`);
    expect(res.status).toBe(200);
    expect((res.body as NcBody).nc.access).toBe("read");
    expect((await viewer.get("/quality/ncs/export")).status).toBe(200);
    expect((await viewer.patch(`/quality/ncs/${nc.id}`, { title: "x" })).status).toBe(403);
    expect((await addAction(w, nc.id, w.viewer.token, w.viewer.membership.id)).status).toBe(403);
    expect((await viewer.post(`/quality/ncs/${nc.id}/cancel`, { reason: "x" })).status).toBe(403);
  });

  it("su responsable la gestiona, pero no la reasigna, no la anula ni la cierra", async () => {
    const nc = await createNc(w);
    const owner = api(w.ws.slug, w.owner.token);
    expect(((await owner.get(`/quality/ncs/${nc.id}`)).body as NcBody).nc.access).toBe("edit");
    const analysed = await owner.patch(`/quality/ncs/${nc.id}`, {
      causeMethod: "FIVE_WHYS",
      causeAnalysis: { whys: ["El termostato falló."] },
      rootCause: "Sin mantenimiento.",
    });
    expect(analysed.status).toBe(200);
    expect((analysed.body as NcBody).nc.status).toBe("ANALYSIS");
    expect(
      (await owner.patch(`/quality/ncs/${nc.id}`, { ownerId: w.plain.membership.id })).status,
    ).toBe(403);
    expect((await owner.post(`/quality/ncs/${nc.id}/cancel`, { reason: "x" })).status).toBe(403);
    const action = await addAction(w, nc.id, w.owner.token, w.owner.membership.id);
    expect(action.status).toBe(201);
    const actionId = (action.body as NcBody).nc.actionItems[0]?.id ?? "";
    expect((await owner.post(`/quality/actions/${actionId}/done`, {})).status).toBe(200);
    const verifying = (await owner.get(`/quality/ncs/${nc.id}`)).body as NcBody;
    expect(verifying.nc.status).toBe("VERIFICATION");
    // Closing is quality.manage's.
    expect(
      (await owner.post(`/quality/ncs/${nc.id}/verifications`, { effective: true, note: "Bien" }))
        .status,
    ).toBe(403);
  });

  it("el responsable de una acción ve la NC y marca su acción, sin editarla", async () => {
    const nc = await createNc(w);
    const created = await addAction(w, nc.id, w.manager.token, w.responsible.membership.id);
    const actionId = (created.body as NcBody).nc.actionItems[0]?.id ?? "";
    const responsible = api(w.ws.slug, w.responsible.token);
    const seen = await responsible.get(`/quality/ncs/${nc.id}`);
    expect(seen.status).toBe(200);
    expect((seen.body as NcBody).nc.access).toBe("read");
    expect(
      (await responsible.patch(`/quality/actions/${actionId}`, { description: "Otra" })).status,
    ).toBe(403);
    const mine = (await responsible.get("/quality/actions?mine=1")).body as {
      items: { id: string }[];
    };
    expect(mine.items.map((item) => item.id)).toContain(actionId);
    expect((await responsible.post(`/quality/actions/${actionId}/done`, {})).status).toBe(200);
    // Somebody else's action: 404 (they don't see its NC).
    const other = await createNc(w);
    const foreign = await addAction(w, other.id, w.manager.token, w.manager.membership.id);
    const foreignId = (foreign.body as NcBody).nc.actionItems[0]?.id ?? "";
    expect((await responsible.post(`/quality/actions/${foreignId}/done`, {})).status).toBe(404);
  });

  it("los jefes leen las de su departamento y no las de otros", async () => {
    const theirs = await createNc(w, w.departmentId);
    const others = await createNc(w);
    const head = api(w.ws.slug, w.head.token);
    expect((await head.get(`/quality/ncs/${theirs.id}`)).status).toBe(200);
    expect((await head.get(`/quality/ncs/${others.id}`)).status).toBe(404);
    expect((await head.patch(`/quality/ncs/${theirs.id}`, { title: "x" })).status).toBe(403);
  });

  it("cualquiera comunica una (y la ve después); un invitado no", async () => {
    const plain = api(w.ws.slug, w.plain.token);
    const reported = await plain.post("/quality/ncs/report", {
      title: "Film en la mesa",
      description: "Restos de film azul.",
      detectedOn: "2026-11-02",
    });
    expect(reported.status).toBe(201);
    const nc = (reported.body as NcBody).nc;
    expect(nc.access).toBe("read");
    expect((await plain.get(`/quality/ncs/${nc.id}`)).status).toBe(200);
    const mine = (await plain.get("/quality/ncs?mine=reported")).body as {
      items: { id: string }[];
    };
    expect(mine.items.map((item) => item.id)).toContain(nc.id);
    const guest = api(w.ws.slug, w.guest.token);
    expect(
      (
        await guest.post("/quality/ncs/report", {
          title: "x",
          description: "x",
          detectedOn: "2026-11-02",
        })
      ).status,
    ).toBe(403);
  });
});

describe("calidad: ciclo de vida", () => {
  it("no se verifica sin acciones hechas; no eficaz vuelve a acciones; eficaz cierra", async () => {
    const nc = await createNc(w);
    const manager = api(w.ws.slug, w.manager.token);
    expect(
      (await manager.post(`/quality/ncs/${nc.id}/verifications`, { effective: true, note: "x" }))
        .status,
    ).toBe(409);
    const created = await addAction(w, nc.id, w.manager.token, w.manager.membership.id);
    const first = (created.body as NcBody).nc.actionItems[0]?.id ?? "";
    expect((created.body as NcBody).nc.status).toBe("ACTIONS");
    await manager.post(`/quality/actions/${first}/done`, {});
    const failed = await manager.post(`/quality/ncs/${nc.id}/verifications`, {
      effective: false,
      note: "Volvió a pasar",
    });
    expect((failed.body as NcBody).nc.status).toBe("ACTIONS");
    const second = await addAction(w, nc.id, w.manager.token, w.manager.membership.id);
    const secondId = (second.body as NcBody).nc.actionItems.find((a) => a.id !== first)?.id ?? "";
    await manager.post(`/quality/actions/${secondId}/done`, {});
    const closed = await manager.post(`/quality/ncs/${nc.id}/verifications`, {
      effective: true,
      note: "30 días sin desvíos",
    });
    expect((closed.body as NcBody).nc.status).toBe("CLOSED");
    // Closed: nothing changes until it's reopened.
    expect((await manager.patch(`/quality/ncs/${nc.id}`, { title: "x" })).status).toBe(409);
    expect((await addAction(w, nc.id, w.manager.token, w.manager.membership.id)).status).toBe(409);
    const reopened = await manager.post(`/quality/ncs/${nc.id}/reopen`, { reason: "Repite" });
    expect((reopened.body as NcBody).nc.status).toBe("ACTIONS");
  });

  it("un análisis con la forma de otro método es 400", async () => {
    const nc = await createNc(w);
    const res = await api(w.ws.slug, w.manager.token).patch(`/quality/ncs/${nc.id}`, {
      causeMethod: "FIVE_WHYS",
      causeAnalysis: { branches: { people: "x" } },
    });
    expect(res.status).toBe(400);
  });

  it("anulada no se reabre ni cambia; los códigos son correlativos", async () => {
    const a = await createNc(w);
    const b = await createNc(w);
    const number = (code: string) => Number(code.split("-").at(-1));
    expect(number(b.code)).toBe(number(a.code) + 1);
    const manager = api(w.ws.slug, w.manager.token);
    expect(
      (await manager.post(`/quality/ncs/${a.id}/cancel`, { reason: "Duplicada" })).status,
    ).toBe(200);
    expect((await manager.post(`/quality/ncs/${a.id}/reopen`, { reason: "x" })).status).toBe(409);
    expect((await manager.patch(`/quality/ncs/${a.id}`, { title: "x" })).status).toBe(409);
  });
});

describe("calidad: otra empresa", () => {
  it("los ids de otra empresa responden 404 en cada familia", async () => {
    const nc = await createNc(w);
    const created = await addAction(w, nc.id, w.manager.token, w.manager.membership.id);
    const actionId = (created.body as NcBody).nc.actionItems[0]?.id ?? "";
    const other = await world("Calidad ajena");
    const foreign = api(other.ws.slug, other.ws.token);
    expect((await foreign.get(`/quality/ncs/${nc.id}`)).status).toBe(404);
    expect((await foreign.patch(`/quality/ncs/${nc.id}`, { title: "x" })).status).toBe(404);
    expect((await foreign.get(`/quality/ncs/${nc.id}/events`)).status).toBe(404);
    expect((await foreign.post(`/quality/ncs/${nc.id}/folder`)).status).toBe(404);
    expect((await foreign.post(`/quality/actions/${actionId}/done`, {})).status).toBe(404);
    expect((await foreign.patch(`/quality/actions/${actionId}`, { description: "x" })).status).toBe(
      404,
    );
    // Nor can a person of the other company be made owner or responsible here.
    const manager = api(w.ws.slug, w.manager.token);
    expect((await manager.post("/quality/ncs", ncInput(other.manager.membership.id))).status).toBe(
      404,
    );
    expect((await addAction(w, nc.id, w.manager.token, other.manager.membership.id)).status).toBe(
      404,
    );
    expect(
      (await manager.post("/quality/ncs", ncInput(w.owner.membership.id, other.departmentId)))
        .status,
    ).toBe(404);
  });
});

describe("calidad: desde un registro de formulario", () => {
  async function formWithRecord(value: number) {
    const owner = api(w.ws.slug, w.ws.token);
    const form = await owner.post(`/spaces/${w.spaceId}/forms`, {
      name: `Cámaras ${String(value)}`,
    });
    const formId = (form.body as { form: { node: { id: string } } }).form.node.id;
    await owner.put(`/forms/${formId}/template`, {
      baseVersion: 1,
      fields: [
        { id: "temp", type: "number", label: "Temperatura", required: true, min: 0, max: 4 },
      ],
    });
    const version = (
      (await owner.get(`/forms/${formId}`)).body as { form: { template: { version: number } } }
    ).form.template.version;
    return {
      formId,
      version,
      submit: (v: number) =>
        owner.post(`/forms/${formId}/records`, { version, answers: { temp: v }, source: "app" }),
    };
  }

  it("a mano: quality.manage sí; un miembro que no está a cargo del formulario, 404", async () => {
    const form = await formWithRecord(7);
    const record = await form.submit(7);
    const recordId = (record.body as { record: { id: string } }).record.id;
    expect(
      (await api(w.ws.slug, w.plain.token).post("/quality/ncs/from-record", { recordId })).status,
    ).toBe(404);
    const opened = await api(w.ws.slug, w.manager.token).post("/quality/ncs/from-record", {
      recordId,
    });
    expect(opened.status).toBe(201);
    // The same record keeps one open NC.
    const again = await api(w.ws.slug, w.manager.token).post("/quality/ncs/from-record", {
      recordId,
    });
    expect((again.body as NcBody).nc.id).toBe((opened.body as NcBody).nc.id);
    // A conforming record doesn't open one.
    const fine = await form.submit(2);
    const fineId = (fine.body as { record: { id: string } }).record.id;
    expect(
      (await api(w.ws.slug, w.manager.token).post("/quality/ncs/from-record", { recordId: fineId }))
        .status,
    ).toBe(400);
  });

  it("sola: con el ajuste del formulario, un registro fuera de límite abre su NC", async () => {
    const form = await formWithRecord(9);
    expect(
      (
        await api(w.ws.slug, w.plain.token).put(`/quality/forms/${form.formId}`, {
          autoNc: true,
          severity: "CRITICAL",
          ownerId: null,
        })
      ).status,
    ).toBe(403);
    const saved = await api(w.ws.slug, w.ws.token).put(`/quality/forms/${form.formId}`, {
      autoNc: true,
      severity: "CRITICAL",
      ownerId: w.owner.membership.id,
    });
    expect(saved.status).toBe(200);
    const record = await form.submit(9);
    const recordId = (record.body as { record: { id: string } }).record.id;
    const nc = await ctx.prisma.qualityNc.findFirstOrThrow({ where: { recordId } });
    expect(nc).toMatchObject({
      workspaceId: w.ws.workspaceId,
      origin: "CCP",
      severity: "CRITICAL",
      ownerId: w.owner.membership.id,
      status: "OPEN",
      fieldIds: ["temp"],
    });
  });
});

// ─── Phase 2: HACCP and product on hold ─────────────────────────────────────────────────

const ccpInput = (code: string, extra: object = {}) => ({
  code,
  name: "Cocción",
  step: "Cocción",
  hazard: "Supervivencia de patógenos.",
  hazardType: "BIOLOGICAL",
  criticalLimit: "≥ 72 °C en el centro",
  frequency: "Cada lote",
  correctiveAction: "Prolongar la cocción.",
  verification: "Calibración mensual.",
  ...extra,
});

/** A PNG-looking signature (the app checks the header and a minimum size). */
const signature = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(300, 7),
]).toString("base64")}`;

interface HoldBody {
  hold: { id: string; status: string; canDecide: boolean };
}

describe("calidad fase 2: plan APPCC", () => {
  it("la plantilla cárnica es del propietario, carga 6 formularios y 6 PCC, y una sola vez", async () => {
    const t = await world("Calidad plantilla");
    expect((await api(t.ws.slug, t.manager.token).post("/admin/quality/template")).status).toBe(
      403,
    );
    const loaded = await api(t.ws.slug, t.ws.token).post("/admin/quality/template");
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual({ forms: 6, ccps: 6 });
    expect((await api(t.ws.slug, t.ws.token).post("/admin/quality/template")).status).toBe(409);
    const plan = (await api(t.ws.slug, t.viewer.token).get("/quality/haccp")).body as {
      ccps: { code: string; form: { id: string } | null }[];
    };
    expect(plan.ccps.map((ccp) => ccp.code)).toEqual([
      "PCC-1",
      "PCC-2",
      "PCC-3",
      "PCC-4",
      "PCC-5",
      "PCC-6",
    ]);
    expect(plan.ccps.every((ccp) => ccp.form !== null)).toBe(true);
    const type = await ctx.prisma.documentType.findFirst({
      where: { workspaceId: t.ws.workspaceId, code: "APPCC" },
    });
    expect(type?.reviewMonths).toBe(12);
  });

  it("el cuadro: quality.view lee; solo quality.manage cambia; un miembro, 403", async () => {
    expect((await api(w.ws.slug, w.plain.token).get("/quality/haccp")).status).toBe(403);
    expect((await api(w.ws.slug, w.viewer.token).get("/quality/haccp")).status).toBe(200);
    expect(
      (await api(w.ws.slug, w.viewer.token).post("/quality/ccps", ccpInput("PCC-V"))).status,
    ).toBe(403);
    expect((await api(w.ws.slug, w.plain.token).get("/quality/ccps/form-options")).status).toBe(
      403,
    );
    const created = await api(w.ws.slug, w.manager.token).post("/quality/ccps", ccpInput("PCC-M"));
    expect(created.status).toBe(201);
    // Codes are unique without caring about case.
    expect(
      (await api(w.ws.slug, w.manager.token).post("/quality/ccps", ccpInput("pcc-m"))).status,
    ).toBe(409);
    // The order has to name every active CCP.
    expect(
      (await api(w.ws.slug, w.manager.token).put("/quality/ccps/order", { ids: ["x"] })).status,
    ).toBe(400);
  });

  it("otra empresa: su formulario o su gente no entran en un PCC; sus PCC son 404", async () => {
    const other = await world("Calidad APPCC ajena");
    const foreignForm = await ctx.prisma.node.create({
      data: {
        workspaceId: other.ws.workspaceId,
        spaceId: other.spaceId,
        type: "FORM",
        name: "Cámaras ajenas",
        nameKey: "cámaras ajenas",
        position: "a0",
        createdById: other.ws.membershipId,
        updatedById: other.ws.membershipId,
      },
    });
    const manager = api(w.ws.slug, w.manager.token);
    expect(
      (await manager.post("/quality/ccps", ccpInput("PCC-X1", { formId: foreignForm.id }))).status,
    ).toBe(400);
    expect(
      (
        await manager.post(
          "/quality/ccps",
          ccpInput("PCC-X2", { responsibleId: other.manager.membership.id }),
        )
      ).status,
    ).toBe(404);
    const theirs = await api(other.ws.slug, other.manager.token).post(
      "/quality/ccps",
      ccpInput("PCC-A"),
    );
    const theirId = (theirs.body as { ccp: { id: string } }).ccp.id;
    expect((await manager.patch(`/quality/ccps/${theirId}`, { name: "x" })).status).toBe(404);
    expect(
      (await manager.post(`/quality/ccps/${theirId}/archive`, { archived: true })).status,
    ).toBe(404);
  });
});

describe("calidad fase 2: producto retenido", () => {
  it("lo retiene quien gestiona la NC; decide solo quality.manage, una vez y con firma", async () => {
    const nc = await createNc(w);
    const hold = await api(w.ws.slug, w.owner.token).post("/quality/holds", {
      ncId: nc.id,
      product: "Jamón cocido",
      lot: "24-316",
      reason: "Detector sin verificar.",
    });
    expect(hold.status).toBe(201);
    const id = (hold.body as HoldBody).hold.id;
    expect((hold.body as HoldBody).hold.canDecide).toBe(false);
    // Whoever only reads the NC can't put product on hold.
    expect(
      (
        await api(w.ws.slug, w.viewer.token).post("/quality/holds", {
          ncId: nc.id,
          product: "x",
          reason: "x",
        })
      ).status,
    ).toBe(403);
    // Alone (without an NC) it's quality.manage's.
    expect(
      (await api(w.ws.slug, w.owner.token).post("/quality/holds", { product: "x", reason: "x" }))
        .status,
    ).toBe(403);
    const decision = { status: "RELEASED", note: "Reinspeccionado.", signature };
    expect(
      (await api(w.ws.slug, w.owner.token).post(`/quality/holds/${id}/decision`, decision)).status,
    ).toBe(403);
    expect(
      (
        await api(w.ws.slug, w.manager.token).post(`/quality/holds/${id}/decision`, {
          ...decision,
          signature: "data:image/png;base64,AAAA",
        })
      ).status,
    ).toBe(400);
    const decided = await api(w.ws.slug, w.manager.token).post(
      `/quality/holds/${id}/decision`,
      decision,
    );
    expect((decided.body as HoldBody).hold.status).toBe("RELEASED");
    expect(
      (
        await api(w.ws.slug, w.manager.token).post(`/quality/holds/${id}/decision`, {
          ...decision,
          status: "DESTROYED",
        })
      ).status,
    ).toBe(409);
    const stored = await ctx.prisma.qualityHold.findFirstOrThrow({ where: { id } });
    expect(stored.status).toBe("RELEASED");
    expect(stored.signature?.length).toBeGreaterThan(100);
  });

  it("se ve con su NC; un miembro sin relación, 404; la lista es de quality.view", async () => {
    const nc = await createNc(w);
    const created = await api(w.ws.slug, w.manager.token).post("/quality/holds", {
      ncId: nc.id,
      product: "Chorizo",
      reason: "Etiqueta sin alérgeno.",
    });
    const id = (created.body as HoldBody).hold.id;
    expect((await api(w.ws.slug, w.owner.token).get(`/quality/holds/${id}`)).status).toBe(200);
    expect((await api(w.ws.slug, w.plain.token).get(`/quality/holds/${id}`)).status).toBe(404);
    expect((await api(w.ws.slug, w.plain.token).get("/quality/holds")).status).toBe(403);
    expect((await api(w.ws.slug, w.viewer.token).get("/quality/holds?status=all")).status).toBe(
      200,
    );
  });

  it("otra empresa: su NC no recibe retenido; su retenido es 404", async () => {
    const other = await world("Calidad retenido ajeno");
    const theirNc = await createNc(other);
    expect(
      (
        await api(w.ws.slug, w.manager.token).post("/quality/holds", {
          ncId: theirNc.id,
          product: "x",
          reason: "x",
        })
      ).status,
    ).toBe(404);
    const theirs = await api(other.ws.slug, other.manager.token).post("/quality/holds", {
      product: "Ajeno",
      reason: "Ajeno",
    });
    const theirId = (theirs.body as HoldBody).hold.id;
    const manager = api(w.ws.slug, w.manager.token);
    expect((await manager.get(`/quality/holds/${theirId}`)).status).toBe(404);
    expect(
      (
        await manager.post(`/quality/holds/${theirId}/decision`, {
          status: "RELEASED",
          note: "x",
          signature,
        })
      ).status,
    ).toBe(404);
  });
});
