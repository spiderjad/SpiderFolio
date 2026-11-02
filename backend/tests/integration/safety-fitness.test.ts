// Occupational health and safety, phase 5 (docs/spec/seguridad-salud.md, «Aptitud»): fitness for work is
// health data (safety.health records and sees it; each person sees theirs; the admin role doesn't), with
// its expiry; and the food industry examples created when the module is turned on.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
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

const call = (
  method: "get" | "post" | "put",
  slug: string,
  token: string,
  path: string,
  body?: object,
) =>
  request(app)
    [method](`/api/v1/w/${slug}${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("aptitud", () => {
  it("solo con datos de salud; cada uno ve la suya; con vencimiento y sin el estado en la auditoría", async () => {
    const ws = await createWorkspace(ctx, "Aptitud");
    expect((await call("put", ws.slug, ws.token, "/admin/safety", { enabled: true })).status).toBe(
      200,
    );
    const worker = await addMember(ctx, ws, { base: "MEMBER" });
    const other = await addMember(ctx, ws, { base: "MEMBER" });
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    const path = `/safety/people/${worker.membership.id}/fitness`;
    const body = {
      status: "APT_RESTRICTED",
      validUntil: "2027-06-30",
      restrictions: "Sin cargas de más de 15 kg",
    };
    expect((await call("post", ws.slug, admin.token, path, body)).status).toBe(403);
    expect((await call("post", ws.slug, ws.token, path, body)).status).toBe(204);
    const own = await call("get", ws.slug, worker.token, path);
    expect(own.status).toBe(200);
    expect(
      (own.body as { items: { status: string; restrictions: string }[] }).items[0],
    ).toMatchObject({
      status: "APT_RESTRICTED",
      restrictions: "Sin cargas de más de 15 kg",
    });
    expect((await call("get", ws.slug, other.token, path)).status).toBe(404);
    expect((await call("get", ws.slug, admin.token, path)).status).toBe(404);
    const record = await ctx.prisma.safetyFitness.findFirstOrThrow({
      where: { membershipId: worker.membership.id },
    });
    expect(
      await ctx.prisma.expiry.count({ where: { kind: "safety.fitness", subjectId: record.id } }),
    ).toBe(1);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, action: "safety.fitness.record" },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("APT");
    // A new one replaces it: the earlier one stops telling.
    expect(
      (await call("post", ws.slug, ws.token, path, { status: "APT", validUntil: null })).status,
    ).toBe(204);
    const expiry = await ctx.prisma.expiry.findFirstOrThrow({
      where: { kind: "safety.fitness", subjectId: record.id },
    });
    expect(expiry.resolvedAt).not.toBeNull();
  });
});

describe("ejemplos del sector alimentario", () => {
  it("al activar con ejemplos: EPIs y la inspección mensual, una sola vez", async () => {
    const ws = await createWorkspace(ctx, "Ejemplos SST");
    await call("put", ws.slug, ws.token, "/admin/safety", { enabled: true, examples: true });
    await call("put", ws.slug, ws.token, "/admin/safety", { enabled: true, examples: true });
    expect(await ctx.prisma.safetyItem.count({ where: { workspaceId: ws.workspaceId } })).toBe(6);
    expect(
      await ctx.prisma.node.count({
        where: {
          workspaceId: ws.workspaceId,
          type: "FORM",
          name: "Inspección de seguridad mensual",
        },
      }),
    ).toBe(1);
  });
});
