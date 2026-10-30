// Forms, phase 3 (docs/spec/formularios.md): who's in charge, non-conformity notices, periodic forms
// with their pending list and the 8:00 notices (due to the people assigned, overdue to whoever is in
// charge), once per person and period.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localHour } from "../../src/lib/time-zone.ts";
import { sendFormReminders } from "../../src/modules/forms/form-notices.ts";
import { createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;
let w: PagesWorld;

const fields = [
  { id: "temp", type: "number", label: "Temperatura", min: 0, max: 4, required: true },
];

beforeAll(async () => {
  ctx = await createTestContext();
  w = await pagesWorld(ctx, "Periodicos");
});

afterAll(async () => {
  await ctx.close();
});

async function newForm(name: string) {
  const created = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/forms`, { name });
  const id = (created.body as { form: { node: { id: string } } }).form.node.id;
  const saved = await w.call("put", w.ws.token, `/forms/${id}/template`, {
    baseVersion: 1,
    fields,
  });
  expect(saved.status).toBe(200);
  return id;
}

const settings = (id: string, body: object, token = w.ws.token) =>
  w.call("put", token, `/forms/${id}/settings`, body);

const noticesOf = (membershipId: string, kind: string, nodeId: string) =>
  ctx.prisma.notification.findMany({ where: { membershipId, kind, nodeId } });

interface FormBody {
  seesAllRecords: boolean;
  settings: { responsible: { type: string; people?: { id: string }[] }; frequency: string };
}

describe("responsable y avisos de no conformidad", () => {
  it("por defecto es quien lo creó (espacio sin departamento); se puede elegir una persona", async () => {
    const id = await newForm("Responsable");
    const before = (await w.call("get", w.ws.token, `/forms/${id}`)).body as { form: FormBody };
    expect(before.form.settings.responsible).toMatchObject({
      type: "default",
      people: [{ id: w.ownerMembership.id }],
    });
    const saved = await settings(id, {
      responsible: { type: "person", id: w.editor.membership.id },
      frequency: "none",
      assignees: {},
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // Whoever is in charge sees every record, even with only VIEW.
    const asViewer = await settings(id, {
      responsible: { type: "person", id: w.viewer.membership.id },
      frequency: "none",
      assignees: {},
    });
    expect(asViewer.status).toBe(200);
    const viewerForm = (await w.call("get", w.viewer.token, `/forms/${id}`)).body as {
      form: FormBody;
    };
    expect(viewerForm.form.seesAllRecords).toBe(true);
  });

  it("un registro no conforme avisa al responsable, nunca a quien lo envió", async () => {
    const id = await newForm("No conforme");
    await settings(id, {
      responsible: { type: "person", id: w.editor.membership.id },
      frequency: "none",
      assignees: {},
    });
    const ok = await w.call("post", w.viewer.token, `/forms/${id}/records`, {
      version: 2,
      answers: { temp: 2 },
    });
    expect(ok.status).toBe(201);
    expect(await noticesOf(w.editor.membership.id, "form_nonconforming", id)).toHaveLength(0);
    const bad = await w.call("post", w.viewer.token, `/forms/${id}/records`, {
      version: 2,
      answers: { temp: 9 },
    });
    const recordId = (bad.body as { record: { id: string } }).record.id;
    const notices = await noticesOf(w.editor.membership.id, "form_nonconforming", id);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ detail: recordId, actorId: w.viewer.membership.id });
    // The person in charge sending one themselves isn't told about it.
    await w.call("post", w.editor.token, `/forms/${id}/records`, {
      version: 2,
      answers: { temp: 9 },
    });
    expect(await noticesOf(w.editor.membership.id, "form_nonconforming", id)).toHaveLength(1);
  });

  it.each([
    ["diario sin días", { frequency: "daily", weekdays: [], assignees: { people: ["x"] } }],
    ["periódico sin nadie que lo llene", { frequency: "weekly", assignees: {} }],
    ["una persona de otra empresa", { frequency: "weekly", assignees: { people: ["ajena"] } }],
  ])("rechaza %s", async (_label, body) => {
    const id = await newForm(`Malo ${_label}`);
    const res = await settings(id, { responsible: { type: "default" }, ...body });
    expect(res.status).toBe(400);
  });

  it("solo quien edita el formulario cambia cómo funciona", async () => {
    const id = await newForm("Solo editores");
    const res = await settings(
      id,
      { responsible: { type: "default" }, frequency: "none", assignees: {} },
      w.viewer.token,
    );
    expect(res.status).toBe(403);
  });
});

describe("formularios periódicos", () => {
  /** The next whole hour that is 8:00 in Madrid, on a Wednesday (a weekday, not a Monday). */
  const eightOnAWednesday = () => {
    let at = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    for (;;) {
      const madrid = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        weekday: "short",
      }).format(new Date(at));
      if (localHour(new Date(at), "Europe/Madrid") === 8 && madrid === "Wed") return new Date(at);
      at += 3_600_000;
    }
  };

  it("pendiente para quien está asignado hasta que alguien lo llena en el período", async () => {
    const id = await newForm("Diario todos los días");
    const saved = await settings(id, {
      responsible: { type: "default" },
      frequency: "daily",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignees: { people: [w.viewer.membership.id] },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const pendingOf = async (token: string) =>
      (
        (await w.call("get", token, "/forms/pending")).body as { items: { formId: string }[] }
      ).items.map((item) => item.formId);
    expect(await pendingOf(w.viewer.token)).toContain(id);
    expect(await pendingOf(w.editor.token)).not.toContain(id);
    const sent = await w.call("post", w.viewer.token, `/forms/${id}/records`, {
      version: 2,
      answers: { temp: 3 },
    });
    expect(sent.status).toBe(201);
    const record = await ctx.prisma.formRecord.findFirstOrThrow({ where: { nodeId: id } });
    expect(record.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(await pendingOf(w.viewer.token)).not.toContain(id);
  });

  it("a las 8 de la empresa: el período de hoy a los asignados, el vencido al responsable, una sola vez", async () => {
    const id = await newForm("Semanal de prueba");
    await settings(id, {
      responsible: { type: "person", id: w.editor.membership.id },
      frequency: "daily",
      weekdays: [1, 2, 3, 4, 5],
      assignees: { people: [w.viewer.membership.id] },
    });
    // As if it ran this way since last week: yesterday's period counts.
    await ctx.prisma.formSettings.update({
      where: { nodeId: id },
      data: { updatedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) },
    });
    const at = eightOnAWednesday();
    const deps = { prisma: ctx.prisma, logger: ctx.deps.logger, jobs: ctx.deps.jobs };
    // At 9:00 nothing goes out.
    await sendFormReminders(deps, new Date(at.getTime() + 3_600_000));
    expect(await noticesOf(w.viewer.membership.id, "form_due", id)).toHaveLength(0);
    await sendFormReminders(deps, at);
    await sendFormReminders(deps, at);
    const due = await noticesOf(w.viewer.membership.id, "form_due", id);
    expect(due).toHaveLength(1);
    const overdue = await noticesOf(w.editor.membership.id, "form_overdue", id);
    expect(overdue).toHaveLength(1);
    // Tuesday's period: the one before the Wednesday.
    expect(overdue[0]?.detail).toBe(
      new Date(at.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10),
    );
  });
});
