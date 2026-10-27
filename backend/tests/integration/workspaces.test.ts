// Alta de workspace, límites, inicio y health.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createWorkspace as createWorkspaceRecord } from "../../src/modules/workspaces/workspaces.service.ts";
import {
  createTestContext,
  createUser,
  createWorkspace,
  setLimits,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe("createWorkspaceWithOwner", () => {
  it("crea workspace, 4 roles de sistema, membresía OWNER y auditoría, sin límites", async () => {
    const owner = await createUser(ctx.prisma);
    const created = await createWorkspaceRecord(ctx.prisma, {
      name: "Lácteos del Sur",
      ownerUserId: owner.id,
      settings: { timezone: "America/Argentina/Buenos_Aires", locale: "es" },
    });
    expect(created.slug).toMatch(/^lacteos-del-sur(-\d+)?$/);

    const roles = await ctx.prisma.role.findMany({ where: { workspaceId: created.workspaceId } });
    expect(roles.map((r) => r.base).sort()).toEqual(["ADMIN", "GUEST", "MEMBER", "OWNER"]);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    const admin = roles.find((r) => r.base === "ADMIN");
    expect(admin?.capabilities).toContain("workspace.settings");

    const membership = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: created.membershipId },
      include: { role: true },
    });
    expect(membership).toMatchObject({ userId: owner.id, seatType: "FULL", status: "ACTIVE" });
    expect(membership.role.base).toBe("OWNER");

    const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
      where: { id: created.workspaceId },
    });
    // Sin planes: ningún límite por defecto.
    expect(workspace.limits).toEqual({});

    const log = await ctx.prisma.auditLog.findFirst({
      where: { workspaceId: created.workspaceId, action: "workspace.create" },
    });
    expect(log?.actorId).toBe(owner.id);
  });

  it("resuelve colisiones y reservados con sufijos", async () => {
    const owner = await createUser(ctx.prisma);
    const input = {
      name: "Admin",
      ownerUserId: owner.id,
      settings: { timezone: "UTC", locale: "es" as const },
    };
    const first = await createWorkspaceRecord(ctx.prisma, input);
    const second = await createWorkspaceRecord(ctx.prisma, input);
    expect(first.slug).toBe("admin-2");
    expect(second.slug).toBe("admin-3");
  });

  it("dos altas simultáneas con el mismo nombre terminan con slugs distintos", async () => {
    const owner = await createUser(ctx.prisma);
    const input = {
      name: "Carrera",
      ownerUserId: owner.id,
      settings: { timezone: "UTC", locale: "es" as const },
    };
    const results = await Promise.all([
      createWorkspaceRecord(ctx.prisma, input),
      createWorkspaceRecord(ctx.prisma, input),
    ]);
    expect(new Set(results.map((r) => r.slug)).size).toBe(2);
  });

  it("rechaza una zona horaria inválida", async () => {
    const owner = await createUser(ctx.prisma);
    await expect(
      createWorkspaceRecord(ctx.prisma, {
        name: "X",
        ownerUserId: owner.id,
        settings: { timezone: "Marte/Olympus", locale: "es" },
      }),
    ).rejects.toThrow();
  });
});

describe("GET /overview (inicio)", () => {
  it("almacenamiento contra el límite que fija la empresa y ceros sin datos de ejemplo", async () => {
    const app = createApp(ctx.deps);
    const ws = await createWorkspace(ctx, "Inicio SA");
    await setLimits(ctx, ws.workspaceId, { storageGb: 5 });
    await ctx.prisma.workspace.update({
      where: { id: ws.workspaceId },
      data: { storageUsedBytes: 1024n ** 3n },
    });
    const res = await request(app)
      .get(`/api/v1/w/${ws.slug}/overview`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      company: {
        storage: { usedBytes: 1024 ** 3, limitBytes: 5 * 1024 ** 3 },
        kpis: { publishedDocuments: 0, inReview: 0, drafts: 0 },
        topDocuments: [],
      },
    });
  });

  it("sin límite fijado, el almacenamiento no tiene tope", async () => {
    const app = createApp(ctx.deps);
    const ws = await createWorkspace(ctx, "Activa SA");
    const res = await request(app)
      .get(`/api/v1/w/${ws.slug}/overview`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(res.body).toMatchObject({ company: { storage: { limitBytes: null } } });
  });

  it("las respuestas de la API no se guardan en caché", async () => {
    const res = await request(createApp(ctx.deps)).get("/api/health");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /api/health", () => {
  it("responde ok con la base arriba", async () => {
    const res = await request(createApp(ctx.deps)).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});
