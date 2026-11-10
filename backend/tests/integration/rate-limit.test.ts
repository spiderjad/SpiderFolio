// Rate limit en dos niveles (CLAUDE.md, sección 12).
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupExpired } from "../../src/jobs/handlers.ts";
import { sha256 } from "../../src/lib/crypto.ts";
import { signAccessToken } from "../../src/lib/jwt.ts";
import { errorHandler } from "../../src/middleware/error-handler.ts";
import { globalRateLimit, sensitiveRateLimit } from "../../src/middleware/rate-limit.ts";
import { requestId } from "../../src/middleware/request-id.ts";
import { createTestContext, type TestContext } from "./helpers.ts";
import { errorOf } from "../http.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

/** Una "instancia" de la API con un límite sensible propio (mismo Postgres). */
function instance(name: string, limit: number, windowMs = 60_000) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(express.json());
  app.post(
    "/login",
    sensitiveRateLimit(ctx.deps, {
      name,
      windowMs,
      limit,
      key: (req) => `${req.ip ?? ""}:${String((req.body as { email?: string }).email)}`,
    }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(errorHandler(ctx.deps.logger));
  return app;
}

describe("límite sensible en Postgres", () => {
  it("se comparte entre instancias y responde 429 con Retry-After", async () => {
    const name = `login-${randomUUID()}`;
    const [api1, api2] = [instance(name, 3), instance(name, 3)];
    const email = "persona@empresa.com";
    const send = (app: express.Express) =>
      request(app).post("/login").set("X-Forwarded-For", "203.0.113.7").send({ email });

    expect((await send(api1)).status).toBe(200);
    expect((await send(api2)).status).toBe(200);
    expect((await send(api1)).status).toBe(200);
    const blocked = await send(api2);
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // Otra clave (otro email) no se ve afectada.
    const other = await request(api1)
      .post("/login")
      .set("X-Forwarded-For", "203.0.113.7")
      .send({ email: "otra@empresa.com" });
    expect(other.status).toBe(200);
  });

  it("guarda la clave como hash: ni IP ni email en la tabla", async () => {
    const name = `hash-${randomUUID()}`;
    await request(instance(name, 5))
      .post("/login")
      .set("X-Forwarded-For", "198.51.100.23")
      .send({ email: "visible@empresa.com" });
    const keys = (await ctx.prisma.rateLimitBucket.findMany({ select: { key: true } })).map(
      (b) => b.key,
    );
    expect(keys.some((k) => k.includes("198.51.100.23") || k.includes("visible@"))).toBe(false);
    expect(keys).toContain(sha256(`${name}:198.51.100.23:visible@empresa.com`));
  });

  it("la ventana se reinicia al vencer", async () => {
    const app = instance(`ventana-${randomUUID()}`, 1, 300);
    const send = () => request(app).post("/login").set("X-Forwarded-For", "192.0.2.1").send({});
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await send()).status).toBe(200);
  });

  it("la limpieza horaria borra los contadores vencidos", async () => {
    await ctx.prisma.rateLimitBucket.create({
      data: { key: `viejo-${randomUUID()}`, hits: 3, resetAt: new Date(Date.now() - 1000) },
    });
    const result = await cleanupExpired(ctx.deps, {});
    expect(result.rateLimitBuckets).toBeGreaterThanOrEqual(1);
    expect(await ctx.prisma.rateLimitBucket.count({ where: { resetAt: { lt: new Date() } } })).toBe(
      0,
    );
  });
});

describe("límite global en memoria", () => {
  it("corta en 300 por minuto por IP y por instancia", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(requestId);
    app.use(globalRateLimit());
    app.get("/x", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler(ctx.deps.logger));

    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) {
      statuses.push((await request(app).get("/x").set("X-Forwarded-For", "192.0.2.50")).status);
    }
    expect(statuses.slice(0, 300).every((s) => s === 200)).toBe(true);
    expect(statuses[300]).toBe(429);
    // Otra IP sigue pasando.
    expect((await request(app).get("/x").set("X-Forwarded-For", "192.0.2.51")).status).toBe(200);
  });

  it("con sesión cuenta por persona: una planta entera detrás de una IP no se corta", async () => {
    const secret = "secreto-de-prueba-del-rate-limit-0123456789";
    const app = express();
    app.set("trust proxy", 1);
    app.use(requestId);
    app.use(globalRateLimit({ secret, limits: { perUser: 3, perIp: 2, perSharedIp: 6 } }));
    app.get("/x", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler(ctx.deps.logger));
    const token = (userId: string) =>
      signAccessToken({ userId, sessionId: randomUUID() }, secret, 60);
    const get = (auth?: string) => {
      const call = request(app).get("/x").set("X-Forwarded-For", "192.0.2.60");
      return (auth === undefined ? call : call.set("Authorization", `Bearer ${auth}`)).then(
        (res) => res.status,
      );
    };
    const ana = token("ana");
    const beto = token("beto");
    // Each person has their own 3, from the same address.
    expect([await get(ana), await get(ana), await get(ana), await get(ana)]).toEqual([
      200, 200, 200, 429,
    ]);
    expect([await get(beto), await get(beto), await get(beto)]).toEqual([200, 200, 200]);
    // Without a session (or with a forged token) it's per address.
    const forged = signAccessToken({ userId: "ana", sessionId: randomUUID() }, "otro-secreto", 60);
    expect([await get(), await get(forged), await get()]).toEqual([200, 200, 429]);
    // And everything with a session from that address has a cap: 6, already used by ana and beto.
    expect(await get(token("carla"))).toBe(429);
  });
});
