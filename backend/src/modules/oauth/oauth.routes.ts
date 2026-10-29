// The connector's OAuth endpoints (docs/spec/conector-mcp.md). Public ones, mounted before the app's own
// CORS: metadata (RFC 9728, RFC 8414), registration (RFC 7591), authorization, token and revocation.
// They use no cookies, so any origin may read them (browser-based clients such as MCP Inspector). The
// consent screen's API is the app's own (/api/v1/oauth/consent, signed-in person, same origin).
import cors from "cors";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { sensitiveRateLimit, clientIp } from "../../middleware/rate-limit.ts";
import { authMiddleware } from "../../middleware/auth.ts";
import type { AppDeps } from "../../routes.ts";
import { ALL_SCOPES } from "./oauth.config.ts";
import { OAuthClientError } from "./oauth.clients.ts";
import { OAuthError, OAuthPageError, type OAuthService } from "./oauth.service.ts";

const MINUTE = 60_000;

function authOf(req: Request) {
  if (req.auth === undefined) throw new Error("Ruta autenticada sin authMiddleware");
  return req.auth;
}

const oauthError = (res: Response, error: OAuthError) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(error.status).json({ error: error.error, error_description: error.message });
};

export function oauthPublicRouter(deps: AppDeps, oauth: OAuthService): Router {
  const router = express.Router();
  const { urls } = oauth;
  const limit = (name: string, windowMs: number, max: number) =>
    sensitiveRateLimit(deps, { name, windowMs, limit: max, key: clientIp });
  const open = cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] });
  const form = [
    express.urlencoded({ extended: false, limit: "16kb" }),
    express.json({ limit: "16kb" }),
  ];

  const resourceMetadata = {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "SpiderFolio",
  };
  router.options("/.well-known/{*rest}", open);
  router.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    open,
    (_req, res) => {
      res.json(resourceMetadata);
    },
  );
  router.get("/.well-known/oauth-authorization-server", open, (_req, res) => {
    res.json({
      issuer: urls.issuer,
      authorization_endpoint: urls.authorize,
      token_endpoint: urls.token,
      registration_endpoint: urls.register,
      revocation_endpoint: urls.revoke,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...ALL_SCOPES],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  router.options(["/oauth/register", "/oauth/token", "/oauth/revoke"], open);
  router.post(
    "/oauth/register",
    open,
    limit("oauth-register-ip", 60 * MINUTE, 30),
    express.json({ limit: "16kb" }),
    async (req, res) => {
      try {
        res.status(201).json(await oauth.register(req.body));
      } catch (error) {
        if (!(error instanceof OAuthClientError)) throw error;
        res.status(400).json({ error: error.code, error_description: "Invalid client metadata" });
      }
    },
  );

  router.get(
    "/oauth/authorize",
    limit("oauth-authorize-ip", 15 * MINUTE, 120),
    async (req, res) => {
      try {
        res.redirect(302, await oauth.authorize(req.query));
      } catch (error) {
        if (!(error instanceof OAuthPageError)) throw error;
        // Never back to an unverified redirect URI: the app explains the problem itself.
        res.redirect(302, `${urls.consent}#error=${error.reason}`);
      }
    },
  );

  router.post(
    "/oauth/token",
    open,
    limit("oauth-token-ip", MINUTE, 120),
    ...form,
    async (req, res) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        res.json(await oauth.token((req.body ?? {}) as Record<string, unknown>));
      } catch (error) {
        if (!(error instanceof OAuthError)) throw error;
        oauthError(res, error);
      }
    },
  );

  router.post(
    "/oauth/revoke",
    open,
    limit("oauth-revoke-ip", MINUTE, 60),
    ...form,
    async (req, res) => {
      await oauth.revoke((req.body ?? {}) as Record<string, unknown>);
      res.status(200).end();
    },
  );

  return router;
}

const ConsentQuerySchema = z.object({ request: z.string().min(10).max(4000) });
const DecisionSchema = z.strictObject({
  request: z.string().min(10).max(4000),
  allow: z.boolean(),
  workspaceSlug: z.string().max(63).optional(),
});

/** The consent screen's API: the signed-in person sees the request and answers it. */
export function oauthConsentRouter(deps: AppDeps, oauth: OAuthService): Router {
  const router = express.Router();
  router.use(authMiddleware(deps));
  const pageError = (res: Response, error: unknown) => {
    if (!(error instanceof OAuthPageError)) throw error;
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: error.reason, details: { reason: error.reason } },
    });
  };
  router.get("/consent", async (req: Request, res) => {
    try {
      const { request } = ConsentQuerySchema.parse(req.query);
      res.json(await oauth.consentOverview(authOf(req).userId, request));
    } catch (error) {
      pageError(res, error);
    }
  });
  router.post(
    "/consent",
    sensitiveRateLimit(deps, {
      name: "oauth-consent-user",
      windowMs: 15 * MINUTE,
      limit: 30,
      key: (req) => authOf(req).userId,
    }),
    async (req: Request, res) => {
      try {
        const decision = DecisionSchema.parse(req.body);
        const redirectTo = await oauth.decide(authOf(req).userId, decision.request, decision, {
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        });
        res.json({ redirectTo });
      } catch (error) {
        pageError(res, error);
      }
    },
  );
  return router;
}
