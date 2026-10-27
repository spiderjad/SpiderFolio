// Subidas, cuota, descarga y vista previa (módulo 3, parte 2) contra el S3 local (RustFS).
// Seguridad: nadie sube, descarga ni ve archivos de otra empresa ni sin permiso; el contenido real
// tiene que coincidir con el tipo; la cuota se reserva antes de dar la URL.
import { createHash } from "node:crypto";
import { limitInBaseUnits } from "@spiderfolio/limits";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { cleanupExpiredUploads } from "../../src/jobs/handlers.ts";
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
});

afterAll(async () => {
  // Deja el bucket limpio: borra los objetos de las versiones y de las reservas de la corrida.
  const versions = await ctx.prisma.fileVersion.findMany({
    where: { workspace: { name: { startsWith: "Archivos " } } },
    select: { storageKey: true },
  });
  const reservations = await ctx.prisma.uploadReservation.findMany({
    where: { workspace: { name: { startsWith: "Archivos " } } },
    select: { storageKey: true, multipartId: true },
  });
  for (const row of reservations) {
    if (row.multipartId !== null)
      await ctx.deps.storage.abortMultipart(row.storageKey, row.multipartId);
    await ctx.deps.storage.delete(row.storageKey);
  }
  for (const row of versions) await ctx.deps.storage.delete(row.storageKey);
  await ctx.close();
});

const api = (ws: Pick<TestWorkspace, "slug">, token: string) => {
  const call = (method: "get" | "post" | "put" | "patch" | "delete", path: string, body?: object) =>
    request(app)
      [method](`/api/v1/w/${ws.slug}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  return {
    get: (path: string) => call("get", path),
    post: (path: string, body?: object) => call("post", path, body),
    put: (path: string, body?: object) => call("put", path, body),
    delete: (path: string) => call("delete", path),
  };
};

interface Ticket {
  id: string;
  nodeId: string;
  name: string;
  version: number;
  size: number;
  contentType: string;
  mode: "single" | "multipart";
  url: string | null;
  partSize: number | null;
  partCount: number | null;
}

async function setup(
  label: string,
  uploads?: { multipartThresholdBytes: number; partSizeBytes: number },
) {
  app = createApp({ ...ctx.deps, ...(uploads === undefined ? {} : { uploads }) });
  const ws = await createWorkspace(ctx, `Archivos ${label}`);
  const other = await createWorkspace(ctx, `Archivos ${label} ajeno`);
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
  return { ws, other, owner, calidad, editor, viewer, reader, guest, space };
}
type World = Awaited<ReturnType<typeof setup>>;

const text = (content: string) => Buffer.from(content, "utf8");
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);

/** PUT a la URL prefirmada, como lo haría el navegador. */
async function put(ticket: Ticket, content: Buffer): Promise<Response> {
  return await fetch(ticket.url ?? "", {
    method: "PUT",
    headers: { "Content-Type": ticket.contentType },
    body: content,
  });
}

async function start(
  w: World,
  token: string,
  name: string,
  size: number,
  extra: { parentId?: string | null; onConflict?: string } = {},
) {
  return await api(w.ws, token).post(`/spaces/${w.space.id}/uploads`, { name, size, ...extra });
}

/** Subida completa: pedir permiso, subir y confirmar. */
async function upload(
  w: World,
  token: string,
  name: string,
  content: Buffer,
  extra: { parentId?: string | null; onConflict?: string } = {},
) {
  const started = await start(w, token, name, content.length, extra);
  expect(started.status).toBe(201);
  const ticket = (started.body as { upload: Ticket }).upload;
  expect((await put(ticket, content)).ok).toBe(true);
  const { storageKey } = await ctx.prisma.uploadReservation.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { storageKey: true },
  });
  return {
    ticket,
    storageKey,
    done: await api(w.ws, token).post(`/uploads/${ticket.id}/complete`),
  };
}

interface DoneBody {
  node: { id: string; name: string; currentVersion: number; sizeBytes: number; mimeType: string };
  version: { version: number; sizeBytes: number; checksum: string };
  duplicateOf: string | null;
}

describe("subida directa: el camino feliz", () => {
  it("pide permiso, sube a S3, confirma y deja el archivo, la cuota y la auditoría", async () => {
    const w = await setup("camino feliz");
    const content = text("Procedimiento de calidad v1\n");
    const { ticket, done } = await upload(w, w.editor.token, "Procedimiento.txt", content);
    expect(done.status).toBe(200);
    const body = done.body as DoneBody;
    expect(body.node).toMatchObject({
      name: "Procedimiento.txt",
      currentVersion: 1,
      sizeBytes: content.length,
      mimeType: "text/plain; charset=utf-8",
      level: "EDIT",
    });
    expect(body.version.checksum).toBe(createHash("sha256").update(content).digest("hex"));
    // Clave del objeto: workspace/nodo/versión-aleatorio, nunca el nombre original.
    const version = await ctx.prisma.fileVersion.findFirstOrThrow({
      where: { nodeId: ticket.nodeId },
    });
    expect(version.storageKey).toMatch(
      new RegExp(`^${w.ws.workspaceId}/${ticket.nodeId}/1-[0-9a-f]{32}$`),
    );
    expect(version.storageKey).not.toContain("Procedimiento");
    expect(version.uploadedById).toBe(w.editor.membership.id);
    // Cuota: se sumó a lo usado y la reserva desapareció.
    const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: w.ws.workspaceId },
    });
    expect(workspace.storageUsedBytes).toBe(BigInt(content.length));
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "file.upload" },
      }),
    ).toBe(1);
    // El listado lo muestra con tamaño y tipo.
    const list = (await w.owner.get(`/spaces/${w.space.id}/nodes`)).body as {
      items: { name: string; sizeBytes: number; type: string }[];
    };
    expect(list.items).toMatchObject([
      { name: "Procedimiento.txt", type: "FILE", sizeBytes: content.length },
    ]);
  });

  it("una carpeta de destino: el archivo queda dentro", async () => {
    const w = await setup("carpeta destino");
    const folder = (
      (await w.owner.post(`/spaces/${w.space.id}/folders`, { name: "Anexos" })).body as {
        node: { id: string };
      }
    ).node;
    const { done } = await upload(w, w.editor.token, "a.csv", text("a,b\n1,2\n"), {
      parentId: folder.id,
    });
    expect(done.status).toBe(200);
    const inside = (await w.owner.get(`/spaces/${w.space.id}/nodes?parent=${folder.id}`)).body as {
      items: { name: string }[];
    };
    expect(inside.items.map((n) => n.name)).toEqual(["a.csv"]);
  });

  it("avisa de un duplicado por contenido (mismo SHA-256) en el workspace", async () => {
    const w = await setup("duplicados");
    const content = text("contenido repetido");
    const first = await upload(w, w.editor.token, "uno.txt", content);
    const second = await upload(w, w.editor.token, "dos.txt", content);
    expect((second.done.body as DoneBody).duplicateOf).toBe(first.ticket.nodeId);
    expect((first.done.body as DoneBody).duplicateOf).toBeNull();
  });
});

describe("subida: seguridad del contenido", () => {
  it("rechaza por extensión ejecutables, scripts, HTML y SVG", async () => {
    const w = await setup("extensiones");
    for (const name of [
      "virus.exe",
      "run.sh",
      "pagina.html",
      "dibujo.svg",
      "a.js",
      "sin-extension",
      "a.pdf.exe",
    ]) {
      const res = await start(w, w.editor.token, name, 100);
      expect(res.status, name).toBe(400);
    }
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(0);
  });

  it("al confirmar, rechaza y borra lo que no es lo que dice la extensión", async () => {
    const w = await setup("magic bytes");
    const cases: [string, Buffer][] = [
      ["falso.pdf", PNG],
      ["falso.png", text("%PDF-1.7 no soy una imagen")],
      ["disfraz.txt", text("<!DOCTYPE html><script>alert(1)</script>")],
      ["disfraz.csv", text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ["binario.txt", Buffer.from([0x68, 0x00, 0x69, 0x00])],
      ["ejecutable.docx", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300)])],
    ];
    for (const [name, content] of cases) {
      const { ticket, storageKey, done } = await upload(w, w.editor.token, name, content);
      expect(done.status, name).toBe(400);
      // El objeto se borró y la reserva se liberó: no queda nada.
      expect(await ctx.deps.storage.head(storageKey)).toBeNull();
      expect(await ctx.prisma.uploadReservation.count({ where: { id: ticket.id } })).toBe(0);
    }
    expect(
      await ctx.prisma.node.count({ where: { workspaceId: w.ws.workspaceId, type: "FILE" } }),
    ).toBe(0);
    const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: w.ws.workspaceId },
    });
    expect(workspace.storageUsedBytes).toBe(0n);
  });

  it("S3 rechaza subir otro tamaño o tipo que el reservado (van firmados)", async () => {
    const w = await setup("firma");
    const started = await start(w, w.editor.token, "a.txt", 10);
    const ticket = (started.body as { upload: Ticket }).upload;
    expect((await put(ticket, text("mucho más largo que diez bytes"))).ok).toBe(false);
    const wrongType = await fetch(ticket.url ?? "", {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body: text("0123456789"),
    });
    expect(wrongType.ok).toBe(false);
    // Confirmar sin haber subido nada: no se creó nada.
    const done = await api(w.ws, w.editor.token).post(`/uploads/${ticket.id}/complete`);
    expect(done.status).toBe(400);
    expect(
      await ctx.prisma.node.count({ where: { workspaceId: w.ws.workspaceId, type: "FILE" } }),
    ).toBe(0);
  });
});

describe("cuota y límites de la empresa", () => {
  it("rechaza un archivo más grande que el máximo fijado y reserva antes de dar la URL", async () => {
    const w = await setup("cuota");
    // Sin límites no se rechaza nada: la empresa los fija.
    await setLimits(ctx, w.ws.workspaceId, { maxFileMb: 100, storageGb: 50 });
    const maxFile = limitInBaseUnits("maxFileMb", 100);
    const storage = limitInBaseUnits("storageGb", 50);
    expect(maxFile).not.toBeNull();
    expect(storage).not.toBeNull();
    const tooBig = await start(w, w.editor.token, "enorme.zip", Number(maxFile) + 1);
    expect(tooBig.status).toBe(403);
    expect(tooBig.body).toMatchObject({
      error: { code: "LIMIT_REACHED", details: { limit: "maxFileMb" } },
    });

    // Quedan 1000 bytes de cuota: dos reservas de 600 en paralelo no caben las dos.
    await ctx.prisma.workspace.update({
      where: { id: w.ws.workspaceId },
      data: { storageUsedBytes: BigInt(Number(storage)) - 1000n },
    });
    const [a, b] = await Promise.all([
      start(w, w.editor.token, "uno.txt", 600),
      start(w, w.ws.token, "dos.txt", 600),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    const failed = a.status === 403 ? a : b;
    expect(failed.body).toMatchObject({
      error: { code: "LIMIT_REACHED", details: { limit: "storageGb" } },
    });
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(1);
  });
});

describe("nombres repetidos", () => {
  it("rechaza, reemplaza (versión nueva) o conserva ambos", async () => {
    const w = await setup("conflictos");
    const first = await upload(w, w.editor.token, "Informe.txt", text("v1"));
    const nodeId = first.ticket.nodeId;
    // Por defecto: 409 con el nombre existente.
    const dup = await start(w, w.editor.token, "informe.TXT", 2);
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({
      error: { code: "CONFLICT", details: { existing: { id: nodeId } } },
    });
    // Reemplazar: misma entrada, versión 2.
    const replaced = await upload(w, w.editor.token, "Informe.txt", text("versión dos"), {
      onConflict: "replace",
    });
    expect((replaced.done.body as DoneBody).node).toMatchObject({ id: nodeId, currentVersion: 2 });
    expect(await ctx.prisma.fileVersion.count({ where: { nodeId } })).toBe(2);
    expect(
      await ctx.prisma.node.count({ where: { workspaceId: w.ws.workspaceId, type: "FILE" } }),
    ).toBe(1);
    // Conservar ambos: "Informe (2).txt", "Informe (3).txt".
    const second = await upload(w, w.editor.token, "Informe.txt", text("otro"), {
      onConflict: "keep_both",
    });
    expect((second.done.body as DoneBody).node.name).toBe("Informe (2).txt");
    const third = await upload(w, w.editor.token, "INFORME.txt", text("otro más"), {
      onConflict: "keep_both",
    });
    expect((third.done.body as DoneBody).node.name).toBe("INFORME (3).txt");
    // Contra una carpeta no se puede reemplazar.
    await w.owner.post(`/spaces/${w.space.id}/folders`, { name: "Carpeta" });
    expect((await start(w, w.editor.token, "carpeta", 5, { onConflict: "replace" })).status).toBe(
      400,
    );
    const folderClash = await start(w, w.editor.token, "Carpeta.txt", 5);
    expect(folderClash.status).toBe(201);
  });

  it("si alguien toma el nombre mientras se sube, se rechaza (o se numera con keep_both)", async () => {
    const w = await setup("carrera");
    const a = await start(w, w.editor.token, "Carrera.txt", 3);
    const ta = (a.body as { upload: Ticket }).upload;
    await put(ta, text("uno"));
    // Mientras, otra persona termina de subir el mismo nombre.
    await upload(w, w.ws.token, "Carrera.txt", text("dos"));
    expect((await api(w.ws, w.editor.token).post(`/uploads/${ta.id}/complete`)).status).toBe(409);
    expect(await ctx.prisma.uploadReservation.count({ where: { id: ta.id } })).toBe(0);
  });
});

describe("permisos de subida", () => {
  it("solo quien puede editar sube; ver no alcanza; lectores e invitados no", async () => {
    const w = await setup("permisos subida");
    expect((await start(w, w.viewer.token, "a.txt", 5)).status).toBe(403);
    expect((await start(w, w.reader.token, "a.txt", 5)).status).toBe(403); // EDIT del departamento, recortado a COMMENT
    expect((await start(w, w.guest.token, "a.txt", 5)).status).toBe(404);
    expect((await start(w, w.editor.token, "a.txt", 5)).status).toBe(201);
    expect((await start(w, w.ws.token, "b.txt", 5)).status).toBe(201);
  });

  it("un espacio archivado no recibe subidas", async () => {
    const w = await setup("archivado");
    await w.owner.post(`/spaces/${w.space.id}/archive`);
    expect((await start(w, w.editor.token, "a.txt", 5)).status).toBe(409);
  });

  it("si pierde el permiso mientras sube, al confirmar se rechaza", async () => {
    const w = await setup("permiso perdido");
    const started = await start(w, w.editor.token, "a.txt", 3);
    const ticket = (started.body as { upload: Ticket }).upload;
    await put(ticket, text("abc"));
    await ctx.prisma.permission.deleteMany({
      where: { spaceId: w.space.id, departmentId: w.calidad.id },
    });
    expect((await api(w.ws, w.editor.token).post(`/uploads/${ticket.id}/complete`)).status).toBe(
      403,
    );
    expect(
      await ctx.prisma.node.count({ where: { workspaceId: w.ws.workspaceId, type: "FILE" } }),
    ).toBe(0);
  });

  it("las subidas en curso son de quien las empezó: nadie más las ve, las confirma ni las aborta", async () => {
    const w = await setup("reserva ajena");
    const started = await start(w, w.editor.token, "a.txt", 3);
    const ticket = (started.body as { upload: Ticket }).upload;
    await put(ticket, text("abc"));
    for (const token of [w.ws.token, w.viewer.token, w.guest.token]) {
      const a = api(w.ws, token);
      expect((await a.get(`/uploads/${ticket.id}`)).status).toBe(404);
      expect((await a.post(`/uploads/${ticket.id}/complete`)).status).toBe(404);
      expect((await a.delete(`/uploads/${ticket.id}`)).status).toBe(404);
      expect((await a.post(`/uploads/${ticket.id}/parts`, { partNumbers: [1] })).status).toBe(404);
    }
    // De otra empresa, tampoco.
    const outsider = api(w.other, w.other.token);
    expect((await outsider.get(`/uploads/${ticket.id}`)).status).toBe(404);
    expect((await outsider.post(`/uploads/${ticket.id}/complete`)).status).toBe(404);
    expect((await api(w.ws, w.editor.token).post(`/uploads/${ticket.id}/complete`)).status).toBe(
      200,
    );
  });

  it("abortar libera la reserva y borra lo subido", async () => {
    const w = await setup("abortar");
    const started = await start(w, w.editor.token, "a.txt", 3);
    const ticket = (started.body as { upload: Ticket }).upload;
    await put(ticket, text("abc"));
    const reservation = await ctx.prisma.uploadReservation.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect((await api(w.ws, w.editor.token).delete(`/uploads/${ticket.id}`)).status).toBe(204);
    expect(await ctx.deps.storage.head(reservation.storageKey)).toBeNull();
    expect(await ctx.prisma.uploadReservation.count({ where: { id: ticket.id } })).toBe(0);
  });
});

describe("descarga y vista previa", () => {
  async function seeded(label: string) {
    const w = await setup(label);
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
    const doc = await upload(w, w.editor.token, "Manual.pdf", pdf);
    const zip = await upload(
      w,
      w.editor.token,
      "Datos.zip",
      Buffer.from("504b0304140000000000", "hex"),
    );
    return { w, pdf, pdfId: doc.ticket.nodeId, zipId: zip.ticket.nodeId };
  }

  it("da una URL de 60 s que sirve el archivo con el nombre original y como descarga", async () => {
    const { w, pdf, pdfId } = await seeded("descarga");
    const res = await api(w.ws, w.viewer.token).get(`/files/${pdfId}/download`);
    expect(res.status).toBe(200);
    const body = res.body as { url: string; expiresInSeconds: number; fileName: string };
    expect(body).toMatchObject({ expiresInSeconds: 60, fileName: "Manual.pdf" });
    expect(new URL(body.url).searchParams.get("X-Amz-Expires")).toBe("60");
    const file = await fetch(body.url);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; filename="Manual\.pdf"/);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "file.download" },
      }),
    ).toBe(1);
  });

  it("la vista previa es inline solo para PDF, imágenes y texto", async () => {
    const { w, pdfId, zipId } = await seeded("preview");
    const a = api(w.ws, w.viewer.token);
    const inline = (await a.get(`/files/${pdfId}/download?inline=true`)).body as { url: string };
    const file = await fetch(inline.url);
    expect(file.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect((await a.get(`/files/${zipId}/download?inline=true`)).status).toBe(400);
    expect((await a.get(`/files/${zipId}/download`)).status).toBe(200);
    expect((await a.get(`/files/${pdfId}/download?version=9`)).status).toBe(404);
  });

  it("sin permiso no hay URL: espacio privado, invitado, otra empresa", async () => {
    const { w, pdfId } = await seeded("descarga permisos");
    await ctx.prisma.space.update({ where: { id: w.space.id }, data: { isPrivate: true } });
    // El departamento Calidad sigue con EDIT; Vera (sin permiso) ya no ve el espacio.
    expect((await api(w.ws, w.viewer.token).get(`/files/${pdfId}/download`)).status).toBe(404);
    expect((await api(w.ws, w.guest.token).get(`/files/${pdfId}/download`)).status).toBe(404);
    expect((await api(w.ws, w.editor.token).get(`/files/${pdfId}/download`)).status).toBe(200);
    // Una carpeta no es un archivo.
    const folder = (
      (await w.owner.post(`/spaces/${w.space.id}/folders`, { name: "Dir" })).body as {
        node: { id: string };
      }
    ).node;
    expect((await w.owner.get(`/files/${folder.id}/download`)).status).toBe(400);
    // Otra empresa: ni con su propio slug ni con el nuestro.
    const outsider = api(w.other, w.other.token);
    expect((await outsider.get(`/files/${pdfId}/download`)).status).toBe(404);
    expect((await api(w.ws, w.other.token).get(`/files/${pdfId}/download`)).status).toBe(404);
  });

  it("la clave de un archivo ajeno no sirve para descargarlo", async () => {
    const { w, pdfId } = await seeded("clave ajena");
    const version = await ctx.prisma.fileVersion.findFirstOrThrow({ where: { nodeId: pdfId } });
    // Sin firma, el objeto no se puede leer.
    const origin = ctx.deps.storage.origin;
    const direct = await fetch(`${origin}/${process.env.S3_BUCKET ?? ""}/${version.storageKey}`);
    expect(direct.ok).toBe(false);
    expect(w.ws.workspaceId).toBeTruthy();
  });
});

describe("subida por partes", () => {
  it("sube por partes con reanudación y confirma", async () => {
    const w = await setup("partes", { multipartThresholdBytes: 5 * MiB, partSizeBytes: 5 * MiB });
    const content = Buffer.alloc(6 * MiB, "a");
    const started = await start(w, w.editor.token, "Grande.txt", content.length);
    expect(started.status).toBe(201);
    const ticket = (started.body as { upload: Ticket }).upload;
    expect(ticket).toMatchObject({ mode: "multipart", url: null, partSize: 5 * MiB, partCount: 2 });
    const a = api(w.ws, w.editor.token);
    const urls = async (partNumbers: number[]) =>
      (
        (await a.post(`/uploads/${ticket.id}/parts`, { partNumbers })).body as {
          parts: { partNumber: number; url: string }[];
        }
      ).parts;
    // Sube la primera parte y "se corta": al volver, el estado dice qué falta.
    const [first] = await urls([1]);
    expect(
      (await fetch(first?.url ?? "", { method: "PUT", body: content.subarray(0, 5 * MiB) })).ok,
    ).toBe(true);
    const status = (await a.get(`/uploads/${ticket.id}`)).body as {
      uploadedParts: { partNumber: number; size: number }[];
    };
    expect(status.uploadedParts).toEqual([{ partNumber: 1, size: 5 * MiB }]);
    // Confirmar con una parte faltante: rechazado.
    expect((await a.post(`/uploads/${ticket.id}/complete`)).status).toBe(400);
    const [second] = await urls([2]);
    expect(
      (await fetch(second?.url ?? "", { method: "PUT", body: content.subarray(5 * MiB) })).ok,
    ).toBe(true);
    const done = await a.post(`/uploads/${ticket.id}/complete`);
    expect(done.status).toBe(200);
    expect((done.body as DoneBody).version.checksum).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    // Partes fuera de rango y de una subida simple: rechazadas.
    const small = (await start(w, w.editor.token, "chico.txt", 3)).body as { upload: Ticket };
    expect((await a.post(`/uploads/${small.upload.id}/parts`, { partNumbers: [1] })).status).toBe(
      400,
    );
  });
});

describe("limpieza de subidas vencidas", () => {
  it("el job aborta lo subido y libera la cuota reservada", async () => {
    const w = await setup("limpieza", { multipartThresholdBytes: 5 * MiB, partSizeBytes: 5 * MiB });
    const single = (await start(w, w.editor.token, "a.txt", 3)).body as { upload: Ticket };
    await put(single.upload, text("abc"));
    const multi = (await start(w, w.editor.token, "m.txt", 6 * MiB)).body as { upload: Ticket };
    const keys = await ctx.prisma.uploadReservation.findMany({
      where: { workspaceId: w.ws.workspaceId },
      select: { id: true, storageKey: true },
    });
    expect(keys).toHaveLength(2);
    // Todavía vigentes: no se tocan.
    const logger = ctx.deps.logger;
    expect(
      await cleanupExpiredUploads({ prisma: ctx.prisma, logger, storage: ctx.deps.storage }, {}),
    ).toMatchObject({ failed: 0 });
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(2);
    await ctx.prisma.uploadReservation.updateMany({
      where: { workspaceId: w.ws.workspaceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await cleanupExpiredUploads(
      { prisma: ctx.prisma, logger, storage: ctx.deps.storage },
      {},
    );
    expect(result.released).toBeGreaterThanOrEqual(2);
    expect(
      await ctx.prisma.uploadReservation.count({ where: { workspaceId: w.ws.workspaceId } }),
    ).toBe(0);
    for (const key of keys) expect(await ctx.deps.storage.head(key.storageKey)).toBeNull();
    // Una subida vencida no se puede confirmar.
    expect(
      (await api(w.ws, w.editor.token).post(`/uploads/${single.upload.id}/complete`)).status,
    ).toBe(404);
    expect(multi.upload.id).toBeTruthy();
  });
});
