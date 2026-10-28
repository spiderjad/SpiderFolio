// The built app (frontend/dist) served by the API itself in a self-hosted install (APP_STATIC_DIR), with
// no other web server needed. Same CSP as in development and in the E2E tests (frontend/csp.ts), plus
// the storage origin when files live in S3. Anything that isn't a file and isn't /api falls back to
// index.html (app routes); hashed assets are cached for a year.
//
// The built app of each plugin (frontendBundle) is served at /plugin-assets/<id>/ by pluginAssetsRouter,
// always (also in development, where Vite proxies it): same origin as the app, so the CSP stays as it is.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type RequestHandler, type Router } from "express";
import { cspHeader } from "../../frontend/csp.ts";

const YEAR_SECONDS = 365 * 24 * 3600;

export interface PluginAssets {
  id: string;
  /** Folder of the plugin's built app; only this folder is served. */
  dir: string;
}

/** /plugin-assets/<id>/…: each plugin's built app folder, and a 404 for anything else under it. */
export function pluginAssetsRouter(plugins: readonly PluginAssets[]): Router {
  const router = express.Router();
  for (const plugin of plugins) {
    router.use(
      `/plugin-assets/${plugin.id}`,
      express.static(plugin.dir, {
        index: false,
        dotfiles: "deny",
        // The URL carries the plugin version (?v=); a reinstall with the same version revalidates.
        setHeaders(res) {
          res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
  }
  // Anything else under /plugin-assets (a missing file, a path out of the folder, a plugin that isn't
  // installed) is a 404, never index.html.
  router.use("/plugin-assets", (_req, res) => {
    res.status(404).end();
  });
  return router;
}

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
        // Vite assets carry a hash in their name; the rest (index, manifest, sw.js, plugin-shared/)
        // is not cached.
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
