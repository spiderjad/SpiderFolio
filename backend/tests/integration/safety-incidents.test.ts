// Occupational health and safety, phase 3 (docs/spec/seguridad-salud.md, «Accidentes e incidentes»):
// the base form (created with the module, fixed fields), anyone reports, the case it becomes, health data
// only for safety.health (not the admin), the «person» field, corrective measures with their expiry,
// closing, filters and the CSV.
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
  put: (path: string, body?: object) =>
    request(app).put(`/api/v1/w/${slug}${path}`).set("Authorization", `Bearer ${token}`).send(body),
});

interface World {
  ws: TestWorkspace;
  admin: Awaited<ReturnType<typeof addMember>>;
  worker: Awaited<ReturnType<typeof addMember>>;
  injured: Awaited<ReturnType<typeof addMember>>;
  formId: string;
}

async function world(name: string): Promise<World> {
  const ws = await createWorkspace(ctx, name);
  expect((await api(ws.slug, ws.token).put("/admin/safety", { enabled: true })).status).toBe(200);
  const admin = await addMember(ctx, ws, { base: "ADMIN" });
  const worker = await addMember(ctx, ws, { base: "MEMBER", name: "Quien comunica" });
  const injured = await addMember(ctx, ws, { base: "MEMBER", name: "Persona herida" });
  const form = await api(ws.slug, worker.token).get("/safety/incident-form");
  expect(form.status, JSON.stringify(form.body)).toBe(200);
  const formId = (form.body as { form: { formId: string } }).form.formId;
  return { ws, admin, worker, injured, formId };
}

const answers = (person: string | null) => ({
  sst_fecha: "2026-10-30",
  sst_lugar: "Sala de despiece",
  ...(person === null ? {} : { sst_persona: person }),
  sst_tipo: "baja",
  sst_gravedad: "leve",
  sst_que: "Corte en la mano con la sierra.",
});

async function report(w: World, person: string | null = w.injured.membership.id) {
  const res = await api(w.ws.slug, w.worker.token).post(`/forms/${w.formId}/records`, {
    version: 2,
    answers: answers(person),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { record: { id: string } }).record.id;
}

describe("accidentes e incidentes", () => {
  it("cualquiera comunica; el caso queda abierto y se avisa a quien tiene datos de salud", async () => {
    const w = await world("Accidentes comunicar");
    const recordId = await report(w);
    const incident = await ctx.prisma.safetyIncident.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, recordId },
    });
    expect(incident).toMatchObject({
      type: "leave",
      severity: "minor",
      place: "Sala de despiece",
      membershipId: w.injured.membership.id,
      reportedById: w.worker.membership.id,
      status: "OPEN",
    });
    const notices = await ctx.prisma.notification.findMany({
      where: { workspaceId: w.ws.workspaceId, kind: "safety_incident" },
      select: { membershipId: true },
    });
    expect(notices.map((n) => n.membershipId)).toEqual([w.ws.membershipId]);
    // A «person» answer has to be someone of the company.
    const bad = await api(w.ws.slug, w.worker.token).post(`/forms/${w.formId}/records`, {
      version: 2,
      answers: answers("nadie"),
    });
    expect(bad.status).toBe(400);
  });

  it("los registros son datos de salud: ni el administrador ni quien edita los ve todos", async () => {
    const w = await world("Accidentes privacidad");
    await report(w);
    const total = async (token: string) =>
      ((await api(w.ws.slug, token).get(`/forms/${w.formId}/records`)).body as { total: number })
        .total;
    expect(await total(w.ws.token)).toBe(1);
    expect(await total(w.admin.token)).toBe(0);
    expect(await total(w.worker.token)).toBe(1);
    expect(await total(w.injured.token)).toBe(0);
    expect((await api(w.ws.slug, w.admin.token).get("/safety/incidents")).status).toBe(403);
    expect((await api(w.ws.slug, w.ws.token).get("/safety/incidents")).status).toBe(200);
  });

  it("los campos fijos no se quitan ni cambian de tipo; su texto sí", async () => {
    const w = await world("Accidentes campos fijos");
    const a = api(w.ws.slug, w.ws.token);
    const form = (await a.get(`/forms/${w.formId}`)).body as {
      form: {
        template: { version: number; fields: { id: string; label: string }[] };
        lockedFieldIds: string[];
      };
    };
    expect(form.form.lockedFieldIds).toContain("sst_tipo");
    const fields = form.form.template.fields;
    const without = fields.filter((field) => field.id !== "sst_tipo");
    const removed = await request(app)
      .put(`/api/v1/w/${w.ws.slug}/forms/${w.formId}/template`)
      .set("Authorization", `Bearer ${w.ws.token}`)
      .send({ baseVersion: form.form.template.version, fields: without });
    expect(removed.status).toBe(400);
    const renamed = fields.map((field) =>
      field.id === "sst_lugar" ? { ...field, label: "Zona de la planta" } : field,
    );
    const ok = await request(app)
      .put(`/api/v1/w/${w.ws.slug}/forms/${w.formId}/template`)
      .set("Authorization", `Bearer ${w.ws.token}`)
      .send({
        baseVersion: form.form.template.version,
        fields: [...renamed, { id: "turno", type: "text", label: "Turno", required: false }],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("medidas: el responsable ve la suya y la cierra; el caso se cierra con todas hechas", async () => {
    const w = await world("Accidentes medidas");
    await report(w);
    const a = api(w.ws.slug, w.ws.token);
    const list = (await a.get("/safety/incidents")).body as { items: { id: string }[] };
    const incidentId = list.items[0]?.id ?? "";
    const created = await a.post(`/safety/incidents/${incidentId}/actions`, {
      description: "Poner protector en la sierra",
      responsibleId: w.worker.membership.id,
      dueOn: "2026-12-01",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const actionId = (created.body as { action: { id: string } }).action.id;
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { kind: "safety.action", subjectId: actionId },
    });
    expect(expiry.responsibleId).toBe(w.worker.membership.id);
    expect((await a.post(`/safety/incidents/${incidentId}/close`)).status).toBe(409);
    const worker = api(w.ws.slug, w.worker.token);
    expect((await worker.get(`/safety/incidents/${incidentId}`)).status).toBe(403);
    const mine = (await worker.get("/safety/actions")).body as { items: { id: string }[] };
    expect(mine.items.map((item) => item.id)).toEqual([actionId]);
    expect(
      (await api(w.ws.slug, w.injured.token).post(`/safety/actions/${actionId}/done`, {})).status,
    ).toBe(404);
    expect((await worker.post(`/safety/actions/${actionId}/done`, { note: "Hecho" })).status).toBe(
      200,
    );
    expect(
      (await ctx.prisma.expiry.findUniqueOrThrow({ where: { id: expiry.id } })).resolvedAt,
    ).not.toBeNull();
    expect((await a.post(`/safety/incidents/${incidentId}/close`)).status).toBe(200);
    expect((await a.post(`/safety/incidents/${incidentId}/close`)).status).toBe(409);
    expect((await a.post(`/safety/incidents/${incidentId}/reopen`)).status).toBe(200);
  });

  it("filtros y CSV, solo con datos de salud", async () => {
    const w = await world("Accidentes filtros");
    await report(w);
    await report(w, null);
    const a = api(w.ws.slug, w.ws.token);
    const byPerson = (await a.get(`/safety/incidents?person=${w.injured.membership.id}`)).body as {
      total: number;
    };
    expect(byPerson.total).toBe(1);
    expect(
      ((await a.get("/safety/incidents?type=near_miss")).body as { total: number }).total,
    ).toBe(0);
    expect(
      ((await a.get("/safety/incidents?from=2026-10-30&to=2026-10-30")).body as { total: number })
        .total,
    ).toBe(2);
    const csv = await a.get("/safety/incidents/export");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Accidente con baja");
    expect(csv.text).toContain("Persona herida");
    expect((await api(w.ws.slug, w.admin.token).get("/safety/incidents/export")).status).toBe(403);
  });
});
