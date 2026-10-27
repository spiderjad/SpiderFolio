// Plugins «community» (docs/spec/plugins.md): se instalan sin licencia, pero solo el propietario los
// activa, por empresa y confirmando el riesgo; queda en la auditoría. Un manifiesto community no puede
// usar el id de un plugin comercial (no se carga) y un comercial no se activa a mano.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineBackendPlugin } from "@spiderfolio/plugin-sdk/backend";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { discoverPlugins } from "../../src/plugins/loader.ts";
import { errorOf } from "../http.ts";
import {
  addMember,
  createTestContext,
  createWorkspace,
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

const COMMUNITY = "test-community";
const COMMERCIAL = "test-commercial";
const communityPlugin = defineBackendPlugin({ id: COMMUNITY, version: "1.0.0" });
const commercialPlugin = defineBackendPlugin({ id: COMMERCIAL, version: "1.0.0" });

async function appWithPlugins() {
  return createApp({
    ...ctx.deps,
    plugins: await testPluginRuntime(ctx, [communityPlugin, commercialPlugin], [], [COMMUNITY]),
  });
}

type App = Awaited<ReturnType<typeof appWithPlugins>>;

const activation = (app: App, ws: TestWorkspace, token: string, pluginId: string, body: object) =>
  request(app)
    .put(`/api/v1/w/${ws.slug}/admin/plugins/${pluginId}/activation`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);

const activeIds = async (app: App, ws: TestWorkspace) => {
  const res = await request(app)
    .get(`/api/v1/w/${ws.slug}/plugins`)
    .set("Authorization", `Bearer ${ws.token}`);
  expect(res.status).toBe(200);
  return (res.body as { plugins: { id: string }[] }).plugins.map((plugin) => plugin.id);
};

const auditCount = (ws: TestWorkspace, action: string) =>
  ctx.prisma.auditLog.count({
    where: { workspaceId: ws.workspaceId, action, entityId: COMMUNITY },
  });

describe("activar un plugin community", () => {
  it("sin confirmar el riesgo se rechaza y el plugin sigue inactivo", async () => {
    const app = await appWithPlugins();
    const ws = await createWorkspace(ctx, "Community sin confirmar");
    expect(await activeIds(app, ws)).toEqual([]);
    for (const body of [{ enabled: true }, { enabled: true, acceptRisk: false }]) {
      const res = await activation(app, ws, ws.token, COMMUNITY, body);
      expect(res.status).toBe(400);
    }
    expect(await activeIds(app, ws)).toEqual([]);
    expect(await auditCount(ws, "plugin.community.enable")).toBe(0);
  });

  it("solo el propietario lo activa", async () => {
    const app = await appWithPlugins();
    const ws = await createWorkspace(ctx, "Community admin");
    const admin = await addMember(ctx, ws, { base: "ADMIN" });
    const res = await activation(app, ws, admin.token, COMMUNITY, {
      enabled: true,
      acceptRisk: true,
    });
    expect(res.status).toBe(403);
    expect(await activeIds(app, ws)).toEqual([]);
  });

  it("se activa por empresa, se audita y se desactiva", async () => {
    const app = await appWithPlugins();
    const ws = await createWorkspace(ctx, "Community activa");
    const other = await createWorkspace(ctx, "Community otra");

    const on = await activation(app, ws, ws.token, COMMUNITY, { enabled: true, acceptRisk: true });
    expect(on.status).toBe(200);
    const listed = (on.body as { installed: { id: string; distribution: string; active: boolean }[] })
      .installed;
    expect(listed.find((plugin) => plugin.id === COMMUNITY)).toMatchObject({
      distribution: "community",
      active: true,
    });
    expect(await activeIds(app, ws)).toEqual([COMMUNITY]);
    // La activación es de esa empresa: en otra sigue inactivo.
    expect(await activeIds(app, other)).toEqual([]);
    expect(await auditCount(ws, "plugin.community.enable")).toBe(1);
    expect(await auditCount(other, "plugin.community.enable")).toBe(0);

    const off = await activation(app, ws, ws.token, COMMUNITY, { enabled: false });
    expect(off.status).toBe(200);
    expect(await activeIds(app, ws)).toEqual([]);
    expect(await auditCount(ws, "plugin.community.disable")).toBe(1);
  });

  it("un plugin comercial no se activa a mano y uno que no existe responde 404", async () => {
    const app = await appWithPlugins();
    const ws = await createWorkspace(ctx, "Community comercial");
    const commercial = await activation(app, ws, ws.token, COMMERCIAL, {
      enabled: true,
      acceptRisk: true,
    });
    expect(commercial.status).toBe(400);
    expect(errorOf(commercial).code).toBe("BAD_REQUEST");
    expect(await activeIds(app, ws)).toEqual([]);
    const missing = await activation(app, ws, ws.token, "no-existe", {
      enabled: true,
      acceptRisk: true,
    });
    expect(missing.status).toBe(404);
  });
});

describe("cargar plugins community", () => {
  it("no carga uno que usa el id de un plugin comercial de SpiderJAD", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spiderfolio-plugins-"));
    try {
      const write = (folder: string, id: string) => {
        mkdirSync(join(dir, folder));
        writeFileSync(
          join(dir, folder, "package.json"),
          JSON.stringify({
            name: `@terceros/${folder}`,
            version: "1.0.0",
            spiderfolio: { id, name: id, distribution: "community" },
          }),
        );
      };
      write("falso", "security-policies");
      write("propio", "checklist-turno");
      const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
      const found = await discoverPlugins({ dir, logger: silent });
      expect(found.map((plugin) => plugin.manifest.id)).toEqual(["checklist-turno"]);
      expect(found[0]?.manifest.distribution).toBe("community");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
