// La app compilada (frontend/dist) servida por la propia API en una instalación propia (APP_STATIC_DIR),
// sin necesidad de otro servidor web. Misma CSP que en desarrollo y en los E2E (frontend/csp.ts), con el
// origen del almacenamiento cuando los archivos están en S3. Lo que no es un archivo y no es /api cae en
// index.html (rutas de la app); los assets con hash se cachean un año.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type RequestHandler, type Router } from "express";
import { cspHeader } from "../../frontend/csp.ts";

const YEAR_SECONDS = 365 * 24 * 3600;

export function staticAppRouter(input: { dir: string; storageOrigin: string | null }): Router {
  const dir = resolve(input.dir);
  const index = join(dir, "index.html");
  if (!existsSync(index)) throw new Error(`APP_STATIC_DIR sin index.html: ${dir}`);
  const csp = cspHeader(input.storageOrigin);
  const security: RequestHandler = (_req, res, next) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  };
  const router = express.Router();
  router.use(security);
  router.use(
    express.static(dir, {
      index: false,
      setHeaders(res, path) {
        // Los assets de Vite llevan hash en el nombre; el resto (index, manifiesto, sw.js), sin caché.
        res.setHeader(
          "Cache-Control",
          path.includes(join("assets", ""))
            ? `public, max-age=${String(YEAR_SECONDS)}, immutable`
            : "no-cache",
        );
      },
    }),
  );
  router.get(/^(?!\/api\/).*/u, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index);
  });
  return router;
}
