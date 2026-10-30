// Records, phase 4 (docs/spec/formularios.md): the list's filters (company days, person, version,
// non-conforming, voided), voiding with a reason (MANAGE, marked and never deleted, audited) and the
// CSV export with the same records the person sees.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;
let w: PagesWorld;
let formId = "";

const temp = {
  id: "temp",
  type: "number",
  label: "Temperatura",
  unit: "°C",
  min: 0,
  max: 4,
  required: true,
};
const shift = {
  id: "turno",
  type: "choice",
  label: "Turno",
  options: [
    { id: "m", label: "Mañana" },
    { id: "t", label: "Tarde" },
  ],
  nonConforming: [],
};

interface Page {
  items: { id: string; version: number; nonConforming: string[]; voided: unknown }[];
  total: number;
}

const list = async (token: string, query = "") => {
  const res = await w.call("get", token, `/forms/${formId}/records${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Page;
};
const submit = async (token: string, answers: object, version = 2) => {
  const res = await w.call("post", token, `/forms/${formId}/records`, { version, answers });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { record: { id: string } }).record.id;
};
const voidIt = (token: string, recordId: string, reason: string) =>
  w.call("post", token, `/forms/${formId}/records/${recordId}/void`, { reason });

let okId = "";
let badId = "";
let viewerId = "";

beforeAll(async () => {
  ctx = await createTestContext();
  w = await pagesWorld(ctx, "Lista de registros");
  const created = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/forms`, {
    name: "Cámaras; frío",
  });
  formId = (created.body as { form: { node: { id: string } } }).form.node.id;
  await w.call("put", w.ws.token, `/forms/${formId}/template`, {
    baseVersion: 1,
    fields: [temp, shift],
  });
  okId = await submit(w.editor.token, { temp: 2, turno: "m" });
  badId = await submit(w.editor.token, { temp: 9, turno: "t" });
  viewerId = await submit(w.viewer.token, { temp: 3 });
  // A third version without the shift: the old answers keep their column in the CSV.
  await w.call("put", w.ws.token, `/forms/${formId}/template`, { baseVersion: 2, fields: [temp] });
  await submit(w.ws.token, { temp: 1 }, 3);
});

afterAll(async () => {
  await ctx.close();
});

describe("filtros de la lista", () => {
  it("por persona, versión, no conformes y días de la empresa", async () => {
    expect((await list(w.ws.token)).total).toBe(4);
    const byEditor = await list(w.ws.token, `?person=${w.editor.membership.id}`);
    expect(byEditor.items.map((item) => item.id).sort()).toEqual([okId, badId].sort());
    expect((await list(w.ws.token, "?version=3")).total).toBe(1);
    const bad = await list(w.ws.token, "?nonConforming=true");
    expect(bad.items.map((item) => item.id)).toEqual([badId]);
    expect((await list(w.ws.token, "?from=2000-01-01&to=2000-12-31")).total).toBe(0);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await list(w.ws.token, `?from=${yesterday}&to=${tomorrow}`)).total).toBe(4);
  });

  it("quien solo llena ve los suyos aunque filtre por otra persona", async () => {
    expect((await list(w.viewer.token, `?person=${w.editor.membership.id}`)).total).toBe(0);
    expect((await list(w.viewer.token)).items.map((item) => item.id)).toEqual([viewerId]);
  });

  it("rechaza filtros mal escritos", async () => {
    const res = await w.call("get", w.ws.token, `/forms/${formId}/records?from=ayer`);
    expect(res.status).toBe(400);
  });
});

describe("anular un registro", () => {
  it("solo con MANAGE y motivo; queda marcado, nunca se borra, y no se anula dos veces", async () => {
    expect((await voidIt(w.editor.token, okId, "Lectura equivocada")).status).toBe(403);
    expect((await voidIt(w.ws.token, okId, " ")).status).toBe(400);
    const voided = await voidIt(w.ws.token, okId, "Lectura equivocada");
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    expect(voided.body).toMatchObject({
      record: { id: okId, voided: { reason: "Lectura equivocada" } },
    });
    expect((await voidIt(w.ws.token, okId, "Otra vez")).status).toBe(409);
    const row = await ctx.prisma.formRecord.findUniqueOrThrow({ where: { id: okId } });
    expect(row.answers).toEqual({ temp: 2, turno: "m" });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: "form.record.void", entityId: okId } }),
    ).toBe(1);
    expect((await list(w.ws.token, "?status=voided")).items.map((item) => item.id)).toEqual([okId]);
    expect((await list(w.ws.token, "?status=valid")).total).toBe(3);
    const detail = await w.call("get", w.ws.token, `/forms/${formId}/records/${badId}`);
    expect((detail.body as { canVoid: boolean }).canVoid).toBe(true);
    const asEditor = await w.call("get", w.editor.token, `/forms/${formId}/records/${badId}`);
    expect((asEditor.body as { canVoid: boolean }).canVoid).toBe(false);
  });
});

const csvLines = (body: unknown) => String(body).replace(/^\uFEFF/u, "").trim().split("\r\n");

describe("exportar", () => {
  it("CSV con una columna por campo de cualquier versión y las respuestas en texto", async () => {
    const res = await w.call("get", w.ws.token, `/forms/${formId}/export/csv`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const [header = "", ...lines] = csvLines(res.text);
    expect(header).toContain("Temperatura");
    expect(header).toContain("Turno");
    expect(lines).toHaveLength(4);
    expect(res.text).toContain("9 °C");
    expect(res.text).toContain("Tarde");
    expect(res.text).toContain("Lectura equivocada");
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: "form.records.export", entityId: formId },
      }),
    ).toBeGreaterThan(0);
  });

  it("con los filtros y solo lo que la persona ve", async () => {
    const bad = await w.call("get", w.ws.token, `/forms/${formId}/export/csv?nonConforming=true`);
    expect(csvLines(bad.text)).toHaveLength(2);
    const own = await w.call("get", w.viewer.token, `/forms/${formId}/export/csv`);
    expect(csvLines(own.text)).toHaveLength(2);
  });

  it("otro formato no existe", async () => {
    const res = await w.call("get", w.ws.token, `/forms/${formId}/export/xlsx`);
    expect(res.status).toBe(400);
  });
});
