// /api/v1/auth/profile-media (subir, confirmar y quitar la foto de perfil y la portada, con sesión)
// y /api/v1/user-media/:kind/:userId (servirlas). Las imágenes se piden como <img>, que no manda
// Authorization: la dirección lleva el id del usuario (no adivinable) y la versión de la imagen.
import express, { type Request, type Router } from "express";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps } from "../../routes.ts";
import { createProfileMedia } from "./profile-media.service.ts";

const Kind = z.enum(["avatar", "cover"]);
const KindParams = z.object({ kind: Kind });
const ServeParams = z.object({ kind: Kind, userId: z.string().min(1).max(64) });
const UploadBody = z.strictObject({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
});
const ConfirmBody = z.strictObject({
  key: z.string().min(1).max(200),
  positionY: z.number().int().min(0).max(100).optional(),
});
const PositionBody = z.strictObject({ positionY: z.number().int().min(0).max(100) });

const MINUTE = 60_000;

export function profileMediaRouter(deps: AppDeps): Router {
  const router = express.Router();
  const media = createProfileMedia(deps);
  const requireAuth = authMiddleware(deps);
  const userOf = (req: Request): string => {
    if (req.auth === undefined) throw new Error("Ruta autenticada sin authMiddleware");
    return req.auth.userId;
  };
  const info = (req: Request) => ({
    ip: req.ip ?? null,
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
  });
  const limit = sensitiveRateLimit(deps, {
    name: "profile-media-user",
    windowMs: 15 * MINUTE,
    limit: 30,
    key: (req) => userOf(req),
  });

  router.post("/auth/profile-media/:kind/upload", requireAuth, limit, async (req, res) => {
    const { kind } = KindParams.parse(req.params);
    res.json(await media.startUpload(userOf(req), kind, UploadBody.parse(req.body)));
  });

  router.post("/auth/profile-media/:kind/confirm", requireAuth, limit, async (req, res) => {
    const { kind } = KindParams.parse(req.params);
    await media.confirm(userOf(req), kind, ConfirmBody.parse(req.body), info(req));
    res.status(204).end();
  });

  router.put("/auth/profile-media/cover/position", requireAuth, async (req, res) => {
    await media.setCoverPosition(userOf(req), PositionBody.parse(req.body).positionY);
    res.status(204).end();
  });

  router.delete("/auth/profile-media/:kind", requireAuth, async (req, res) => {
    const { kind } = KindParams.parse(req.params);
    await media.remove(userOf(req), kind, info(req));
    res.status(204).end();
  });

  router.get("/user-media/:kind/:userId", async (req, res) => {
    const { kind, userId } = ServeParams.parse(req.params);
    const { stream, contentType } = await media.open(kind, userId);
    res.setHeader("Content-Type", contentType);
    // La dirección cambia con cada imagen nueva (?v=…): se puede guardar mucho tiempo.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    try {
      await pipeline(stream, res);
    } catch (error) {
      res.destroy(error instanceof Error ? error : undefined);
    }
  });

  return router;
}
