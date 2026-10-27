// Versiones guardadas (fileVersionsKept, si la empresa lo fija): la más antigua pasa a la papelera de versiones, nunca
// la vigente ni las de un documento controlado, y a los 30 días se elimina y libera la cuota.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sweepFileVersions,
  VERSION_TRASH_DAYS,
} from "../../src/modules/files/version-retention.ts";
import { createTestContext, setLimits, type TestContext } from "./helpers.ts";
import { pagesWorld, type PagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const DAY_MS = 24 * 3600 * 1000;
const deps = () => ({ prisma: ctx.prisma, jobs: ctx.deps.jobs });

const keepOnly = (w: PagesWorld, count: number) =>
  setLimits(ctx, w.ws.workspaceId, { fileVersionsKept: count });

/** Un archivo con `versions` versiones (la última vigente), armado directo en la base. */
async function fileWith(w: PagesWorld, versions: number, currentVersion = versions) {
  const id = (await w.makePage()).node.id;
  const membership = w.ownerMembership.id;
  await ctx.prisma.node.update({
    where: { id },
    data: { type: "FILE", currentVersion, mimeType: "application/pdf", sizeBytes: 100n },
  });
  await ctx.prisma.fileVersion.createMany({
    data: Array.from({ length: versions }, (_, index) => ({
      workspaceId: w.ws.workspaceId,
      nodeId: id,
      version: index + 1,
      storageKey: `${w.ws.workspaceId}/${id}/${randomUUID()}`,
      fileName: "manual.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100n,
      checksum: randomUUID(),
      uploadedById: membership,
    })),
  });
  return id;
}

const activeVersions = async (nodeId: string) =>
  (
    await ctx.prisma.fileVersion.findMany({
      where: { nodeId, trashedAt: null, purgedAt: null },
      orderBy: { version: "asc" },
      select: { version: true },
    })
  ).map((row) => row.version);

describe("versiones guardadas", () => {
  it("pasa a la papelera lo que excede el límite, conserva la vigente y oculta del historial", async () => {
    const w = await pagesWorld(ctx, "Versiones plan");
    await keepOnly(w, 3);
    const id = await fileWith(w, 5);
    const result = await sweepFileVersions(deps());
    expect(result.trashed).toBeGreaterThanOrEqual(2);
    expect(await activeVersions(id)).toEqual([3, 4, 5]);
    const history = await w.call("get", w.ws.token, `/files/${id}/versions`);
    expect(history.status).toBe(200);
    expect((history.body as { items: { version: number }[] }).items.map((v) => v.version)).toEqual([
      5, 4, 3,
    ]);
    // Es idempotente.
    expect((await sweepFileVersions(deps())).trashed).toBe(0);
  });

  it("no toca la versión vigente aunque sea una vieja (se restauró una anterior)", async () => {
    const w = await pagesWorld(ctx, "Versiones restaurada");
    await keepOnly(w, 2);
    const id = await fileWith(w, 5, 1);
    await sweepFileVersions(deps());
    expect(await activeVersions(id)).toEqual([1, 4, 5]);
  });

  it("nunca recorta las versiones de un documento controlado", async () => {
    const w = await pagesWorld(ctx, "Versiones controlado");
    await keepOnly(w, 2);
    const id = await fileWith(w, 4);
    await ctx.prisma.controlledDocument.create({
      data: {
        workspaceId: w.ws.workspaceId,
        nodeId: id,
        code: "PRC-CAL-001",
        docType: "PRC",
        createdById: w.ownerMembership.id,
      },
    });
    await sweepFileVersions(deps());
    expect(await activeVersions(id)).toEqual([1, 2, 3, 4]);
  });

  it("sin límite (lo predeterminado) no se recorta nada", async () => {
    const w = await pagesWorld(ctx, "Versiones sin límite");
    await setLimits(ctx, w.ws.workspaceId, { fileVersionsKept: null });
    const id = await fileWith(w, 6);
    await sweepFileVersions(deps());
    expect(await activeVersions(id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it(`a los ${String(VERSION_TRASH_DAYS)} días en la papelera se eliminan y se libera la cuota`, async () => {
    const w = await pagesWorld(ctx, "Versiones vencen");
    await keepOnly(w, 1);
    const id = await fileWith(w, 3);
    await ctx.prisma.workspace.update({
      where: { id: w.ws.workspaceId },
      data: { storageUsedBytes: 300n },
    });
    const now = new Date();
    await sweepFileVersions(deps(), now);
    // Todavía no vencieron: siguen ahí, ocultas, y la cuota no cambió.
    expect(
      await ctx.prisma.fileVersion.count({
        where: { nodeId: id, trashedAt: { not: null }, purgedAt: null },
      }),
    ).toBe(2);
    const later = new Date(now.getTime() + (VERSION_TRASH_DAYS + 1) * DAY_MS);
    // El recorte es de todas las empresas: acá se mira solo lo de esta.
    await sweepFileVersions(deps(), later);
    expect(
      await ctx.prisma.fileVersion.count({ where: { nodeId: id, purgedAt: { not: null } } }),
    ).toBe(2);
    const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: w.ws.workspaceId },
    });
    expect(workspace.storageUsedBytes).toBe(100n);
  });
});
