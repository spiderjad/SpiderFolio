// ctx.notify (docs/spec/plugins.md): bell notices from a plugin to the company's owners and
// administrators, or to some of its members. Only the plugin's own company: members of another one
// listed by id are ignored, and nobody else sees the notices.
import { defineBackendPlugin } from "@spiderfolio/plugin-sdk/backend";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  testPluginRuntime,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
const PLUGIN = "test-notify";
const plugin = defineBackendPlugin({ id: PLUGIN, version: "1.0.0" });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function company(name: string) {
  const ws = await createWorkspace(ctx, name);
  const admin = await addMember(ctx, ws, { base: "ADMIN", name: "Adela Admin" });
  const member = await addMember(ctx, ws, { name: "Mario Miembro" });
  const guest = await addMember(ctx, ws, { base: "GUEST", name: "Gina Invitada" });
  const suspended = await addMember(ctx, ws, { base: "ADMIN", status: "SUSPENDED" });
  return { ws, admin, member, guest, suspended };
}

const noticesOf = (membershipId: string) =>
  ctx.prisma.notification.findMany({ where: { membershipId, kind: "plugin" } });

describe("ctx.notify", () => {
  it("«admins» llega a propietarios y administradores activos, y a nadie más", async () => {
    const a = await company("Avisos A");
    const runtime = await testPluginRuntime(ctx, [plugin], [a.ws.workspaceId]);
    const sent = await runtime.contextFor(a.ws.workspaceId, PLUGIN).notify({
      to: "admins",
      code: "sync-blocked",
    });
    expect(sent).toBe(2);
    expect(await noticesOf(a.ws.membershipId)).toEqual([
      expect.objectContaining({ detail: `${PLUGIN}:sync-blocked`, workspaceId: a.ws.workspaceId }),
    ]);
    expect(await noticesOf(a.admin.membership.id)).toHaveLength(1);
    for (const other of [a.member, a.guest, a.suspended]) {
      expect(await noticesOf(other.membership.id)).toHaveLength(0);
    }
  });

  it("a personas concretas solo de su empresa: las de otra se ignoran", async () => {
    const a = await company("Avisos personas A");
    const b = await company("Avisos personas B");
    const runtime = await testPluginRuntime(ctx, [plugin], [a.ws.workspaceId, b.ws.workspaceId]);
    const sent = await runtime.contextFor(a.ws.workspaceId, PLUGIN).notify({
      to: { membershipIds: [a.member.membership.id, b.member.membership.id, b.ws.membershipId] },
      code: "account-linked",
    });
    expect(sent).toBe(1);
    expect(await noticesOf(a.member.membership.id)).toHaveLength(1);
    expect(await noticesOf(b.member.membership.id)).toHaveLength(0);
    expect(await noticesOf(b.ws.membershipId)).toHaveLength(0);
    expect(
      await ctx.prisma.notification.count({
        where: { workspaceId: b.ws.workspaceId, kind: "plugin" },
      }),
    ).toBe(0);
  });

  it("con la misma clave avisa una sola vez por persona", async () => {
    const a = await company("Avisos clave");
    const pluginCtx = (await testPluginRuntime(ctx, [plugin], [a.ws.workspaceId])).contextFor(
      a.ws.workspaceId,
      PLUGIN,
    );
    const notify = (notice: Parameters<typeof pluginCtx.notify>[0]) => pluginCtx.notify(notice);
    expect(await notify({ to: "admins", code: "sync-failed", dedupeKey: "2026-10-29" })).toBe(2);
    expect(await notify({ to: "admins", code: "sync-failed", dedupeKey: "2026-10-29" })).toBe(0);
    expect(await notify({ to: "admins", code: "sync-failed", dedupeKey: "2026-10-30" })).toBe(2);
    expect(await noticesOf(a.ws.membershipId)).toHaveLength(2);
  });

  it("rechaza códigos y claves que no son del formato", async () => {
    const a = await company("Avisos formato");
    const pluginCtx = (await testPluginRuntime(ctx, [plugin], [a.ws.workspaceId])).contextFor(
      a.ws.workspaceId,
      PLUGIN,
    );
    const notify = (notice: Parameters<typeof pluginCtx.notify>[0]) => pluginCtx.notify(notice);
    await expect(notify({ to: "admins", code: "Con Espacios" })).rejects.toThrow();
    await expect(notify({ to: "admins", code: "ok", dedupeKey: "<script>" })).rejects.toThrow();
    await expect(notify({ to: { membershipIds: [] }, code: "ok" })).rejects.toThrow();
  });

  it("la campanita lo muestra solo en su empresa", async () => {
    const a = await company("Avisos campanita A");
    const b = await company("Avisos campanita B");
    const runtime = await testPluginRuntime(ctx, [plugin], [a.ws.workspaceId]);
    await runtime
      .contextFor(a.ws.workspaceId, PLUGIN)
      .notify({ to: "admins", code: "sync-blocked" });
    const app = createApp({ ...ctx.deps, plugins: runtime });
    const list = async (slug: string, token: string) =>
      (
        (
          await request(app)
            .get(`/api/v1/w/${slug}/notifications`)
            .set("Authorization", `Bearer ${token}`)
        ).body as { items: { kind: string; detail: string | null }[] }
      ).items;
    expect(await list(a.ws.slug, a.ws.token)).toEqual([
      expect.objectContaining({ kind: "plugin", detail: `${PLUGIN}:sync-blocked` }),
    ]);
    expect(await list(b.ws.slug, b.ws.token)).toEqual([]);
    const foreign = await request(app)
      .get(`/api/v1/w/${a.ws.slug}/notifications`)
      .set("Authorization", `Bearer ${b.ws.token}`);
    expect(foreign.status).toBe(404);
  });
});
