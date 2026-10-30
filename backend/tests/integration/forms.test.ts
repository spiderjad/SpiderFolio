// Forms, phase 1 (docs/spec/formularios.md): a form in the tree with versioned templates. Who creates
// and edits it (the access already in place), the fields and their checks, versions that only add up,
// and that a form isn't a folder, a controlled document or a QR target (yet).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;
let w: PagesWorld;

beforeAll(async () => {
  ctx = await createTestContext();
  w = await pagesWorld(ctx, "Formularios");
});

afterAll(async () => {
  await ctx.close();
});

interface FormBody {
  node: { id: string; type: string; name: string; level: string };
  template: { version: number; fields: { id: string; type: string }[] };
  canEdit: boolean;
}

const create = async (token = w.ws.token, body: object = {}) => {
  const res = await w.call("post", token, `/spaces/${w.spaceId}/forms`, body);
  return res;
};
const formOf = (res: { body: unknown }) => (res.body as { form: FormBody }).form;

const fields = [
  {
    id: "temp",
    type: "number",
    label: "Temperatura de la cámara",
    unit: "°C",
    min: 0,
    max: 4,
    required: true,
  },
  { id: "clean", type: "yesno", label: "¿Está limpia?", nonConforming: "no" },
  {
    id: "state",
    type: "choice",
    label: "Estado",
    options: [
      { id: "ok", label: "Bien" },
      { id: "bad", label: "Con daños" },
    ],
    nonConforming: ["bad"],
  },
  { id: "checks", type: "checklist", label: "Revisión", items: [{ id: "door", label: "Puerta" }] },
  { id: "photo", type: "photo", label: "Foto", max: 3 },
  { id: "sign", type: "signature", label: "Firma", required: true },
  { id: "notes", type: "text", label: "Observaciones", multiline: true },
  { id: "when", type: "date", label: "Fecha" },
];

describe("formularios: plantillas y versiones", () => {
  it("se crea en el espacio con la versión 1 vacía y aparece en la carpeta como una hoja", async () => {
    const res = await create(w.ws.token, { name: "Control de cámaras" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const form = formOf(res);
    expect(form.node).toMatchObject({ type: "FORM", name: "Control de cámaras" });
    expect(form.template).toMatchObject({ version: 1, fields: [] });
    expect(form.canEdit).toBe(true);
    const list = await w.call("get", w.ws.token, `/spaces/${w.spaceId}/nodes?pageSize=100`);
    const item = (
      list.body as { items: { id: string; type: string; childCount: number | null }[] }
    ).items.find((row) => row.id === form.node.id);
    expect(item).toMatchObject({ type: "FORM", childCount: null });
    const audit = await ctx.prisma.auditLog.count({
      where: { workspaceId: w.ws.workspaceId, action: "form.create", entityId: form.node.id },
    });
    expect(audit).toBe(1);
  });

  it("guardar campos nuevos suma una versión; los mismos campos no; una versión vieja es conflicto", async () => {
    const form = formOf(await create());
    const saved = await w.call("put", w.ws.token, `/forms/${form.node.id}/template`, {
      baseVersion: 1,
      fields,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(formOf(saved).template.version).toBe(2);
    expect(formOf(saved).template.fields.map((field) => field.id)).toEqual(fields.map((f) => f.id));

    const same = await w.call("put", w.ws.token, `/forms/${form.node.id}/template`, {
      baseVersion: 2,
      fields,
    });
    expect(formOf(same).template.version).toBe(2);

    const stale = await w.call("put", w.ws.token, `/forms/${form.node.id}/template`, {
      baseVersion: 1,
      fields: fields.slice(0, 1),
    });
    expect(stale.status).toBe(409);

    // Versions only add up: the first one is still there, as it was.
    const v1 = await w.call("get", w.ws.token, `/forms/${form.node.id}/versions/1`);
    expect((v1.body as { version: { fields: unknown[] } }).version.fields).toEqual([]);
    const versions = await w.call("get", w.ws.token, `/forms/${form.node.id}/versions`);
    expect(versions.body).toMatchObject({
      total: 2,
      items: [{ version: 2, fieldCount: 8 }, { version: 1 }],
    });
  });

  it.each([
    ["dos campos con el mismo id", [fields[0], { ...fields[0], label: "Otra" }]],
    ["un rango al revés", [{ ...fields[0], min: 10, max: 2 }]],
    ["una opción no conforme que no existe", [{ ...fields[2], nonConforming: ["nada"] }]],
    ["un tipo desconocido", [{ id: "x", type: "audio", label: "Audio" }]],
    ["un id con espacios", [{ id: "con espacio", type: "text", label: "Texto" }]],
    [
      "una elección con una sola opción",
      [{ ...fields[2], options: [{ id: "ok", label: "Bien" }], nonConforming: [] }],
    ],
  ])("rechaza %s", async (_label, bad) => {
    const form = formOf(await create());
    const res = await w.call("put", w.ws.token, `/forms/${form.node.id}/template`, {
      baseVersion: 1,
      fields: bad,
    });
    expect(res.status).toBe(400);
  });

  it("quien ve el espacio lo lee pero no lo cambia; quien no tiene acceso no lo encuentra", async () => {
    const form = formOf(await create());
    const asViewer = await w.call("get", w.viewer.token, `/forms/${form.node.id}`);
    expect(asViewer.status).toBe(200);
    expect(formOf(asViewer).canEdit).toBe(false);
    const change = await w.call("put", w.viewer.token, `/forms/${form.node.id}/template`, {
      baseVersion: 1,
      fields,
    });
    expect(change.status).toBe(403);
    expect((await w.call("post", w.viewer.token, `/spaces/${w.spaceId}/forms`, {})).status).toBe(
      403,
    );
    expect((await w.call("get", w.stranger.token, `/forms/${form.node.id}`)).status).toBe(404);
    // An editor of the space can change it.
    const asEditor = await w.call("put", w.editor.token, `/forms/${form.node.id}/template`, {
      baseVersion: 1,
      fields,
    });
    expect(asEditor.status).toBe(200);
  });

  it("una página no es un formulario, y un formulario no se convierte en documento controlado", async () => {
    const page = await w.makePage();
    expect((await w.call("get", w.ws.token, `/forms/${page.node.id}`)).status).toBe(400);
    const form = formOf(await create());
    const controlled = await w.call("post", w.ws.token, `/nodes/${form.node.id}/controlled`, {
      docType: "PRC",
    });
    expect(controlled.status).toBe(400);
  });
});
