// Aplicación Express (CLAUDE.md, secciones 7.4 y 12). El orden de los middlewares importa:
//  1. requestId           6. express.json (1 MB) y cookie-parser
//  2. pino-http           7. rate limit global (300/min por IP, en memoria)
//  3. helmet              8. rutas: /api/health, /api/v1/auth (Parte 4),
//  4. cors (APP_URL)         /api/v1/w/:workspaceSlug → auth → tenant → capacidad
//  5. (libre)            9. 404
//                       10. errorHandler (formato único)
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { databaseIsUp } from "./db/raw/health.ts";
import { AppError } from "./lib/errors.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";
import { globalRateLimit } from "./middleware/rate-limit.ts";
import { requestId } from "./middleware/request-id.ts";
import {
  requireAnyCapability,
  requireAnyCapabilityOrLeader,
  requireAnyCapabilityOrMember,
  requireCapability,
  requireOwner,
} from "./middleware/require-capability.ts";
import { tenantMiddleware } from "./middleware/tenant.ts";
import { directorySignInRouter } from "./modules/external-auth/sign-in.routes.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { directoryOnlyGuard } from "./middleware/directory-only.ts";
import { mfaSetupGuard } from "./middleware/mfa-setup.ts";
import { internalRouter } from "./modules/internal/internal.routes.ts";
import { qrScanRouter } from "./modules/qr/qr.routes.ts";
import { profileMediaRouter } from "./modules/profile-media/profile-media.routes.ts";
import { downloadsRouter } from "./modules/downloads/downloads.routes.ts";
import { resolve } from "node:path";
import { tenantRoutes, type AppDeps } from "./routes.ts";
import { createTokenSigner, LOCAL_STORAGE_PATH } from "./lib/local-storage.ts";
import { localStorageRouter } from "./modules/storage/local-storage.routes.ts";
import { pluginAssetsRouter, staticAppRouter } from "./static-app.ts";
import { RESTART_HEADER } from "./plugins/restart.ts";
import { oauthConsentRouter, oauthPublicRouter } from "./modules/oauth/oauth.routes.ts";
import { createOAuthService } from "./modules/oauth/oauth.service.ts";
import { mcpRouter } from "./modules/mcp/mcp.router.ts";
import { writeTools } from "./modules/mcp/tools.write.ts";
import { localeFromHeader, withLocale } from "./i18n/locales.ts";
import { registerPluginCapabilities } from "./modules/roles/capabilities.ts";

export function createApp(deps: AppDeps): Express {
  const { env, prisma, logger } = deps;
  registerPluginCapabilities(deps.plugins.capabilities.map((capability) => capability.id));
  const app = express();
  app.disable("x-powered-by");
  // Detrás de Caddy (sección 15): una sola capa de proxy; expuesta directo, ninguna (TRUST_PROXY_HOPS).
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId }));
  app.use(
    helmet({
      // La API solo devuelve JSON: nada que cargar ni enmarcar. La CSP de la app (HTML) la
      // pone Caddy.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      strictTransportSecurity: env.NODE_ENV === "production",
    }),
  );
  // The connector's OAuth endpoints, before the app's CORS: any origin may read them (no cookies).
  const oauth = createOAuthService(deps);
  app.use(oauthPublicRouter(deps, oauth));
  // The connector's MCP endpoint (its own body limit and bearer tokens, no cookies).
  app.use(mcpRouter(deps, oauth, writeTools));
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  // Disco local: las «URLs prefirmadas» las atiende la API. Antes de express.json: el cuerpo es el
  // archivo tal cual (también un .json).
  if (env.STORAGE_DRIVER === "local" && env.STORAGE_DIR !== undefined) {
    app.use(
      LOCAL_STORAGE_PATH,
      globalRateLimit(),
      localStorageRouter({
        root: resolve(env.STORAGE_DIR),
        signer: createTokenSigner(env.JWT_ACCESS_SECRET),
      }),
    );
  }
  app.use(express.json({ limit: "1mb" }));
  // An announced restart (plugins/restart.ts): every response says when, so the app warns its users.
  app.use((_req, res, next) => {
    const plan = deps.restart?.pending();
    if (plan != null) res.setHeader(RESTART_HEADER, plan.restartAt);
    next();
  });
  app.use(cookieParser());
  // Idioma de los mensajes: el que manda la app (el activo); sin cabecera, español.
  app.use((req, _res, next) => {
    withLocale(localeFromHeader(req.headers["accept-language"]), next);
  });
  app.use("/api", globalRateLimit());
  // Respuestas con datos de la empresa: nunca en caché (tampoco la del navegador al volver
  // "atrás" después del logout).
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", async (_req, res) => {
    if (!(await databaseIsUp(prisma))) throw new AppError("UNAVAILABLE");
    res.json({ status: "ok" });
  });

  app.use("/api/v1/oauth", oauthConsentRouter(deps, oauth));
  app.use("/api/v1/auth/sso", directorySignInRouter(deps));
  app.use("/api/v1/auth", authRouter(deps));
  app.use("/api/v1", downloadsRouter(deps));
  app.use("/api/v1", profileMediaRouter(deps));
  app.use("/api/v1", qrScanRouter(deps));
  app.use("/api/v1/internal", internalRouter(deps));

  const tenant = express.Router({ mergeParams: true });
  tenant.use(
    authMiddleware(deps),
    tenantMiddleware(prisma),
    mfaSetupGuard(prisma, deps.plugins),
    directoryOnlyGuard(prisma, deps.plugins),
  );
  for (const route of tenantRoutes(deps)) {
    const required =
      route.capability === undefined
        ? []
        : typeof route.capability === "string"
          ? [route.capability]
          : [...route.capability];
    const guards = [
      ...(required.length === 0 ? [] : [requireCapability(...required)]),
      ...(route.ownerOnly === true ? [requireOwner()] : []),
      ...(route.anyCapability === undefined
        ? []
        : [
            route.memberAccess === true
              ? requireAnyCapabilityOrMember(...route.anyCapability)
              : route.leaderAccess === true
                ? requireAnyCapabilityOrLeader(...route.anyCapability)
                : requireAnyCapability(...route.anyCapability),
          ]),
      ...(route.guards ?? []),
    ];
    tenant[route.method](route.path, ...guards, route.handler);
  }
  app.use("/api/v1/w/:workspaceSlug", tenant);

  // Built plugins' app (frontendBundle), with or without the built app (in development, Vite proxies it).
  app.use(
    pluginAssetsRouter(
      deps.plugins.installed.flatMap((plugin) =>
        plugin.frontendBundle === null
          ? []
          : [{ id: plugin.manifest.id, dir: plugin.frontendBundle.dir }],
      ),
    ),
  );

  // Self-hosted install: the API also serves the built app (with its CSP).
  if (env.APP_STATIC_DIR !== undefined) {
    const sameOrigin = deps.storage.origin === new URL(env.APP_URL).origin;
    app.use(
      staticAppRouter({
        dir: env.APP_STATIC_DIR,
        storageOrigin: sameOrigin ? null : deps.storage.origin,
      }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
