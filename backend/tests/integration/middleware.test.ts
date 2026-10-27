// authMiddleware, tenantMiddleware y requireCapability por HTTP.
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { signAccessToken } from "../../src/lib/jwt.ts";
import { authMiddleware } from "../../src/middleware/auth.ts";
import { errorHandler } from "../../src/middleware/error-handler.ts";
import { requireCapability } from "../../src/middleware/require-capability.ts";
import { requestId } from "../../src/middleware/request-id.ts";
import { tenantMiddleware } from "../../src/middleware/tenant.ts";
import { bodyOf, errorOf } from "../http.ts";
import {
  createTestContext,
  createUser,
  createWorkspace,
  loginAs,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;
let ws: Awaited<ReturnType<typeof createWorkspace>>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
  ws = await createWorkspace(ctx, "Middleware SA");
});

afterAll(async () => {
  await ctx.close();
});

const get = (token?: string) => {
  const req = request(app).get(`/api/v1/w/${ws.slug}/`);
  return token === undefined ? req : req.set("Authorization", `Bearer ${token}`);
};

describe("authMiddleware", () => {
  it("sin token, con token basura o con otro esquema: 401", async () => {
    for (const res of [
      await get(),
      await get("basura"),
      await request(app).get(`/api/v1/w/${ws.slug}/`).set("Authorization", `Basic ${ws.token}`),
    ]) {
      expect(res.status).toBe(401);
      expect(errorOf(res).code).toBe("UNAUTHENTICATED");
    }
  });

  it("con token válido: 200", async () => {
    expect((await get(ws.token)).status).toBe(200);
  });

  it("si la sesión se revoca, el JWT vigente deja de servir", async () => {
    const token = await loginAs(ctx, ws.owner.id);
    expect((await get(token)).status).toBe(200);
    await ctx.prisma.session.updateMany({
      where: { userId: ws.owner.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect((await get(token)).status).toBe(401);
    ws.token = await loginAs(ctx, ws.owner.id);
  });

  it("una sesión vencida o de otro usuario: 401", async () => {
    const session = await ctx.prisma.session.create({
      data: {
        userId: ws.owner.id,
        familyId: "f",
        familyCreatedAt: new Date(),
        tokenHash: `vencida-${String(Date.now())}`,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const { JWT_ACCESS_SECRET: secret } = ctx.deps.env;
    const expired = signAccessToken({ userId: ws.owner.id, sessionId: session.id }, secret, 60);
    expect((await get(expired)).status).toBe(401);
    const other = await createUser(ctx.prisma);
    const mixed = signAccessToken({ userId: other.id, sessionId: session.id }, secret, 60);
    expect((await get(mixed)).status).toBe(401);
  });
});

describe("tenantMiddleware", () => {
  it("alguien que no es miembro recibe 404", async () => {
    const outsider = await createUser(ctx.prisma);
    expect((await get(await loginAs(ctx, outsider.id))).status).toBe(404);
  });

  it("un miembro suspendido recibe 404", async () => {
    const member = await createUser(ctx.prisma);
    const role = await ctx.prisma.role.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, base: "MEMBER" },
    });
    await ctx.prisma.membership.create({
      data: {
        userId: member.id,
        workspaceId: ws.workspaceId,
        roleId: role.id,
        status: "SUSPENDED",
      },
    });
    expect((await get(await loginAs(ctx, member.id))).status).toBe(404);
  });

  it("un workspace borrado (deletedAt) es 404", async () => {
    const gone = await createWorkspace(ctx, "Borrada");
    await ctx.prisma.workspace.update({
      where: { id: gone.workspaceId },
      data: { deletedAt: new Date() },
    });
    const res = await request(app)
      .get(`/api/v1/w/${gone.slug}/`)
      .set("Authorization", `Bearer ${gone.token}`);
    expect(res.status).toBe(404);
  });

  it("arma el contexto con rol, capacidades y departamentos (vacío hasta el Módulo 2)", async () => {
    const res = await get(ws.token);
    expect(bodyOf(res).membership).toMatchObject({
      id: ws.membershipId,
      role: { base: "OWNER" },
      departmentIds: [],
    });
    expect(bodyOf(res).membership.capabilities).toContain("workspace.settings");
  });
});

describe("requireCapability", () => {
  const appWithGuard = () => {
    const guarded = express();
    guarded.use(requestId);
    const router = express.Router({ mergeParams: true });
    router.use(authMiddleware(ctx.deps), tenantMiddleware(ctx.prisma));
    router.get("/seguridad", requireCapability("security.manage"), (_req, res) => {
      res.json({ ok: true });
    });
    guarded.use("/w/:workspaceSlug", router);
    guarded.use(errorHandler(ctx.deps.logger));
    return guarded;
  };

  it("con la capacidad pasa; sin ella, 403", async () => {
    const guarded = appWithGuard();
    const owner = await request(guarded)
      .get(`/w/${ws.slug}/seguridad`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(owner.status).toBe(200);

    const admin = await createUser(ctx.prisma);
    const memberRole = await ctx.prisma.role.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, base: "MEMBER" },
    });
    await ctx.prisma.membership.create({
      data: { userId: admin.id, workspaceId: ws.workspaceId, roleId: memberRole.id },
    });
    const res = await request(guarded)
      .get(`/w/${ws.slug}/seguridad`)
      .set("Authorization", `Bearer ${await loginAs(ctx, admin.id)}`);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe("FORBIDDEN");
  });
});
