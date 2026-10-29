// A paid plugin that replaces a free one (docs/spec/plugins.md «Reemplazos»): while the paid one is
// active the free one is off and the paid one answers at the free one's sign-in address, linking the
// accounts there; when the paid license expires, the free one takes over with the same people and
// data, and nobody gets a second account. Only the replaced plugin's data is reachable (ctx.shared).
import { randomBytes } from "node:crypto";
import { defineBackendPlugin, type DirectoryMember } from "@spiderfolio/plugin-sdk/backend";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app.ts";
import { createSecretBox } from "../../src/lib/secret-box.ts";
import type { PluginRuntime } from "../../src/plugins/runtime.ts";
import {
  createTestContext,
  createWorkspace,
  testPluginRuntime,
  uniqueEmail,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";

const FREE = "microsoft-sign-in";
const PAID = "corporate-directory";
const DAY = 24 * 3600_000;
const box = createSecretBox({ EMAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

let ctx: TestContext;

// The directory both plugins sign people in against: username → password and who they are.
const people = new Map<string, { password: string; member: DirectoryMember }>();
const verify = (username: string, password: string) => {
  const person = people.get(username);
  return Promise.resolve(person?.password === password ? person.member : null);
};

const free = defineBackendPlugin({
  id: FREE,
  version: "1.0.0",
  authProviders: [
    {
      kind: "password",
      id: "entra",
      describe: () => Promise.resolve({ label: "Gratis" }),
      verify: (_ctx, { username, password }) => verify(username, password),
    },
  ],
});

const paid = defineBackendPlugin({
  id: PAID,
  version: "1.0.0",
  authProviders: [
    {
      kind: "password",
      id: "entra",
      sharedWith: FREE,
      describe: () => Promise.resolve({ label: "De pago" }),
      verify: (_ctx, { username, password }) => verify(username, password),
    },
  ],
});

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  // Test database only: every case starts without spent attempts.
  await ctx.prisma.rateLimitBucket.deleteMany({});
});

/** Both installed, the free one turned on by the owner, the paid one licensed until `expiresAt`. */
async function runtimeFor(
  ws: TestWorkspace,
  options: { expiresAt?: Date; freeOn?: boolean } = {},
): Promise<{ runtime: PluginRuntime; app: ReturnType<typeof createApp> }> {
  await ctx.prisma.workspace.update({
    where: { id: ws.workspaceId },
    data: {
      settings:
        options.freeOn === false
          ? {}
          : {
              communityPlugins: {
                [FREE]: { enabledAt: new Date().toISOString(), enabledBy: "test" },
              },
            },
    },
  });
  const runtime = await testPluginRuntime(ctx, [free, paid], [ws.workspaceId], [], {
    box,
    free: [FREE],
    replaces: { [PAID]: [FREE] },
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
  });
  return { runtime, app: createApp({ ...ctx.deps, plugins: runtime }) };
}

function person() {
  const username = `user-${randomBytes(6).toString("hex")}`;
  const password = "contraseña-del-directorio";
  const member = {
    externalId: randomBytes(16).toString("hex"),
    email: uniqueEmail("relevo"),
    name: "Persona del relevo",
  };
  people.set(username, { password, member });
  return { username, password, member };
}

const login = (
  app: ReturnType<typeof createApp>,
  ws: TestWorkspace,
  who: { username: string; password: string },
) =>
  request(app)
    .post(`/api/v1/auth/sso/${ws.slug}/${FREE}/entra/login`)
    .send({ username: who.username, password: who.password });

const options = async (app: ReturnType<typeof createApp>, ws: TestWorkspace) =>
  (await request(app).get(`/api/v1/auth/sso/options?workspace=${ws.slug}`)).body as {
    providers: { pluginId: string; id: string; label: string }[];
  };

describe("un plugin de pago que reemplaza a uno gratis", () => {
  it("con la licencia vigente, el gratis queda apagado y el de pago contesta en su dirección", async () => {
    const ws = await createWorkspace(ctx, "Relevo vigente");
    const { runtime, app } = await runtimeFor(ws);
    const active = await runtime.activeIds(ws.workspaceId);
    expect(active.has(PAID)).toBe(true);
    expect(active.has(FREE)).toBe(false);
    expect((await options(app, ws)).providers).toEqual([
      { pluginId: FREE, id: "entra", kind: "password", label: "De pago" },
    ]);

    const ana = person();
    expect((await login(app, ws, ana)).status).toBe(200);
    const identity = await ctx.prisma.externalIdentity.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, externalId: ana.member.externalId },
    });
    // Linked under the free plugin, so it survives the paid one going away.
    expect(identity.pluginId).toBe(FREE);
    expect(identity.provider).toBe("entra");
    // The free plugin's own routes stay off while it's replaced.
    expect(await runtime.isActive(ws.workspaceId, FREE)).toBe(false);
  });

  it("vence la licencia del de pago: el gratis toma el relevo con las mismas personas y datos", async () => {
    const ws = await createWorkspace(ctx, "Relevo vencido");
    const before = await runtimeFor(ws);
    const ana = person();
    expect((await login(before.app, ws, ana)).status).toBe(200);
    const linked = await ctx.prisma.externalIdentity.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, externalId: ana.member.externalId },
    });
    // The paid plugin saves the connection where the free one keeps it.
    await before.runtime
      .contextFor(ws.workspaceId, PAID)
      .shared(FREE)
      .settings.set("entra", { tenantId: "tenant-de-la-empresa" });

    // Expired yesterday: still inside the paid plugin's grace period, but the free one is active.
    const after = await runtimeFor(ws, { expiresAt: new Date(Date.now() - DAY) });
    const active = await after.runtime.activeIds(ws.workspaceId);
    expect(active.has(FREE)).toBe(true);
    expect(active.has(PAID)).toBe(false);
    expect((await options(after.app, ws)).providers).toEqual([
      { pluginId: FREE, id: "entra", kind: "password", label: "Gratis" },
    ]);
    expect(
      await after.runtime
        .contextFor(ws.workspaceId, FREE)
        .settings.get("entra", z.object({ tenantId: z.string() })),
    ).toEqual({ tenantId: "tenant-de-la-empresa" });

    const res = await login(after.app, ws, ana);
    expect(res.status).toBe(200);
    // The same person and membership: no second account.
    const identities = await ctx.prisma.externalIdentity.findMany({
      where: { workspaceId: ws.workspaceId, externalId: ana.member.externalId },
    });
    expect(identities.map((identity) => identity.membershipId)).toEqual([linked.membershipId]);
    expect(await ctx.prisma.user.count({ where: { email: ana.member.email } })).toBe(1);
    const session = await ctx.prisma.session.findFirstOrThrow({
      where: { authWorkspaceId: ws.workspaceId },
      orderBy: { createdAt: "desc" },
    });
    expect(session.authProvider).toBe(`${FREE}/entra`);
  });

  it("sin el gratis activado, el de pago sigue en su período de gracia", async () => {
    const ws = await createWorkspace(ctx, "Relevo sin gratis");
    const { app } = await runtimeFor(ws, {
      expiresAt: new Date(Date.now() - DAY),
      freeOn: false,
    });
    expect((await options(app, ws)).providers).toEqual([
      { pluginId: FREE, id: "entra", kind: "password", label: "De pago" },
    ]);
    expect((await login(app, ws, person())).status).toBe(200);
  });

  it("solo alcanza los datos del plugin que reemplaza", async () => {
    const ws = await createWorkspace(ctx, "Relevo datos");
    const { runtime } = await runtimeFor(ws);
    const paidCtx = runtime.contextFor(ws.workspaceId, PAID);
    expect(() => paidCtx.shared("security-policies")).toThrow();
    expect(() => runtime.contextFor(ws.workspaceId, FREE).shared(PAID)).toThrow();
  });
});
