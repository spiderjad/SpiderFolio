// Rutas del QR: las de la persona que genera y descarga (bajo el workspace) y el escaneo, que va
// antes del tenant porque quien escanea no sabe en qué workspace está (el token lo dice).
import express, { type Router } from "express";
import { optionalAuthMiddleware } from "../../middleware/auth.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreateQrSchema,
  QrImageQuerySchema,
  QrLabelsQuerySchema,
  QrNodeParamsSchema,
  QrParamsSchema,
  ScanParamsSchema,
} from "./qr.schemas.ts";
import { createQr, listQr, qrImage, qrLabels, revokeQr, scanQr } from "./qr.service.ts";

export function qrRoutes(deps: AppDeps): TenantRoute[] {
  const qr = { env: deps.env };
  return [
    {
      method: "get",
      path: "/nodes/:id/qr",
      handler: async (req, res) => {
        const { id } = QrNodeParamsSchema.parse(req.params);
        res.json(await listQr(adminContextOf(req), qr, id));
      },
    },
    {
      method: "post",
      path: "/nodes/:id/qr",
      handler: async (req, res) => {
        const { id } = QrNodeParamsSchema.parse(req.params);
        const body = CreateQrSchema.parse(req.body ?? {});
        res
          .status(201)
          .json(await createQr(adminContextOf(req), qr, id, { public: body.public === true }));
      },
    },
    {
      method: "delete",
      path: "/qr/:qrId",
      handler: async (req, res) => {
        const { qrId } = QrParamsSchema.parse(req.params);
        await revokeQr(adminContextOf(req), qrId);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/qr/:qrId/image",
      handler: async (req, res) => {
        const { qrId } = QrParamsSchema.parse(req.params);
        const { format } = QrImageQuerySchema.parse(req.query);
        const file = await qrImage(adminContextOf(req), qr, qrId, format);
        res.setHeader("Content-Type", file.contentType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="qr.${format}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(file.body);
      },
    },
    {
      method: "get",
      path: "/qr/:qrId/labels",
      handler: async (req, res) => {
        const { qrId } = QrParamsSchema.parse(req.params);
        const { size } = QrLabelsQuerySchema.parse(req.query);
        const file = await qrLabels(adminContextOf(req), qr, qrId, size);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="etiquetas.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.send(Buffer.from(file.bytes));
      },
    },
  ];
}

/** /api/v1/qr/:token — lo que abre la pantalla /q/:token al escanear (con o sin sesión). */
export function qrScanRouter(deps: AppDeps): Router {
  const router = express.Router();
  const limit = sensitiveRateLimit(deps, { name: "qr-scan", windowMs: 60_000, limit: 120 });
  router.get("/qr/:token", limit, optionalAuthMiddleware(deps), async (req, res) => {
    const { token } = ScanParamsSchema.parse(req.params);
    res.setHeader("Cache-Control", "no-store");
    res.json(await scanQr(deps, token, req.auth?.userId ?? null));
  });
  return router;
}
