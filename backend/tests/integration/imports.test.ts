// Importación de carpetas y ZIP (módulo 3, parte 5) contra el S3 local (RustFS).
// Seguridad: nadie importa sin permiso ni en otra empresa; rutas con "..", symlinks, cifrados,
// bombas de descompresión, tamaños que mienten y contenido disfrazado se omiten; la cuota se respeta.
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { runZipImport } from "../../src/modules/imports/zip-import.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  setLimits,
  type TestContext,
} from "./helpers.ts";
import type { TestWorkspace } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;
const MiB = 1024 * 1024;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  const where = { workspace: { name: { startsWith: "Importar " } } };
  const versions = await ctx.prisma.fileVersion.findMany({ where, select: { storageKey: true } });
  const reservations = await ctx.prisma.uploadReservation.findMany({
    where,
    select: { storageKey: true },
  });
  for (const row of [...versions, ...reservations]) await ctx.deps.storage.delete(row.storageKey);
  await ctx.close();
});

const api = (ws: Pick<TestWorkspace, "slug">, token: string) => {
  const call = (method: "get" | "post" | "put", path: string, body?: object) =>
    request(app)
      [method](`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  return {
    get: (path: string) => call("get", path),
    post: (path: string, body?: object) => call("post", path, body),
    put: (path: string, body?: object) => call("put", path, body),
  };
};

async function setup(label: string) {
  const ws = await createWorkspace(ctx, `Importar ${label}`);
  const other = await createWorkspace(ctx, `Importar ${label} ajeno`);
  const owner = api(ws, ws.token);
  const calidad = await ctx.prisma.department.create({
    data: { workspaceId: ws.workspaceId, name: "Calidad" },
  });
  const editor = await addMember(ctx, ws, { name: "Edith Editora" });
  const viewer = await addMember(ctx, ws, { name: "Vera Visora" });
  const reader = await addMember(ctx, ws, { name: "Rita Lectora", seatType: "READER" });
  const guest = await addMember(ctx, ws, { base: "GUEST", name: "Gabi Invitada" });
  await ctx.prisma.departmentMember.createMany({
    data: [editor, reader].map((p) => ({
      workspaceId: ws.workspaceId,
      departmentId: calidad.id,
      membershipId: p.membership.id,
    })),
  });
  const space = (
    (await owner.post("/spaces", { name: "Procedimientos" })).body as { space: { id: string } }
  ).space;
  await owner.put(`/spaces/${space.id}/permissions`, { departmentId: calidad.id, level: "EDIT" });
  return { ws, other, owner, editor, viewer, reader, guest, space };
}
type World = Awaited<ReturnType<typeof setup>>;

const text = (content: string) => Buffer.from(content, "utf8");
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);

interface Plan {
  folders: { created: number; reused: number };
  accepted: { path: string; parentId: string | null; name: string; size: number }[];
  skipped: { path: string; reason: string }[];
  totalBytes: number;
}

const plan = async (
  w: World,
  token: string,
  entries: { path: string; size: number }[],
  parentId?: string | null,
) =>
  await api(w.ws, token).post(`/spaces/${w.space.id}/import-plan`, {
    entries,
    ...(parentId === undefined ? {} : { parentId }),
  });

const foldersOf = async (w: World) =>
  (
    await ctx.prisma.node.findMany({
      where: { workspaceId: w.ws.workspaceId, type: "FOLDER" },
      select: { name: true, parentId: true, id: true },
    })
  ).sort((a, b) => a.name.localeCompare(b.name));

describe("plan de importación de una carpeta", () => {
  it("crea las carpetas, acepta lo válido y explica lo omitido", async () => {
    const w = await setup("plan");
    const res = await plan(w, w.editor.token, [
      { path: "Calidad/Procedimientos/PR-01.pdf", size: 100 },
      { path: "Calidad/Procedimientos/PR-02.pdf", size: 200 },
      { path: "Calidad/Registros/R-01.csv", size: 50 },
      { path: "suelto.txt", size: 10 },
      { path: "Calidad/virus.exe", size: 10 },
      { path: "Calidad/vacio.txt", size: 0 },
      { path: "Calidad/.DS_Store", size: 10 },
      { path: "../afuera.txt", size: 10 },
      { path: "Calidad/Procedimientos/pr-01.PDF", size: 10 },
    ]);
    expect(res.status).toBe(201);
    const body = res.body as Plan;
    expect(body.folders).toEqual({ created: 3, reused: 0 });
    expect(body.accepted.map((a) => a.path).sort()).toEqual([
      "Calidad/Procedimientos/PR-01.pdf",
      "Calidad/Procedimientos/PR-02.pdf",
      "Calidad/Registros/R-01.csv",
      "suelto.txt",
    ]);
    expect(Object.fromEntries(body.skipped.map((s) => [s.path, s.reason]))).toEqual({
      "Calidad/virus.exe": "unsupportedType",
      "Calidad/vacio.txt": "empty",
      "Calidad/.DS_Store": "systemFile",
      "../afuera.txt": "invalidPath",
      "Calidad/Procedimientos/pr-01.PDF": "nameTaken",
    });
    expect(body.totalBytes).toBe(360);
    const folders = await foldersOf(w);
    expect(folders.map((f) => f.name)).toEqual(["Calidad", "Procedimientos", "Registros"]);
    const calidad = folders.find((f) => f.name === "Calidad");
    expect(calidad?.parentId).toBeNull();
    expect(folders.find((f) => f.name === "Procedimientos")?.parentId).toBe(calidad?.id);
    expect(body.accepted.find((a) => a.path === "suelto.txt")?.parentId).toBeNull();
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "import.folder" },
      }),
    ).toBe(1);
  });

  it("reutiliza carpetas que ya existen y respeta el destino", async () => {
    const w = await setup("reutiliza");
    await plan(w, w.editor.token, [{ path: "Calidad/a.txt", size: 1 }]);
    const again = (await plan(w, w.editor.token, [{ path: "Calidad/b.txt", size: 1 }]))
      .body as Plan;
    expect(again.folders).toEqual({ created: 0, reused: 1 });
    expect((await foldersOf(w)).length).toBe(1);

    const [parent] = await foldersOf(w);
    const inside = (await plan(w, w.editor.token, [{ path: "Sub/c.txt", size: 1 }], parent?.id))
      .body as Plan;
    expect(inside.folders.created).toBe(1);
    expect((await foldersOf(w)).find((f) => f.name === "Sub")?.parentId).toBe(parent?.id);
  });

  it("un archivo con el nombre de la carpeta bloquea lo de adentro", async () => {
    const w = await setup("bloqueo");
    await ctx.prisma.node.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.space.id,
        type: "FILE",
        name: "Calidad",
        nameKey: "calidad",
        position: "V",
        currentVersion: 1,
        mimeType: "text/plain; charset=utf-8",
        sizeBytes: 1n,
        createdById: w.editor.membership.id,
        updatedById: w.editor.membership.id,
      },
    });
    const body = (await plan(w, w.editor.token, [{ path: "Calidad/a.txt", size: 1 }])).body as Plan;
    expect(body.accepted).toEqual([]);
    expect(body.skipped).toEqual([{ path: "Calidad/a.txt", reason: "nameTaken" }]);
  });

  it("valida el cuerpo y el tope de archivos", async () => {
    const w = await setup("validación");
    expect((await plan(w, w.editor.token, [])).status).toBe(400);
    const many = Array.from({ length: 5001 }, (_, i) => ({ path: `f${String(i)}.txt`, size: 1 }));
    expect((await plan(w, w.editor.token, many)).status).toBe(400);
    expect(
      (
        await api(w.ws, w.editor.token).post(`/spaces/${w.space.id}/import-plan`, {
          entries: [{ path: "a.txt", size: -1 }],
        })
      ).status,
    ).toBe(400);
  });

  it("respeta la cuota antes de crear nada", async () => {
    const w = await setup("cuota");
    const ent = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.workspaceId } });
    expect(ent.storageUsedBytes).toBe(0n);
    // Casi sin cuota: solo quedan 100 bytes.
    const { limitInBaseUnits } = await import("@spiderfolio/limits");
    await setLimits(ctx, w.ws.workspaceId, { storageGb: 1 });
    const storage = limitInBaseUnits("storageGb", 1);
    await ctx.prisma.workspace.update({
      where: { id: w.ws.workspaceId },
      data: { storageUsedBytes: (storage ?? 0n) - 100n },
    });
    const res = await plan(w, w.editor.token, [{ path: "Nueva/a.txt", size: 500 }]);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { code: "LIMIT_REACHED", details: { limit: "storageGb" } },
    });
    expect(await foldersOf(w)).toEqual([]);
  });

  it("solo quien puede editar el destino; nada en otra empresa", async () => {
    const w = await setup("permisos");
    const entries = [{ path: "Calidad/a.txt", size: 1 }];
    expect((await plan(w, w.viewer.token, entries)).status).toBe(403);
    expect((await plan(w, w.reader.token, entries)).status).toBe(403);
    expect((await plan(w, w.guest.token, entries)).status).toBe(404);
    expect((await plan(w, w.other.token, entries)).status).toBe(404);
    expect(await foldersOf(w)).toEqual([]);
    expect((await plan(w, w.editor.token, entries)).status).toBe(201);
  });
});

// ─── ZIP ─────────────────────────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
  /** 0 = sin comprimir, 8 = deflate (por defecto). */
  method?: 0 | 8;
  /** Tamaño que declara la cabecera, si miente. */
  declaredSize?: number;
  unixMode?: number;
  encrypted?: boolean;
}

/** Escritor de ZIP mínimo, solo para pruebas. */
function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const flags = (entry.encrypted === true ? 1 : 0) | 0x800;
    const declared = entry.declaredSize ?? entry.data.length;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

interface Summary {
  imported: number;
  skippedCount: number;
  skipped: { path: string; reason: string }[];
  duplicates: number;
  folders: number;
  bytes: number;
}
interface ImportBody {
  import: { id: string; status: string; summary: Summary | null; error: string | null };
}

/** Sube el ZIP como un archivo normal y devuelve su nodo. */
async function uploadZip(w: World, token: string, name: string, content: Buffer) {
  const started = await api(w.ws, token).post(`/spaces/${w.space.id}/uploads`, {
    name,
    size: content.length,
  });
  expect(started.status).toBe(201);
  const ticket = (
    started.body as { upload: { id: string; url: string; contentType: string; nodeId: string } }
  ).upload;
  const sent = await fetch(ticket.url, {
    method: "PUT",
    headers: { "Content-Type": ticket.contentType },
    body: content,
  });
  expect(sent.ok).toBe(true);
  const done = await api(w.ws, token).post(`/uploads/${ticket.id}/complete`);
  expect(done.status).toBe(200);
  return ticket.nodeId;
}

/** Pide la importación y corre el job como lo haría el worker. */
async function importZip(
  w: World,
  token: string,
  zip: Buffer,
  options: { newFolder?: boolean } = {},
) {
  const nodeId = await uploadZip(w, token, "paquete.zip", zip);
  const started = await api(w.ws, token).post(`/files/${nodeId}/import-zip`, options);
  expect(started.status).toBe(202);
  const id = (started.body as ImportBody).import.id;
  await runZipImport(
    {
      prisma: ctx.prisma,
      storage: ctx.deps.storage,
      logger: ctx.deps.logger,
    },
    { importId: id },
  );
  const status = await api(w.ws, token).get(`/imports/${id}`);
  return { nodeId, id, status };
}

const filesOf = async (w: World) =>
  await ctx.prisma.node.findMany({
    where: { workspaceId: w.ws.workspaceId, type: "FILE", name: { not: "paquete.zip" } },
    select: { name: true, parentId: true, id: true, sizeBytes: true },
  });

describe("importar un ZIP", () => {
  it("conserva la estructura dentro de una carpeta nueva y deja el resumen", async () => {
    const w = await setup("zip feliz");
    const { status } = await importZip(
      w,
      w.editor.token,
      buildZip([
        { name: "Calidad/Procedimientos/PR-01.txt", data: text("uno") },
        { name: "Calidad/Registros/R-01.csv", data: text("a,b\n1,2\n") },
        { name: "logo.png", data: PNG, method: 0 },
        { name: "Calidad/", data: Buffer.alloc(0), method: 0 },
      ]),
    );
    expect(status.status).toBe(200);
    const view = (status.body as ImportBody).import;
    expect(view.status).toBe("DONE");
    expect(view.summary).toMatchObject({ imported: 3, skippedCount: 0, duplicates: 0 });
    const folders = await foldersOf(w);
    expect(folders.map((f) => f.name)).toEqual([
      "Calidad",
      "paquete",
      "Procedimientos",
      "Registros",
    ]);
    const root = folders.find((f) => f.name === "paquete");
    expect(folders.find((f) => f.name === "Calidad")?.parentId).toBe(root?.id);
    const files = await filesOf(w);
    expect(files.map((f) => f.name).sort()).toEqual(["PR-01.txt", "R-01.csv", "logo.png"]);
    // Cuota: se sumó lo descomprimido (más el ZIP); no quedan reservas.
    const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: w.ws.workspaceId },
    });
    const total = files.reduce((sum, f) => sum + (f.sizeBytes ?? 0n), 0n);
    expect(workspace.storageUsedBytes).toBeGreaterThan(total);
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(0);
    // Los objetos existen y llevan el contenido real.
    const version = await ctx.prisma.fileVersion.findFirstOrThrow({
      where: { nodeId: files.find((f) => f.name === "PR-01.txt")?.id ?? "" },
    });
    expect(version.checksum).toBe(createHash("sha256").update("uno").digest("hex"));
    expect(version.storageKey).toMatch(new RegExp(`^${w.ws.workspaceId}/`));
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "import.zip" },
      }),
    ).toBe(1);
  });

  it("sin carpeta nueva descomprime en la carpeta del ZIP y no pisa lo que existe", async () => {
    const w = await setup("zip sin carpeta");
    await plan(w, w.editor.token, [{ path: "a.txt", size: 1 }]);
    await ctx.prisma.node.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.space.id,
        type: "FILE",
        name: "a.txt",
        nameKey: "a.txt",
        position: "V",
        currentVersion: 1,
        mimeType: "text/plain; charset=utf-8",
        sizeBytes: 1n,
        createdById: w.editor.membership.id,
        updatedById: w.editor.membership.id,
      },
    });
    const { status } = await importZip(
      w,
      w.editor.token,
      buildZip([
        { name: "A.TXT", data: text("nuevo") },
        { name: "b.txt", data: text("otro") },
      ]),
      { newFolder: false },
    );
    const view = (status.body as ImportBody).import;
    expect(view.summary).toMatchObject({ imported: 1, skippedCount: 1, folders: 0 });
    expect(view.summary?.skipped).toEqual([{ path: "A.TXT", reason: "nameTaken" }]);
  });

  it("omite rutas peligrosas, symlinks, cifrados, tipos no permitidos y contenido disfrazado", async () => {
    const w = await setup("zip hostil");
    const { status } = await importZip(
      w,
      w.editor.token,
      buildZip([
        { name: "../fuera.txt", data: text("x") },
        { name: "a/../../fuera2.txt", data: text("x") },
        { name: "/abs.txt", data: text("x") },
        { name: "c:/win.txt", data: text("x") },
        { name: "a\\b.txt", data: text("x") },
        { name: "enlace.txt", data: text("/etc/passwd"), unixMode: 0o120777 },
        { name: "secreto.txt", data: text("x"), encrypted: true },
        { name: "programa.exe", data: text("MZ") },
        { name: "pagina.html", data: text("<script>1</script>") },
        { name: "falso.pdf", data: text("esto no es un PDF") },
        { name: "falso.png", data: text("tampoco") },
        { name: "__MACOSX/._x.txt", data: text("x") },
        { name: "bueno.txt", data: text("sí") },
      ]),
    );
    const view = (status.body as ImportBody).import;
    expect(view.status).toBe("DONE");
    expect(view.summary?.imported).toBe(1);
    expect(
      Object.fromEntries((view.summary?.skipped ?? []).map((s) => [s.path, s.reason])),
    ).toEqual({
      "../fuera.txt": "invalidPath",
      "a/../../fuera2.txt": "invalidPath",
      "/abs.txt": "invalidPath",
      "c:/win.txt": "invalidPath",
      "a\\b.txt": "invalidPath",
      "enlace.txt": "symlink",
      "secreto.txt": "encrypted",
      "programa.exe": "unsupportedType",
      "pagina.html": "unsupportedType",
      "falso.pdf": "contentMismatch",
      "falso.png": "contentMismatch",
      "__MACOSX/._x.txt": "systemFile",
    });
    expect((await filesOf(w)).map((f) => f.name)).toEqual(["bueno.txt"]);
    // Lo omitido no dejó objetos huérfanos ni cuota reservada.
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(0);
  });

  it("frena las bombas de descompresión y los tamaños que mienten", async () => {
    const w = await setup("zip bomba");
    const { status } = await importZip(
      w,
      w.editor.token,
      buildZip([
        { name: "bomba.txt", data: Buffer.alloc(16 * MiB, 0x61) },
        { name: "miente.txt", data: text("0123456789"), declaredSize: 5 },
        { name: "normal.txt", data: text("ok") },
      ]),
    );
    const view = (status.body as ImportBody).import;
    expect(view.status).toBe("DONE");
    const reasons = Object.fromEntries(
      (view.summary?.skipped ?? []).map((s) => [s.path, s.reason]),
    );
    expect(reasons["bomba.txt"]).toBe("suspiciousRatio");
    expect(reasons["miente.txt"]).toBe("sizeMismatch");
    expect((await filesOf(w)).map((f) => f.name)).toEqual(["normal.txt"]);
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(0);
  });

  it("cuenta los duplicados por contenido", async () => {
    const w = await setup("zip duplicados");
    const { status } = await importZip(
      w,
      w.editor.token,
      buildZip([
        { name: "a.txt", data: text("igual") },
        { name: "copia/a.txt", data: text("igual") },
      ]),
    );
    expect((status.body as ImportBody).import.summary).toMatchObject({
      imported: 2,
      duplicates: 1,
    });
  });

  it("omite lo que no cabe en la cuota y deja el resto", async () => {
    const w = await setup("zip cuota");
    const { limitInBaseUnits } = await import("@spiderfolio/limits");
    await setLimits(ctx, w.ws.workspaceId, { storageGb: 1 });
    const zip = buildZip([
      { name: "grande.txt", data: Buffer.alloc(5000, 0x62) },
      { name: "chico.txt", data: text("ok") },
    ]);
    const nodeId = await uploadZip(w, w.editor.token, "paquete.zip", zip);
    const storage = limitInBaseUnits("storageGb", 1) ?? 0n;
    // Quedan 100 bytes después del ZIP.
    await ctx.prisma.workspace.update({
      where: { id: w.ws.workspaceId },
      data: { storageUsedBytes: storage - 100n },
    });
    const started = await api(w.ws, w.editor.token).post(`/files/${nodeId}/import-zip`, {});
    await runZipImport(
      {
        prisma: ctx.prisma,
        storage: ctx.deps.storage,
        logger: ctx.deps.logger,
      },
      { importId: (started.body as ImportBody).import.id },
    );
    const view = (
      (await api(w.ws, w.editor.token).get(`/imports/${(started.body as ImportBody).import.id}`))
        .body as ImportBody
    ).import;
    expect(view.summary?.skipped).toEqual([{ path: "grande.txt", reason: "overQuota" }]);
    expect(view.summary?.imported).toBe(1);
  });

  it("falla con un mensaje claro si el ZIP está dañado", async () => {
    const w = await setup("zip dañado");
    const good = buildZip([{ name: "a.txt", data: text("a") }]);
    // Mismo inicio (es un ZIP para file-type) pero sin directorio central.
    const broken = Buffer.concat([good.subarray(0, good.length - 40), Buffer.alloc(40)]);
    const { status } = await importZip(w, w.editor.token, broken);
    const view = (status.body as ImportBody).import;
    expect(view.status).toBe("FAILED");
    expect(view.error).toContain("ZIP");
    expect(await filesOf(w)).toEqual([]);
  });

  it("solo importa quien puede editar el destino y solo un ZIP", async () => {
    const w = await setup("zip permisos");
    const zip = buildZip([{ name: "a.txt", data: text("a") }]);
    const nodeId = await uploadZip(w, w.editor.token, "paquete.zip", zip);
    const post = (token: string) => api(w.ws, token).post(`/files/${nodeId}/import-zip`, {});
    expect((await post(w.viewer.token)).status).toBe(403);
    expect((await post(w.reader.token)).status).toBe(403);
    expect((await post(w.guest.token)).status).toBe(404);
    expect((await post(w.other.token)).status).toBe(404);
    expect(await ctx.prisma.importJob.count({ where: { workspaceId: w.ws.workspaceId } })).toBe(0);

    // Un archivo que no es ZIP no se importa.
    const txt = await api(w.ws, w.editor.token).post(`/spaces/${w.space.id}/uploads`, {
      name: "nota.txt",
      size: 2,
    });
    const ticket = (
      txt.body as { upload: { id: string; url: string; contentType: string; nodeId: string } }
    ).upload;
    await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": ticket.contentType },
      body: text("hi"),
    });
    await api(w.ws, w.editor.token).post(`/uploads/${ticket.id}/complete`);
    expect(
      (await api(w.ws, w.editor.token).post(`/files/${ticket.nodeId}/import-zip`, {})).status,
    ).toBe(400);
  });

  it("el estado de una importación es solo de quien la pidió", async () => {
    const w = await setup("zip estado");
    const { id } = await importZip(
      w,
      w.editor.token,
      buildZip([{ name: "a.txt", data: text("a") }]),
    );
    expect((await api(w.ws, w.editor.token).get(`/imports/${id}`)).status).toBe(200);
    expect((await api(w.ws, w.ws.token).get(`/imports/${id}`)).status).toBe(404);
    expect((await api(w.ws, w.viewer.token).get(`/imports/${id}`)).status).toBe(404);
    expect((await api(w.other, w.other.token).get(`/imports/${id}`)).status).toBe(404);
  });

  it("un job repetido no descomprime dos veces", async () => {
    const w = await setup("zip repetido");
    const { id } = await importZip(
      w,
      w.editor.token,
      buildZip([{ name: "a.txt", data: text("a") }]),
    );
    const again = await runZipImport(
      {
        prisma: ctx.prisma,
        storage: ctx.deps.storage,
        logger: ctx.deps.logger,
      },
      { importId: id },
    );
    expect(again).toBeNull();
    expect(await filesOf(w)).toHaveLength(1);
  });
});
