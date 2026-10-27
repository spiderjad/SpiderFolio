// 2FA obligatoria: la decide un plugin activo con el gancho mfaRequired (Políticas de seguridad avanzadas
// es el plugin real; acá, uno de prueba con la misma regla). Se aplica como MFA_SETUP_REQUIRED a quien le
// alcanza y no la configuró, nunca a cuentas de PIN; sin licencia el plugin no se activa y no se exige
// nada. El backoffice /internal exige 2FA al staff (núcleo).
import { defineBackendPlugin } from "@spiderfolio/plugin-sdk/backend";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app.ts";
import { errorOf } from "../http.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
  loginAs,
  testPluginRuntime,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const PLUGIN_ID = "test-mfa";
const Policy = z.enum(["off", "admins", "all"]);
const SENSITIVE = ["members.manage", "security.manage", "workspace.settings", "roles.manage"];

/** Plugin de prueba: exige 2FA según el ajuste «require2fa» de cada workspace. */
const mfaPlugin = defineBackendPlugin({
  id: PLUGIN_ID,
  version: "0.0.0",
  hooks: {
    async mfaRequired(pluginCtx, subject) {
      const policy = (await pluginCtx.settings.get("require2fa", Policy)) ?? "off";
      if (policy === "off" || subject.userKind === "PIN") return false;
      const administrative =
        subject.roleBase === "OWNER" ||
        subject.roleBase === "ADMIN" ||
        SENSITIVE.some((capability) => subject.capabilities.includes(capability));
      return policy === "admins" ? administrative : subject.roleBase !== "GUEST" || administrative;
    },
  },
});

const setPolicy = (ws: TestWorkspace, require2fa: "off" | "admins" | "all") =>
  ctx.prisma.pluginSetting.create({
    data: {
      workspaceId: ws.workspaceId,
      pluginId: PLUGIN_ID,
      key: "require2fa",
      value: require2fa,
    },
  });

/** App con el plugin de prueba, con licencia solo en `licensed`. */
async function appFor(licensed: TestWorkspace[]) {
  return createApp({
    ...ctx.deps,
    plugins: await testPluginRuntime(
      ctx,
      [mfaPlugin],
      licensed.map((ws) => ws.workspaceId),
    ),
  });
}

const withTwoFactor = (userId: string) =>
  ctx.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });

describe("aplicar la política del plugin", () => {
  it("«admins»: bloquea a propietarios, administradores y roles sensibles sin 2FA", async () => {
    const ws = await createWorkspace(ctx, "Exigir admins");
    await setPolicy(ws, "admins");
    const app = await appFor([ws]);
    const call = (token: string) =>
      request(app).get(`/api/v1/w/${ws.slug}/spaces`).set("Authorization", `Bearer ${token}`);
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    const member = await addMember(ctx, ws);
    const custom = await ctx.prisma.role.create({
      data: {
        workspaceId: ws.workspaceId,
        name: "Gestión de personas",
        base: "MEMBER",
        capabilities: ["members.manage"],
      },
    });
    const manager = await addMember(ctx, ws, { roleId: custom.id });

    const owner = await call(ws.token);
    expect(owner.status).toBe(403);
    expect(errorOf(owner).code).toBe("MFA_SETUP_REQUIRED");
    expect(errorOf(await call(admin.token)).code).toBe("MFA_SETUP_REQUIRED");
    expect(errorOf(await call(manager.token)).code).toBe("MFA_SETUP_REQUIRED");
    expect((await call(member.token)).status).toBe(200);

    // /auth sigue disponible (ahí está el alta) y avisa que la política le alcanza.
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${ws.token}`);
    expect(me.status).toBe(200);
    const memberships = (
      me.body as { memberships: { workspace: { id: string }; mfaRequired: boolean }[] }
    ).memberships;
    expect(memberships.find((m) => m.workspace.id === ws.workspaceId)?.mfaRequired).toBe(true);

    await withTwoFactor(ws.owner.id);
    expect((await call(ws.token)).status).toBe(200);
  });

  it("«all»: a todos menos invitados externos y cuentas de PIN; no toca otras empresas", async () => {
    const ws = await createWorkspace(ctx, "Exigir todos");
    const other = await createWorkspace(ctx, "Sin exigir");
    await setPolicy(ws, "all");
    const app = await appFor([ws, other]);
    const call = (slug: string, token: string) =>
      request(app).get(`/api/v1/w/${slug}/spaces`).set("Authorization", `Bearer ${token}`);
    const member = await addMember(ctx, ws);
    const guest = await addMember(ctx, ws, { base: "GUEST" });
    const tablet = await addMember(ctx, ws, { seatType: "READER" });
    await ctx.prisma.user.update({
      where: { id: tablet.user.id },
      data: { kind: "PIN", email: null, passwordHash: null },
    });
    const tabletToken = await loginAs(ctx, tablet.user.id);

    expect(errorOf(await call(ws.slug, member.token)).code).toBe("MFA_SETUP_REQUIRED");
    expect((await call(ws.slug, guest.token)).status).toBe(200);
    expect((await call(ws.slug, tabletToken)).status).toBe(200);
    expect((await call(other.slug, other.token)).status).toBe(200);
  });

  it("sin licencia el plugin no se activa: la política guardada no se aplica", async () => {
    const ws = await createWorkspace(ctx, "Exigir sin licencia");
    await setPolicy(ws, "all");
    const app = await appFor([]);
    const res = await request(app)
      .get(`/api/v1/w/${ws.slug}/spaces`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(res.status).toBe(200);
  });
});

describe("backoffice /internal", () => {
  it("exige 2FA al staff", async () => {
    const ws = await createWorkspace(ctx, "Staff 2FA");
    const app = createApp(ctx.deps);
    await ctx.prisma.user.update({ where: { id: ws.owner.id }, data: { isStaff: true } });
    const get = () =>
      request(app).get("/api/v1/internal/me").set("Authorization", `Bearer ${ws.token}`);
    const blocked = await get();
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked).code).toBe("MFA_SETUP_REQUIRED");
    await withTwoFactor(ws.owner.id);
    expect((await get()).status).toBe(200);
  });
});
