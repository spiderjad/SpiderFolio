// Formato único de errores (CLAUDE.md, sección 12), probado sobre una app mínima.
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Prisma } from "../src/generated/prisma/client.ts";
import { AppError } from "../src/lib/errors.ts";
import { createLogger } from "../src/lib/logger.ts";
import { errorHandler, notFoundHandler } from "../src/middleware/error-handler.ts";
import { requestId } from "../src/middleware/request-id.ts";
import { errorOf } from "./http.ts";

function appThrowing(error: unknown) {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: "1kb" }));
  app.post("/eco", (req, res) => {
    res.json(req.body);
  });
  app.get("/falla", async () => {
    await Promise.resolve();
    throw error;
  });
  app.use(notFoundHandler);
  app.use(errorHandler(createLogger({ NODE_ENV: "test" })));
  return app;
}

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("detalle interno de Prisma", {
    code,
    clientVersion: "test",
  });

describe("errorHandler", () => {
  it("AppError con su código, mensaje en español y requestId", async () => {
    const res = await request(appThrowing(new AppError("FORBIDDEN"))).get("/falla");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "No tienes permiso para hacer esto.",
        requestId: res.headers["x-request-id"],
      },
    });
  });

  it("LIMIT_REACHED es 403 con sus detalles", async () => {
    const details = { limit: "storageGb", used: 10, max: 10 };
    const res = await request(appThrowing(new AppError("LIMIT_REACHED", { details }))).get(
      "/falla",
    );
    expect(res.status).toBe(403);
    expect(errorOf(res)).toMatchObject({ code: "LIMIT_REACHED", details });
  });

  it("errores de Zod: 400 con ruta y código, sin el valor recibido", async () => {
    const parsed = z.object({ email: z.email() }).safeParse({ email: "secreto-no-mostrar" });
    if (parsed.success) throw new Error("debía fallar");
    const res = await request(appThrowing(parsed.error)).get("/falla");
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe("VALIDATION_ERROR");
    const details = errorOf(res).details as { issues: { path: string }[] };
    expect(details.issues[0]).toMatchObject({ path: "email" });
    expect(JSON.stringify(res.body)).not.toContain("secreto-no-mostrar");
  });

  it.each([
    ["P2025", 404, "NOT_FOUND"],
    ["P2002", 409, "CONFLICT"],
    ["P2003", 409, "CONFLICT"],
    ["P2034", 500, "INTERNAL"],
  ])("Prisma %s → %d sin texto de Prisma", async (code, status, apiCode) => {
    const res = await request(appThrowing(prismaError(code))).get("/falla");
    expect(res.status).toBe(status);
    expect(errorOf(res).code).toBe(apiCode);
    expect(JSON.stringify(res.body)).not.toContain("Prisma");
  });

  it("un error inesperado es 500 sin mensaje interno ni stack", async () => {
    const res = await request(appThrowing(new Error("contraseña de la base: 1234"))).get("/falla");
    expect(res.status).toBe(500);
    expect(errorOf(res).code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toMatch(/1234|stack|at /);
  });

  it("JSON malformado es 400 y un cuerpo grande es 413", async () => {
    const app = appThrowing(null);
    const malformed = await request(app)
      .post("/eco")
      .set("Content-Type", "application/json")
      .send("{malo");
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed).code).toBe("BAD_REQUEST");
    const big = await request(app)
      .post("/eco")
      .send({ x: "a".repeat(2000) });
    expect(big.status).toBe(413);
    expect(errorOf(big).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rutas inexistentes: 404 con el mismo formato", async () => {
    const res = await request(appThrowing(null)).get("/no-existe");
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("NOT_FOUND");
  });
});
