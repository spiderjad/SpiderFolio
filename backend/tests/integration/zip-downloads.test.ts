// Descarga de ZIP de una selección: token de descarga (solo quien lo pidió, un solo uso, vence,
// permisos que se vuelven a resolver al canjear) y ZIP grande en segundo plano.
import { Readable } from "node:stream";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as yauzl from "yauzl";
import { createApp } from "../../src/app.ts";
import { sha256 } from "../../src/lib/crypto.ts";
import { fileMessages } from "../../src/i18n/index.ts";
import { createLogger } from "../../src/lib/logger.ts";
import {
  DIRECT_ZIP_MAX_BYTES,
  resolveExportLink,
} from "../../src/modules/downloads/downloads.service.ts";
import { runZipExport } from "../../src/modules/downloads/zip-export.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const call = (slug: string, token: string, method: "get" | "post", path: string, body?: object) =>
  request(app)
    [method](`/api/v1/w/${slug}${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

/** Un workspace con un espacio, un archivo de verdad en S3 y otro de 600 MB (solo en la base). */
async function world() {
  const ws = await createWorkspace(ctx, "ZIP de prueba");
  const edith = await addMember(ctx, ws, { name: "Edith Editora" });
  const created = await call(ws.slug, ws.token, "post", "/spaces", {
    name: "Calidad",
    isPrivate: true,
  });
  expect(created.status).toBe(201);
  const spaceId = (created.body as { space: { id: string } }).space.id;

  const content = Buffer.from("contenido del procedimiento");
  const key = `${ws.workspaceId}/test-zip/${Math.random().toString(36).slice(2)}`;
  await ctx.deps.storage.putStream(key, Readable.from([content]), {
    size: content.length,
    contentType: "text/plain",
  });
  const owner = await ctx.prisma.membership.findFirstOrThrow({
    where: { workspaceId: ws.workspaceId, role: { base: "OWNER" } },
  });
  const file = async (name: string, size: number, storageKey: string) => {
    const node = await ctx.prisma.node.create({
      data: {
        workspaceId: ws.workspaceId,
        spaceId,
        type: "FILE",
        name,
        nameKey: name.toLowerCase(),
        position: `a${name}`,
        createdById: owner.id,
        updatedById: owner.id,
        currentVersion: 1,
        mimeType: "text/plain",
        sizeBytes: BigInt(size),
      },
    });
    await ctx.prisma.fileVersion.create({
      data: {
        workspaceId: ws.workspaceId,
        nodeId: node.id,
        version: 1,
        storageKey,
        fileName: name,
        mimeType: "text/plain",
        sizeBytes: BigInt(size),
        checksum: "0".repeat(64),
        uploadedById: owner.id,
      },
    });
    return node;
  };
  const small = await file("Procedimiento.txt", content.length, key);
  const huge = await file("Enorme.bin", DIRECT_ZIP_MAX_BYTES + 1, `${key}-enorme`);
  await ctx.prisma.permission.create({
    data: {
      workspaceId: ws.workspaceId,
      spaceId,
      membershipId: edith.membership.id,
      level: "VIEW",
      grantedById: owner.id,
    },
  });
  return { ws, edith, spaceId, small, huge, content, ownerMembershipId: owner.id };
}
type World = Awaited<ReturnType<typeof world>>;

const pedir = (w: World, token: string, nodeIds: string[]) =>
  call(w.ws.slug, token, "post", `/spaces/${w.spaceId}/download-zip`, { nodeIds });

function binary(
  res: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
}

async function entriesOf(zip: Buffer): Promise<Map<string, string>> {
  const archive = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (error, opened) => {
      if (error !== null) reject(error);
      else resolve(opened);
    });
  });
  const out = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    archive.on("error", reject);
    archive.on("end", resolve);
    archive.on("entry", (entry: yauzl.Entry) => {
      archive.openReadStream(entry, (error, stream) => {
        if (error !== null) {
          reject(error);
          return;
        }
        const parts: Buffer[] = [];
        stream.on("data", (part: Buffer) => parts.push(part));
        stream.on("end", () => {
          out.set(entry.fileName, Buffer.concat(parts).toString("utf8"));
          archive.readEntry();
        });
        stream.on("error", reject);
      });
    });
    archive.readEntry();
  });
  return out;
}

interface Direct {
  mode: "direct";
  url: string;
}

const download = (url: string) =>
  request(app)
    .get(url)
    .buffer(true)
    .parse((res, callback) => {
      binary(res, callback);
    });

describe("descarga directa con token", () => {
  it("el token se canjea con un enlace normal y entrega el ZIP en flujo", async () => {
    const w = await world();
    const res = await pedir(w, w.ws.token, [w.small.id]);
    expect(res.status).toBe(200);
    const body = res.body as Direct;
    expect(body.mode).toBe("direct");
    // El enlace no lleva credenciales ni datos de la persona: solo un token opaco.
    expect(body.url).toMatch(/^\/api\/v1\/downloads\/[A-Za-z0-9_-]{40,}$/);
    // El token no se guarda en claro.
    const stored = await ctx.prisma.downloadToken.findMany({
      where: { workspaceId: w.ws.workspaceId },
    });
    expect(stored).toHaveLength(1);
    expect(body.url.endsWith(stored[0]?.tokenHash ?? "")).toBe(false);

    const zip = await download(body.url);
    expect(zip.status).toBe(200);
    expect(zip.headers["content-type"]).toContain("application/zip");
    expect(zip.headers["content-disposition"]).toContain("attachment");
    const buffer = zip.body as Buffer;
    expect(Number(zip.headers["content-length"])).toBe(buffer.length);
    expect((await entriesOf(buffer)).get("Procedimiento.txt")).toBe(w.content.toString());
  });

  it("es de un solo uso", async () => {
    const w = await world();
    const { url } = (await pedir(w, w.ws.token, [w.small.id])).body as Direct;
    expect((await download(url)).status).toBe(200);
    expect((await download(url)).status).toBe(404);
  });

  it("dos canjes simultáneos: solo uno entrega el ZIP", async () => {
    const w = await world();
    const { url } = (await pedir(w, w.ws.token, [w.small.id])).body as Direct;
    const results = await Promise.all([download(url), download(url), download(url)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404]);
  });

  it("vence", async () => {
    const w = await world();
    const { url } = (await pedir(w, w.ws.token, [w.small.id])).body as Direct;
    await ctx.prisma.downloadToken.updateMany({
      where: { workspaceId: w.ws.workspaceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await download(url)).status).toBe(404);
  });

  it("un token inventado o ajeno no sirve, ni con otro workspace", async () => {
    const w = await world();
    const other = await world();
    expect((await download(`/api/v1/downloads/${"x".repeat(43)}`)).status).toBe(404);
    // Pedir sobre un espacio ajeno es un 404 (aislamiento entre empresas).
    const foreign = await call(
      w.ws.slug,
      other.ws.token,
      "post",
      `/spaces/${w.spaceId}/download-zip`,
      { nodeIds: [w.small.id] },
    );
    expect(foreign.status).toBe(404);
    // Nadie sin acceso al espacio puede pedir el ZIP.
    const stranger = await addMember(ctx, w.ws, { name: "Sin acceso" });
    expect((await pedir(w, stranger.token, [w.small.id])).status).toBe(404);
  });

  it("al canjear se vuelven a resolver los permisos de quien lo pidió", async () => {
    const w = await world();
    // Edith pide el ZIP con acceso de lectura…
    const { url } = (await pedir(w, w.edith.token, [w.small.id])).body as Direct;
    // …y antes de canjearlo le quitan el acceso: el token no le devuelve nada.
    await ctx.prisma.permission.deleteMany({
      where: { workspaceId: w.ws.workspaceId, membershipId: w.edith.membership.id },
    });
    expect((await download(url)).status).toBe(404);
  });

  it("si quien lo pidió ya no es miembro activo, no sirve", async () => {
    const w = await world();
    const { url } = (await pedir(w, w.edith.token, [w.small.id])).body as Direct;
    await ctx.prisma.membership.update({
      where: { id: w.edith.membership.id },
      data: { status: "SUSPENDED" },
    });
    expect((await download(url)).status).toBe(404);
  });

  it("el token vale solo para lo que se pidió: no sirve para pedir otra selección", async () => {
    const w = await world();
    const { url } = (await pedir(w, w.ws.token, [w.small.id])).body as Direct;
    const zip = await download(url);
    const names = [...(await entriesOf(zip.body as Buffer)).keys()];
    expect(names).toEqual(["Procedimiento.txt"]);
  });
});

describe("ZIP grande en segundo plano", () => {
  it("más de 500 MB: no hay token, queda pendiente y se encola el trabajo", async () => {
    const w = await world();
    const res = await pedir(w, w.ws.token, [w.small.id, w.huge.id]);
    expect(res.status).toBe(200);
    const body = res.body as { mode: string; exportId: string };
    expect(body.mode).toBe("background");
    const row = await ctx.prisma.zipExport.findUniqueOrThrow({ where: { id: body.exportId } });
    expect(row.status).toBe("PENDING");
    expect(row.membershipId).toBe(w.ownerMembershipId);
    expect(await ctx.prisma.downloadToken.count({ where: { workspaceId: w.ws.workspaceId } })).toBe(
      0,
    );
  });

  it("el worker guarda el ZIP en el bucket de sistema y avisa; el enlace vence y solo sirve a quien sigue en el equipo", async () => {
    const w = await world();
    const saved = new Map<string, Buffer>();
    const systemStorage = {
      putStream: async (key: string, body: Readable) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
        saved.set(key, Buffer.concat(chunks));
      },
      delete: (key: string) => {
        saved.delete(key);
        return Promise.resolve();
      },
      presignGet: (key: string) => Promise.resolve(`https://s3.test/${key}?firma=1`),
    };
    const enqueue = vi.fn(() => Promise.resolve());
    const exportRow = await ctx.prisma.zipExport.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: w.ownerMembershipId,
        nodeIds: [w.small.id],
        status: "PENDING",
        fileName: "Calidad.zip",
      },
    });
    const deps = {
      prisma: ctx.prisma,
      logger: createLogger(ctx.deps.env),
      storage: ctx.deps.storage,
      systemStorage,
      jobs: { enqueue },
    };
    expect(await runZipExport(deps, { exportId: exportRow.id })).toBe(true);
    // Un job repetido no genera dos veces.
    expect(await runZipExport(deps, { exportId: exportRow.id })).toBe(false);

    const done = await ctx.prisma.zipExport.findUniqueOrThrow({ where: { id: exportRow.id } });
    expect(done.status).toBe("DONE");
    expect(done.storageKey).not.toBeNull();
    // Siete días de retención.
    const days = ((done.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const stored = saved.get(done.storageKey ?? "");
    expect((await entriesOf(stored ?? Buffer.alloc(0))).get("Procedimiento.txt")).toBe(
      w.content.toString(),
    );
    expect(enqueue).toHaveBeenCalledWith("email-send", {
      kind: "export-ready",
      exportId: exportRow.id,
    });

    // El enlace del email (el worker guarda solo su hash) lleva a una URL de descarga.
    const token = "t".repeat(43);
    await ctx.prisma.zipExport.update({
      where: { id: exportRow.id },
      data: { linkHash: sha256(token) },
    });
    const linkDeps = { prisma: ctx.prisma, systemStorage };
    expect(await resolveExportLink(linkDeps, token)).toContain(done.storageKey ?? "");
    await expect(resolveExportLink(linkDeps, "otro".repeat(12))).rejects.toMatchObject({
      status: 404,
    });
    // Vencido.
    await expect(
      resolveExportLink(linkDeps, token, new Date(Date.now() + 8 * 86_400_000)),
    ).rejects.toMatchObject({ status: 404 });
    // Quien lo pidió ya no está en el equipo.
    await ctx.prisma.membership.update({
      where: { id: w.ownerMembershipId },
      data: { status: "SUSPENDED" },
    });
    await expect(resolveExportLink(linkDeps, token)).rejects.toMatchObject({ status: 404 });
  });

  it("si quien lo pidió perdió el acceso, el trabajo falla y avisa", async () => {
    const w = await world();
    const enqueue = vi.fn(() => Promise.resolve());
    const exportRow = await ctx.prisma.zipExport.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: w.edith.membership.id,
        nodeIds: [w.small.id],
        status: "PENDING",
        fileName: "Calidad.zip",
      },
    });
    await ctx.prisma.permission.deleteMany({
      where: { workspaceId: w.ws.workspaceId, membershipId: w.edith.membership.id },
    });
    const ok = await runZipExport(
      {
        prisma: ctx.prisma,
        logger: createLogger(ctx.deps.env),
        storage: ctx.deps.storage,
        systemStorage: { putStream: () => Promise.resolve(), delete: () => Promise.resolve() },
        jobs: { enqueue },
      },
      { exportId: exportRow.id },
    );
    expect(ok).toBe(false);
    const row = await ctx.prisma.zipExport.findUniqueOrThrow({ where: { id: exportRow.id } });
    expect(row.status).toBe("FAILED");
    expect(row.storageKey).toBeNull();
    expect(enqueue).toHaveBeenCalledWith("email-send", {
      kind: "export-failed",
      exportId: exportRow.id,
    });
  });

  it("si un archivo ya no está en el bucket, el trabajo falla sin romper nada y avisa", async () => {
    const w = await world();
    const enqueue = vi.fn(() => Promise.resolve());
    const exportRow = await ctx.prisma.zipExport.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: w.ownerMembershipId,
        // "Enorme.bin" only exists in the database: its GetObject fails with NoSuchKey mid-upload.
        nodeIds: [w.small.id, w.huge.id],
        status: "PENDING",
        fileName: "Calidad.zip",
      },
    });
    const ok = await runZipExport(
      {
        prisma: ctx.prisma,
        logger: createLogger(ctx.deps.env),
        storage: ctx.deps.storage,
        systemStorage: ctx.deps.systemStorage,
        jobs: { enqueue },
      },
      { exportId: exportRow.id },
    );
    expect(ok).toBe(false);
    const row = await ctx.prisma.zipExport.findUniqueOrThrow({ where: { id: exportRow.id } });
    expect(row.status).toBe("FAILED");
    expect(row.storageKey).toBeNull();
    expect(row.error).toBe(fileMessages.zipFileMissing);
    expect(enqueue).toHaveBeenCalledWith("email-send", {
      kind: "export-failed",
      exportId: exportRow.id,
    });
  });
});
