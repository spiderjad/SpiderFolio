// Records, phase 2 (docs/spec/formularios.md): filling a form in with VIEW, photos and a signature that
// are real images tied to one record only, answers checked against the version filled in, what's
// non-conforming worked out by the server, who sees which records, and that a record can't be changed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepFormFiles } from "../../src/modules/forms/form-file-sweep.ts";
import { createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;
let w: PagesWorld;
let formId = "";

const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(64),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

const fields = [
  { id: "temp", type: "number", label: "Temperatura", unit: "°C", min: 0, max: 4, required: true },
  { id: "door", type: "yesno", label: "¿Cierra la puerta?", nonConforming: "no" },
  { id: "pics", type: "photo", label: "Fotos", max: 2 },
  { id: "sign", type: "signature", label: "Firma", required: true },
];

beforeAll(async () => {
  ctx = await createTestContext();
  w = await pagesWorld(ctx, "Registros");
  const created = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/forms`, {
    name: "Cámaras",
  });
  formId = (created.body as { form: { node: { id: string } } }).form.node.id;
  const saved = await w.call("put", w.ws.token, `/forms/${formId}/template`, {
    baseVersion: 1,
    fields,
  });
  expect(saved.status).toBe(200);
});

afterAll(async () => {
  await ctx.close();
});

/** Asks for an upload, sends the bytes and confirms it; returns the file id. */
async function attach(token: string, fieldId: string, bytes: Buffer, type: string) {
  const start = await w.call("post", token, `/forms/${formId}/files`, {
    fieldId,
    contentType: type,
    size: bytes.length,
  });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  const { fileId, url } = start.body as { fileId: string; url: string };
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": type },
    body: new Uint8Array(bytes),
  });
  expect(put.ok).toBe(true);
  const confirmed = await w.call("post", token, `/forms/${formId}/files/${fileId}/confirm`);
  expect(confirmed.status).toBe(200);
  return fileId;
}

const submit = (token: string, answers: object, version = 2) =>
  w.call("post", token, `/forms/${formId}/records`, { version, answers });

interface RecordBody {
  id: string;
  version: number;
  nonConforming: string[];
  answers: Record<string, unknown>;
  submittedBy: { name: string };
}

describe("registros de un formulario", () => {
  it("quien ve el formulario lo llena, con fotos y firma; el servidor calcula lo no conforme", async () => {
    const usedBefore = (
      await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } })
    ).storageUsedBytes;
    const photo = await attach(w.viewer.token, "pics", WEBP, "image/webp");
    const sign = await attach(w.viewer.token, "sign", PNG, "image/png");
    const res = await submit(w.viewer.token, { temp: 7, door: "yes", pics: [photo], sign });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const record = (res.body as { record: RecordBody }).record;
    expect(record).toMatchObject({
      version: 2,
      nonConforming: ["temp"],
      submittedBy: { name: "Vera Visora" },
    });
    const files = await ctx.prisma.formFile.findMany({ where: { recordId: record.id } });
    expect(files.map((file) => file.fieldId).sort()).toEqual(["pics", "sign"]);
    const usedAfter = (
      await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } })
    ).storageUsedBytes;
    expect(usedAfter - usedBefore).toBe(BigInt(WEBP.length + PNG.length));
    // The audit says a record was sent, never what it said.
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: w.ws.workspaceId, action: "form.record.create" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.metadata).toMatchObject({ recordId: record.id, version: 2, nonConforming: 1 });
    expect(JSON.stringify(entry.metadata)).not.toContain("temp");
    // Its photo is seen through a short URL, with the record's access.
    const url = await w.call(
      "get",
      w.viewer.token,
      `/forms/${formId}/records/${record.id}/files/${photo}`,
    );
    expect(url.status).toBe(200);
  });

  it("respuestas que faltan o no encajan: no se guarda nada y se dice qué campo", async () => {
    const before = await ctx.prisma.formRecord.count({ where: { nodeId: formId } });
    const res = await submit(w.viewer.token, { temp: "frío", door: "quizás" });
    expect(res.status).toBe(400);
    expect(
      (res.body as { error: { details: { fields: unknown[] } } }).error.details.fields,
    ).toEqual([
      { fieldId: "temp", reason: "invalid" },
      { fieldId: "door", reason: "invalid" },
      { fieldId: "sign", reason: "required" },
    ]);
    expect(await ctx.prisma.formRecord.count({ where: { nodeId: formId } })).toBe(before);
  });

  it("una foto o firma ajena, de otro campo o ya usada no entra en un registro", async () => {
    const mine = await attach(w.viewer.token, "sign", PNG, "image/png");
    const theirs = await attach(w.editor.token, "sign", PNG, "image/png");
    const photo = await attach(w.viewer.token, "pics", WEBP, "image/webp");
    expect((await submit(w.viewer.token, { temp: 2, sign: theirs })).status).toBe(400);
    expect((await submit(w.viewer.token, { temp: 2, sign: photo })).status).toBe(400);
    expect((await submit(w.viewer.token, { temp: 2, sign: mine })).status).toBe(201);
    // Already tied to the first record: never to a second one.
    expect((await submit(w.viewer.token, { temp: 2, sign: mine })).status).toBe(400);
    // The signature has to be a PNG.
    const webpSign = await w.call("post", w.viewer.token, `/forms/${formId}/files`, {
      fieldId: "sign",
      contentType: "image/webp",
      size: WEBP.length,
    });
    expect(webpSign.status).toBe(400);
  });

  it("cada uno ve sus registros; quien edita el formulario los ve todos; quien no tiene acceso, nada", async () => {
    const sign = await attach(w.editor.token, "sign", PNG, "image/png");
    const byEditor = await submit(w.editor.token, { temp: 3, sign });
    const editorRecord = (byEditor.body as { record: RecordBody }).record.id;
    const listOf = async (token: string) =>
      (
        (await w.call("get", token, `/forms/${formId}/records?limit=100`)).body as {
          items: RecordBody[];
          total: number;
        }
      ).items;
    const viewerSees = await listOf(w.viewer.token);
    expect(viewerSees.length).toBeGreaterThan(0);
    expect(viewerSees.every((record) => record.submittedBy.name === "Vera Visora")).toBe(true);
    const editorSees = await listOf(w.editor.token);
    expect(editorSees.map((record) => record.submittedBy.name)).toEqual(
      expect.arrayContaining(["Vera Visora", "Edith Editora"]),
    );
    expect(
      (await w.call("get", w.viewer.token, `/forms/${formId}/records/${editorRecord}`)).status,
    ).toBe(404);
    expect((await w.call("get", w.stranger.token, `/forms/${formId}/records`)).status).toBe(404);
    expect((await submit(w.stranger.token, { temp: 1, sign })).status).toBe(404);
  });

  it("queda ligado a la versión con que se llenó, aunque la plantilla cambie después", async () => {
    const sign = await attach(w.viewer.token, "sign", PNG, "image/png");
    const changed = await w.call("put", w.ws.token, `/forms/${formId}/template`, {
      baseVersion: 2,
      fields: [...fields, { id: "notes", type: "text", label: "Notas", required: true }],
    });
    expect(changed.status).toBe(200);
    // Filled with version 2 (open on the phone before the change): accepted as version 2.
    const res = await submit(w.viewer.token, { temp: 1, sign }, 2);
    expect(res.status).toBe(201);
    const id = (res.body as { record: RecordBody }).record.id;
    const detail = await w.call("get", w.viewer.token, `/forms/${formId}/records/${id}`);
    expect((detail.body as { fields: { id: string }[] }).fields.map((field) => field.id)).toEqual(
      fields.map((field) => field.id),
    );
    expect((await submit(w.viewer.token, { temp: 1, sign }, 9)).status).toBe(400);
  });

  it("un registro no se puede cambiar ni borrar", async () => {
    const record = await ctx.prisma.formRecord.findFirstOrThrow({ where: { nodeId: formId } });
    for (const method of ["put", "patch", "delete"] as const) {
      const res = await w.call(method, w.ws.token, `/forms/${formId}/records/${record.id}`, {
        answers: {},
      });
      expect(res.status).toBe(404);
    }
    expect(await ctx.prisma.formRecord.findUniqueOrThrow({ where: { id: record.id } })).toEqual(
      record,
    );
  });

  it("los adjuntos que nunca llegaron a un registro se borran al día y devuelven su cuota", async () => {
    const orphan = await attach(w.viewer.token, "pics", WEBP, "image/webp");
    const usedBefore = (
      await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } })
    ).storageUsedBytes;
    await sweepFormFiles({
      prisma: ctx.prisma,
      logger: ctx.deps.logger,
      storage: ctx.deps.storage,
    });
    expect(await ctx.prisma.formFile.count({ where: { id: orphan } })).toBe(1);
    await sweepFormFiles(
      { prisma: ctx.prisma, logger: ctx.deps.logger, storage: ctx.deps.storage },
      new Date(Date.now() + 2 * 24 * 3600 * 1000),
    );
    expect(await ctx.prisma.formFile.count({ where: { id: orphan } })).toBe(0);
    const usedAfter = (
      await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } })
    ).storageUsedBytes;
    // This one and the others left over by the tests above (confirmed, never sent).
    expect(usedBefore - usedAfter).toBeGreaterThanOrEqual(BigInt(WEBP.length));
    expect(await ctx.prisma.formFile.count({ where: { nodeId: formId, recordId: null } })).toBe(0);
    // The ones in a record stay.
    expect(
      await ctx.prisma.formFile.count({ where: { nodeId: formId, recordId: { not: null } } }),
    ).toBeGreaterThan(0);
  });
});
