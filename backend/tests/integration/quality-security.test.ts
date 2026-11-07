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

// ─── Phase 3: audits ────────────────────────────────────────────────────────────────────

interface AuditBody {
  audit: {
    id: string;
    status: string;
    access: string;
    findingItems: { id: string; nc: { id: string } | null }[];
  };
}

const auditInput = (extra: object = {}) => ({
  scheme: "INTERNAL",
  title: "Auditoría interna · APPCC",
  plannedOn: "2026-10-20",
  ...extra,
});

describe("calidad fase 3: auditorías", () => {
  it("quality.view lee; un miembro no ve ni la cobertura; solo quality.manage la planifica", async () => {
    const created = await api(w.ws.slug, w.manager.token).post("/quality/audits", auditInput());
    expect(created.status).toBe(201);
    const id = (created.body as AuditBody).audit.id;
    expect((await api(w.ws.slug, w.viewer.token).get(`/quality/audits/${id}`)).status).toBe(200);
    expect(
      (await api(w.ws.slug, w.viewer.token).post("/quality/audits", auditInput())).status,
    ).toBe(403);
    const plain = api(w.ws.slug, w.plain.token);
    expect((await plain.get(`/quality/audits/${id}`)).status).toBe(404);
    expect(
      ((await plain.get("/quality/audits?year=2026")).body as { items: unknown[] }).items,
    ).toEqual([]);
    expect((await plain.get("/quality/audits/coverage?year=2026")).status).toBe(403);
    expect(
      (
        await plain.post(`/quality/audits/${id}/findings`, {
          clause: "1",
          description: "x",
          severity: "MINOR",
        })
      ).status,
    ).toBe(404);
  });

  it("quien la lleva registra hallazgos con su NC y la cierra; no la edita ni la anula", async () => {
    const created = await api(w.ws.slug, w.manager.token).post(
      "/quality/audits",
      auditInput({ leadId: w.plain.membership.id }),
    );
    const id = (created.body as AuditBody).audit.id;
    const lead = api(w.ws.slug, w.plain.token);
    const seen = await lead.get(`/quality/audits/${id}`);
    expect((seen.body as AuditBody).audit.access).toBe("lead");
    const finding = await lead.post(`/quality/audits/${id}/findings`, {
      clause: "4.12.1",
      description: "Falta la verificación del detector.",
      severity: "MAJOR",
    });
    expect(finding.status).toBe(201);
    const ncId = (finding.body as AuditBody).audit.findingItems[0]?.nc?.id ?? "";
    const nc = await ctx.prisma.qualityNc.findFirstOrThrow({ where: { id: ncId } });
    expect(nc).toMatchObject({
      origin: "AUDIT_INTERNAL",
      severity: "MAJOR",
      ownerId: w.plain.membership.id,
      workspaceId: w.ws.workspaceId,
    });
    expect((await lead.patch(`/quality/audits/${id}`, { title: "x" })).status).toBe(403);
    expect((await lead.post(`/quality/audits/${id}/cancel`, { reason: "x" })).status).toBe(403);
    const closed = await lead.post(`/quality/audits/${id}/done`, { doneOn: "2026-10-21" });
    expect((closed.body as AuditBody).audit.status).toBe("DONE");
    // Done: nothing is edited any more.
    expect(
      (await api(w.ws.slug, w.manager.token).patch(`/quality/audits/${id}`, { title: "x" })).status,
    ).toBe(409);
  });

  it("un hallazgo abre su NC una sola vez; una anulada no recibe hallazgos", async () => {
    const manager = api(w.ws.slug, w.manager.token);
    const created = await manager.post("/quality/audits", auditInput({ scheme: "IFS8" }));
    const id = (created.body as AuditBody).audit.id;
    const finding = await manager.post(`/quality/audits/${id}/findings`, {
      clause: "5.4.2",
      description: "Tendencias sin revisar.",
      severity: "MINOR",
      openNc: false,
    });
    const findingId = (finding.body as AuditBody).audit.findingItems[0]?.id ?? "";
    const opened = await manager.post(`/quality/findings/${findingId}/nc`, {});
    expect(opened.status).toBe(200);
    const ncId = (opened.body as AuditBody).audit.findingItems[0]?.nc?.id ?? "";
    expect((await ctx.prisma.qualityNc.findFirstOrThrow({ where: { id: ncId } })).origin).toBe(
      "AUDIT_EXTERNAL",
    );
    expect((await manager.post(`/quality/findings/${findingId}/nc`, {})).status).toBe(409);
    expect(
      (await manager.post(`/quality/audits/${id}/cancel`, { reason: "Repetida" })).status,
    ).toBe(200);
    expect(
      (
        await manager.post(`/quality/audits/${id}/findings`, {
          clause: "1",
          description: "x",
          severity: "MINOR",
        })
      ).status,
    ).toBe(409);
  });

  it("los capítulos son de las normas de la empresa; la cobertura cuenta solo internas hechas", async () => {
    const t = await world("Calidad cobertura");
    await api(t.ws.slug, t.ws.token).put("/admin/quality", { standards: ["IFS8"] });
    const manager = api(t.ws.slug, t.manager.token);
    expect(
      (await manager.post("/quality/audits", auditInput({ chapters: ["BRCGS9:1"] }))).status,
    ).toBe(400);
    expect(
      (await manager.post("/quality/audits", auditInput({ chapters: ["IFS8:7"] }))).status,
    ).toBe(400);
    const done = await manager.post(
      "/quality/audits",
      auditInput({ chapters: ["IFS8:1", "IFS8:4"] }),
    );
    await manager.post(`/quality/audits/${(done.body as AuditBody).audit.id}/done`, {
      doneOn: "2026-10-21",
    });
    await manager.post("/quality/audits", auditInput({ chapters: ["IFS8:2"] }));
    const coverage = (await manager.get("/quality/audits/coverage?year=2026")).body as {
      standards: { standard: string; chapters: { number: number; audits: string[] }[] }[];
    };
    expect(coverage.standards.map((item) => item.standard)).toEqual(["IFS8"]);
    expect(
      coverage.standards[0]?.chapters
        .filter((item) => item.audits.length > 0)
        .map((item) => item.number),
    ).toEqual([1, 4]);
  });

  it("otra empresa: su auditoría, su hallazgo, su gente y su sala son 404 o 400", async () => {
    const other = await world("Calidad auditoría ajena");
    const theirs = await api(other.ws.slug, other.manager.token).post(
      "/quality/audits",
      auditInput({ scheme: "IFS8" }),
    );
    const theirId = (theirs.body as AuditBody).audit.id;
    const finding = await api(other.ws.slug, other.manager.token).post(
      `/quality/audits/${theirId}/findings`,
      { clause: "1", description: "x", severity: "MINOR", openNc: false },
    );
    const theirFinding = (finding.body as AuditBody).audit.findingItems[0]?.id ?? "";
    const room = await ctx.prisma.auditRoom.create({
      data: {
        workspaceId: other.ws.workspaceId,
        name: "Sala ajena",
        auditorEmail: "auditor@example.com",
        expiresAt: new Date(Date.now() + 86_400_000),
        createdById: other.ws.membershipId,
      },
    });
    const manager = api(w.ws.slug, w.manager.token);
    expect((await manager.get(`/quality/audits/${theirId}`)).status).toBe(404);
    expect((await manager.patch(`/quality/audits/${theirId}`, { title: "x" })).status).toBe(404);
    expect(
      (await manager.post(`/quality/audits/${theirId}/done`, { doneOn: "2026-10-21" })).status,
    ).toBe(404);
    expect((await manager.post(`/quality/findings/${theirFinding}/nc`, {})).status).toBe(404);
    expect(
      (await manager.post("/quality/audits", auditInput({ leadId: other.manager.membership.id })))
        .status,
    ).toBe(404);
    expect(
      (
        await api(w.ws.slug, w.ws.token).post(
          "/quality/audits",
          auditInput({ scheme: "IFS8", auditRoomId: room.id }),
        )
      ).status,
    ).toBe(400);
  });
});

// ─── Phase 4: suppliers ─────────────────────────────────────────────────────────────────

interface SupplierBody {
  supplier: {
    id: string;
    status: string;
    access: string;
    nextReviewOn: string | null;
    certificates: string | null;
    docs: { id: string; state: string }[];
  };
}

const supplierInput = (name: string, extra: object = {}) => ({
  name,
  category: "INGREDIENT",
  supplies: "Pimentón y especias",
  risk: "HIGH",
  ...extra,
});

describe("calidad fase 4: proveedores", () => {
  it("quality.view lee; un miembro no ve ni la lista; solo quality.manage da de alta y evalúa", async () => {
    const created = await api(w.ws.slug, w.manager.token).post(
      "/quality/suppliers",
      supplierInput("Especias Uno"),
    );
    expect(created.status).toBe(201);
    const id = (created.body as SupplierBody).supplier.id;
    expect((created.body as SupplierBody).supplier.status).toBe("PENDING");
    expect((await api(w.ws.slug, w.viewer.token).get(`/quality/suppliers/${id}`)).status).toBe(200);
    expect(
      (await api(w.ws.slug, w.viewer.token).post("/quality/suppliers", supplierInput("Otro")))
        .status,
    ).toBe(403);
    const plain = api(w.ws.slug, w.plain.token);
    expect((await plain.get(`/quality/suppliers/${id}`)).status).toBe(404);
    expect(((await plain.get("/quality/suppliers")).body as { total: number }).total).toBe(0);
    // Names are unique without caring about case.
    expect(
      (
        await api(w.ws.slug, w.manager.token).post(
          "/quality/suppliers",
          supplierInput("especias uno"),
        )
      ).status,
    ).toBe(409);
  });

  it("quien lo sigue carga documentos pero no lo evalúa; la evaluación fija estado y próxima", async () => {
    const created = await api(w.ws.slug, w.manager.token).post(
      "/quality/suppliers",
      supplierInput("Tripas Dos", { ownerId: w.owner.membership.id }),
    );
    const id = (created.body as SupplierBody).supplier.id;
    const follower = api(w.ws.slug, w.owner.token);
    expect(
      ((await follower.get(`/quality/suppliers/${id}`)).body as SupplierBody).supplier.access,
    ).toBe("owner");
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const doc = await follower.post(`/quality/suppliers/${id}/docs`, {
      kind: "CERT_IFS",
      name: "Certificado IFS",
      validUntil: soon,
    });
    expect(doc.status).toBe(201);
    expect((doc.body as SupplierBody).supplier.certificates).toBe("due_soon");
    const expiry = await ctx.prisma.expiry.findFirst({
      where: {
        kind: "quality.supplier_doc",
        subjectId: (doc.body as SupplierBody).supplier.docs[0]?.id ?? "",
      },
    });
    expect(expiry?.responsibleId).toBe(w.owner.membership.id);
    const review = {
      reviewedOn: "2026-11-01",
      scores: { quality: 4, service: 4, documents: 2, incidents: 4 },
      result: "CONDITIONAL",
      note: "Ficha técnica sin actualizar.",
    };
    expect((await follower.post(`/quality/suppliers/${id}/reviews`, review)).status).toBe(403);
    expect((await follower.patch(`/quality/suppliers/${id}`, { name: "x" })).status).toBe(403);
    const reviewed = await api(w.ws.slug, w.manager.token).post(
      `/quality/suppliers/${id}/reviews`,
      review,
    );
    expect((reviewed.body as SupplierBody).supplier).toMatchObject({
      status: "CONDITIONAL",
      nextReviewOn: "2027-05-01",
    });
    expect(
      (
        await api(w.ws.slug, w.manager.token).post(`/quality/suppliers/${id}/reviews`, {
          ...review,
          scores: { ...review.scores, quality: 6 },
        })
      ).status,
    ).toBe(400);
  });

  it("un documento solo apunta a un archivo de su carpeta; archivado no recibe nada", async () => {
    const manager = api(w.ws.slug, w.manager.token);
    const created = await manager.post("/quality/suppliers", supplierInput("Envases Tres"));
    const id = (created.body as SupplierBody).supplier.id;
    const outside = await ctx.prisma.node.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        type: "FILE",
        name: "suelto.pdf",
        nameKey: "suelto.pdf",
        position: "a0",
        createdById: w.ws.membershipId,
        updatedById: w.ws.membershipId,
        mimeType: "application/pdf",
        sizeBytes: 10n,
      },
    });
    expect(
      (
        await manager.post(`/quality/suppliers/${id}/docs`, {
          kind: "OTHER",
          name: "x",
          nodeId: outside.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (await manager.post(`/quality/suppliers/${id}/archive`, { archived: true })).status,
    ).toBe(200);
    expect(
      (await manager.post(`/quality/suppliers/${id}/docs`, { kind: "OTHER", name: "x" })).status,
    ).toBe(409);
  });

  it("una NC se liga a un proveedor solo con origen Proveedor; otra empresa, 404", async () => {
    const manager = api(w.ws.slug, w.manager.token);
    const created = await manager.post("/quality/suppliers", supplierInput("Cárnicas Cuatro"));
    const id = (created.body as SupplierBody).supplier.id;
    expect(
      (await manager.post("/quality/ncs", { ...ncInput(w.owner.membership.id), supplierId: id }))
        .status,
    ).toBe(400);
    const linked = await manager.post("/quality/ncs", {
      ...ncInput(w.owner.membership.id),
      origin: "SUPPLIER",
      supplierId: id,
    });
    expect(linked.status).toBe(201);
    const other = await world("Calidad proveedor ajeno");
    const theirs = await api(other.ws.slug, other.manager.token).post(
      "/quality/suppliers",
      supplierInput("Ajeno"),
    );
    const theirId = (theirs.body as SupplierBody).supplier.id;
    expect((await manager.get(`/quality/suppliers/${theirId}`)).status).toBe(404);
    expect((await manager.patch(`/quality/suppliers/${theirId}`, { name: "x" })).status).toBe(404);
    expect(
      (await manager.post(`/quality/suppliers/${theirId}/docs`, { kind: "OTHER", name: "x" }))
        .status,
    ).toBe(404);
    expect(
      (
        await manager.post("/quality/ncs", {
          ...ncInput(w.owner.membership.id),
          origin: "SUPPLIER",
          supplierId: theirId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await manager.post(
          "/quality/suppliers",
          supplierInput("Con dueño ajeno", { ownerId: other.manager.membership.id }),
        )
      ).status,
    ).toBe(404);
  });
});

// ─── Phase 5: complaints, crisis and recall ─────────────────────────────────────────────

interface ComplaintBody {
  complaint: {
    id: string;
    contact: string | null;
    access: string;
    status: string;
    respondBy: string;
    owner: { id: string };
    nc: { id: string } | null;
  };
}

const complaintInput = (extra: object = {}) => ({
  source: "CONSUMER",
  from: "Ana Gómez",
  contact: "600 123 456",
  product: "Chorizo picante",
  lot: "24-298",
  category: "FOREIGN_BODY",
  description: "Un trozo de plástico.",
  receivedOn: "2026-11-02",
  ...extra,
});

describe("calidad fase 5: reclamaciones", () => {
  it("cualquiera registra; el contacto del consumidor solo lo ven quality.manage y el responsable", async () => {
    const recorded = await api(w.ws.slug, w.plain.token).post(
      "/quality/complaints",
      complaintInput(),
    );
    expect(recorded.status).toBe(201);
    const body = (recorded.body as ComplaintBody).complaint;
    expect(body.contact).toBeNull();
    expect(body.access).toBe("read");
    expect(body.respondBy).toBe("2026-11-12");
    // In charge of the first quality.manage (the company owner), never of whoever records it.
    expect(body.owner.id).not.toBe(w.plain.membership.id);
    expect(
      (
        (await api(w.ws.slug, w.viewer.token).get(`/quality/complaints/${body.id}`))
          .body as ComplaintBody
      ).complaint.contact,
    ).toBeNull();
    expect(
      (
        (await api(w.ws.slug, w.manager.token).get(`/quality/complaints/${body.id}`))
          .body as ComplaintBody
      ).complaint.contact,
    ).toBe("600 123 456");
    // Whoever recorded it reads it; another member doesn't see it.
    expect((await api(w.ws.slug, w.plain.token).get(`/quality/complaints/${body.id}`)).status).toBe(
      200,
    );
    expect((await api(w.ws.slug, w.head.token).get(`/quality/complaints/${body.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await api(w.ws.slug, w.plain.token).post(`/quality/complaints/${body.id}/answer`, {
          response: "x",
          justified: true,
          respondedOn: "2026-11-03",
        })
      ).status,
    ).toBe(403);
    expect(
      (await api(w.ws.slug, w.guest.token).post("/quality/complaints", complaintInput())).status,
    ).toBe(403);
  });

  it("su responsable responde y abre la NC una vez; cerrada no cambia", async () => {
    const created = await api(w.ws.slug, w.manager.token).post(
      "/quality/complaints",
      complaintInput({ ownerId: w.owner.membership.id }),
    );
    const id = (created.body as ComplaintBody).complaint.id;
    const owner = api(w.ws.slug, w.owner.token);
    expect(
      ((await owner.get(`/quality/complaints/${id}`)).body as ComplaintBody).complaint.contact,
    ).toBe("600 123 456");
    const nc = await owner.post(`/quality/complaints/${id}/nc`, { severity: "MAJOR" });
    expect(nc.status).toBe(200);
    const ncId = (nc.body as ComplaintBody).complaint.nc?.id ?? "";
    expect((await ctx.prisma.qualityNc.findFirstOrThrow({ where: { id: ncId } })).origin).toBe(
      "COMPLAINT",
    );
    expect((await owner.post(`/quality/complaints/${id}/nc`, { severity: "MAJOR" })).status).toBe(
      409,
    );
    const answered = await owner.post(`/quality/complaints/${id}/answer`, {
      response: "Reponemos el producto.",
      justified: true,
      respondedOn: "2026-11-04",
    });
    expect((answered.body as ComplaintBody).complaint.status).toBe("ANSWERED");
    expect((await owner.post(`/quality/complaints/${id}/close`)).status).toBe(200);
    expect((await owner.patch(`/quality/complaints/${id}`, { product: "x" })).status).toBe(409);
    // Reassigning is quality.manage's.
    const other = await api(w.ws.slug, w.manager.token).post(
      "/quality/complaints",
      complaintInput({ ownerId: w.owner.membership.id }),
    );
    const otherId = (other.body as ComplaintBody).complaint.id;
    expect(
      (await owner.patch(`/quality/complaints/${otherId}`, { ownerId: w.plain.membership.id }))
        .status,
    ).toBe(403);
  });

  it("indicadores y unidades: quality.view lee, solo quality.manage carga; un miembro, 403", async () => {
    expect(
      (await api(w.ws.slug, w.plain.token).get("/quality/complaints/indicators?year=2026")).status,
    ).toBe(403);
    expect(
      (
        await api(w.ws.slug, w.viewer.token).put("/quality/units", {
          month: "2026-11-01",
          units: 1000,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(w.ws.slug, w.manager.token).put("/quality/units", {
          month: "2026-11-15",
          units: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(w.ws.slug, w.manager.token).put("/quality/units", {
          month: "2026-11-01",
          units: 1_000_000,
        })
      ).status,
    ).toBe(204);
    const indicators = (
      await api(w.ws.slug, w.viewer.token).get("/quality/complaints/indicators?year=2026")
    ).body as { months: { month: string; complaints: number; units: number | null }[] };
    const november = indicators.months.find((month) => month.month === "2026-11");
    expect(november?.units).toBe(1_000_000);
    expect(november?.complaints).toBeGreaterThan(0);
  });

  it("otra empresa: su reclamación es 404 y su gente no entra en el equipo de crisis", async () => {
    const other = await world("Calidad reclamación ajena");
    const theirs = await api(other.ws.slug, other.manager.token).post(
      "/quality/complaints",
      complaintInput(),
    );
    const theirId = (theirs.body as ComplaintBody).complaint.id;
    const manager = api(w.ws.slug, w.manager.token);
    expect((await manager.get(`/quality/complaints/${theirId}`)).status).toBe(404);
    expect(
      (
        await manager.post(`/quality/complaints/${theirId}/answer`, {
          response: "x",
          justified: true,
          respondedOn: "2026-11-03",
        })
      ).status,
    ).toBe(404);
    expect(
      (await manager.post(`/quality/complaints/${theirId}/nc`, { severity: "MINOR" })).status,
    ).toBe(404);
    expect(
      (
        await manager.post("/quality/crisis/members", {
          membershipId: other.manager.membership.id,
          role: "x",
        })
      ).status,
    ).toBe(404);
  });
});

describe("calidad fase 5: crisis y retirada", () => {
  it("quality.view lee; solo quality.manage cambia; la prueba fija el aviso del año siguiente", async () => {
    expect((await api(w.ws.slug, w.plain.token).get("/quality/crisis")).status).toBe(403);
    expect((await api(w.ws.slug, w.viewer.token).get("/quality/crisis")).status).toBe(200);
    expect(
      (
        await api(w.ws.slug, w.viewer.token).post("/quality/crisis/contacts", {
          kind: "LAB",
          name: "x",
        })
      ).status,
    ).toBe(403);
    const manager = api(w.ws.slug, w.manager.token);
    const member = await manager.post("/quality/crisis/members", {
      membershipId: w.head.membership.id,
      role: "Coordinación",
    });
    expect(member.status).toBe(201);
    expect(
      (
        await manager.post("/quality/crisis/members", {
          membershipId: w.head.membership.id,
          role: "Otra",
        })
      ).status,
    ).toBe(409);
    const test = await manager.post("/quality/recall-tests", {
      kind: "DRILL",
      date: "2026-03-10",
      product: "Jamón cocido",
      lot: "24-070",
      direction: "BOTH",
      minutes: 95,
      recoveredPercent: 100,
      result: "Trazabilidad completa.",
    });
    expect((test.body as { crisis: { nextTestOn: string } }).crisis.nextTestOn).toBe("2027-03-10");
    const expiry = await ctx.prisma.expiry.findFirst({
      where: { workspaceId: w.ws.workspaceId, kind: "quality.recall_test" },
    });
    expect(expiry?.dueOn.toISOString().slice(0, 10)).toBe("2027-03-10");
    // Another company's contact or team member: 404.
    const other = await world("Calidad crisis ajena");
    const theirs = await api(other.ws.slug, other.manager.token).post("/quality/crisis/contacts", {
      kind: "LAB",
      name: "Laboratorio ajeno",
    });
    const theirContact =
      (theirs.body as { crisis: { contacts: { id: string }[] } }).crisis.contacts[0]?.id ?? "";
    expect((await manager.post(`/quality/crisis/contacts/${theirContact}/archive`)).status).toBe(
      404,
    );
    expect(
      (await manager.patch(`/quality/crisis/contacts/${theirContact}`, { name: "x" })).status,
    ).toBe(404);
  });
});

const prpInput = (extra: object = {}) => ({
  kind: "CLEANING",
  name: "Limpieza de la sala de despiece",
  everyDays: 7,
  nextDueOn: "2026-11-01",
  ...extra,
});

interface PrpBody {
  prp: { id: string; nextDueOn: string; access: string; state: string; archived: boolean };
}

describe("calidad fase 6a: prerrequisitos y panel", () => {
  it("quality.view lee; solo quality.manage crea, edita y archiva; un miembro ve solo los suyos", async () => {
    const manager = api(w.ws.slug, w.manager.token);
    expect((await api(w.ws.slug, w.viewer.token).post("/quality/prps", prpInput())).status).toBe(
      403,
    );
    expect((await api(w.ws.slug, w.plain.token).post("/quality/prps", prpInput())).status).toBe(
      403,
    );
    const mine = await manager.post(
      "/quality/prps",
      prpInput({ responsibleId: w.responsible.membership.id }),
    );
    expect(mine.status).toBe(201);
    const id = (mine.body as PrpBody).prp.id;
    const other = await manager.post("/quality/prps", prpInput({ name: "Control de plagas" }));
    const otherId = (other.body as PrpBody).prp.id;
    const viewer = await api(w.ws.slug, w.viewer.token).get("/quality/prps");
    expect((viewer.body as { prps: { id: string }[] }).prps.map((prp) => prp.id)).toEqual(
      expect.arrayContaining([id, otherId]),
    );
    expect((await api(w.ws.slug, w.viewer.token).post(`/quality/prps/${id}/archive`)).status).toBe(
      403,
    );
    // The responsible person sees only theirs; another member sees none, and the rest is 404.
    const theirs = await api(w.ws.slug, w.responsible.token).get("/quality/prps");
    expect((theirs.body as { prps: { id: string }[] }).prps.map((prp) => prp.id)).toEqual([id]);
    expect(
      (await api(w.ws.slug, w.responsible.token).get(`/quality/prps/${otherId}/checks`)).status,
    ).toBe(404);
    expect(
      (await api(w.ws.slug, w.responsible.token).patch(`/quality/prps/${id}`, { everyDays: 1 }))
        .status,
    ).toBe(403);
    const plain = await api(w.ws.slug, w.plain.token).get("/quality/prps");
    expect((plain.body as { prps: unknown[] }).prps).toHaveLength(0);
    expect((await api(w.ws.slug, w.guest.token).get("/quality/prps")).status).toBe(403);
    expect(
      (await manager.post("/quality/prps", prpInput({ responsibleId: w.guest.membership.id })))
        .status,
    ).toBe(404);
  });

  it("registra su responsable o quality.manage; no conforme abre su NC; quality.view no registra", async () => {
    const manager = api(w.ws.slug, w.manager.token);
    const created = await manager.post(
      "/quality/prps",
      prpInput({ name: "Cloro libre", everyDays: 1, responsibleId: w.responsible.membership.id }),
    );
    const id = (created.body as PrpBody).prp.id;
    const check = { doneOn: "2026-11-05", conforming: true };
    expect(
      (await api(w.ws.slug, w.viewer.token).post(`/quality/prps/${id}/checks`, check)).status,
    ).toBe(403);
    expect(
      (await api(w.ws.slug, w.plain.token).post(`/quality/prps/${id}/checks`, check)).status,
    ).toBe(404);
    const done = await api(w.ws.slug, w.responsible.token).post(`/quality/prps/${id}/checks`, {
      doneOn: "2026-11-06",
      conforming: false,
      note: "Cloro por debajo de 0,2 ppm.",
      openNc: true,
      severity: "MAJOR",
    });
    expect(done.status).toBe(201);
    expect((done.body as PrpBody).prp.nextDueOn).toBe("2026-11-07");
    const expiry = await ctx.prisma.expiry.findFirst({
      where: { workspaceId: w.ws.workspaceId, kind: "quality.prp", subjectId: id },
    });
    expect(expiry?.dueOn.toISOString().slice(0, 10)).toBe("2026-11-07");
    expect(expiry?.responsibleId).toBe(w.responsible.membership.id);
    const checks = await manager.get(`/quality/prps/${id}/checks`);
    const nc = (checks.body as { checks: { nc: { id: string } | null }[] }).checks[0]?.nc;
    expect(nc).not.toBeNull();
    const ncRow = await ctx.prisma.qualityNc.findFirst({ where: { id: nc?.id ?? "" } });
    expect(ncRow?.origin).toBe("INTERNAL");
    expect(ncRow?.ownerId).toBe(w.responsible.membership.id);
    // An older check doesn't move the next date back.
    await manager.post(`/quality/prps/${id}/checks`, { doneOn: "2026-11-01", conforming: true });
    const list = await manager.get("/quality/prps");
    const row = (list.body as { prps: { id: string; nextDueOn: string }[] }).prps.find(
      (prp) => prp.id === id,
    );
    expect(row?.nextDueOn).toBe("2026-11-07");
    // Archived: no more checks and its expiry is resolved.
    expect((await manager.post(`/quality/prps/${id}/archive`)).status).toBe(200);
    expect(
      (await api(w.ws.slug, w.responsible.token).post(`/quality/prps/${id}/checks`, check)).status,
    ).toBe(404);
    const resolved = await ctx.prisma.expiry.findFirst({
      where: { workspaceId: w.ws.workspaceId, kind: "quality.prp", subjectId: id },
    });
    expect(resolved === null || resolved.resolvedAt !== null).toBe(true);
  });

  it("el panel es de quality.view; un miembro, 403; otra empresa: su control es 404 y su gente no entra", async () => {
    expect((await api(w.ws.slug, w.plain.token).get("/quality/dashboard")).status).toBe(403);
    const board = await api(w.ws.slug, w.viewer.token).get("/quality/dashboard");
    expect(board.status).toBe(200);
    expect((board.body as { prps: { nonConforming: number } }).prps.nonConforming).toBeGreaterThan(
      0,
    );
    const other = await world("Calidad prerrequisito ajeno");
    const theirs = await api(other.ws.slug, other.manager.token).post("/quality/prps", prpInput());
    const theirId = (theirs.body as PrpBody).prp.id;
    const manager = api(w.ws.slug, w.manager.token);
    expect((await manager.get(`/quality/prps/${theirId}/checks`)).status).toBe(404);
    expect((await manager.patch(`/quality/prps/${theirId}`, { everyDays: 2 })).status).toBe(404);
    expect((await manager.post(`/quality/prps/${theirId}/archive`)).status).toBe(404);
    expect(
      (
        await manager.post(`/quality/prps/${theirId}/checks`, {
          doneOn: "2026-11-05",
          conforming: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await manager.post(
          "/quality/prps",
          prpInput({ responsibleId: other.manager.membership.id }),
        )
      ).status,
    ).toBe(404);
    // Their board doesn't count ours.
    const theirBoard = await api(other.ws.slug, other.viewer.token).get("/quality/dashboard");
    expect((theirBoard.body as { prps: { nonConforming: number } }).prps.nonConforming).toBe(0);
  });
});
