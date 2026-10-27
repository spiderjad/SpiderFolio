// /api/v1/downloads/:token y /api/v1/exports/:token — enlaces que abre el navegador sin cabecera
// Authorization (una navegación normal): el token opaco es la credencial. Van antes del tenant.
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express, { type Router } from "express";
import { z } from "zod";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps } from "../../routes.ts";
import { zipSize, zipStream } from "../nodes/zip-writer.ts";
import { redeemDownloadToken, resolveExportLink } from "./downloads.service.ts";

const TokenParams = z.object({ token: z.string().min(20).max(200) });
const MINUTE = 60_000;

export function downloadsRouter(deps: AppDeps): Router {
  const router = express.Router();
  const limit = sensitiveRateLimit(deps, { name: "zip-download", windowMs: MINUTE, limit: 30 });

  router.get("/downloads/:token", limit, async (req, res) => {
    const { token } = TokenParams.parse(req.params);
    const plan = await redeemDownloadToken(deps, token, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
    });
    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(zipSize(plan.entries)));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="archivos.zip"; filename*=UTF-8''${encodeURIComponent(plan.fileName)}`,
    );
    try {
      await pipeline(Readable.from(zipStream(plan.entries)), res);
    } catch (error) {
      // Ya se enviaron los encabezados: no hay forma de avisar con un error JSON.
      res.destroy(error instanceof Error ? error : undefined);
    }
  });

  router.get("/exports/:token", limit, async (req, res) => {
    const { token } = TokenParams.parse(req.params);
    const url = await resolveExportLink(deps, token);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  });

  return router;
}
