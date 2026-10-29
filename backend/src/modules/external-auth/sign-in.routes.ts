// /api/v1/auth/sso: signing in with a company's directory (docs/spec/plugins.md «Directorio de la
// empresa»). Public routes, with rate limits by IP and by company and username: they are the attempt
// limit and the lockout of a directory sign-in.
import { PluginIdSchema } from "@spiderfolio/plugin-sdk";
import { directorySignInLimits } from "@spiderfolio/limits";
import express, { type CookieOptions, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps } from "../../routes.ts";
import type { IssuedAuth, LoginResult } from "../auth/auth.service.ts";
import { readTrustedDeviceCookie, setRefreshCookie } from "../auth/cookies.ts";
import type { RequestInfo } from "../auth/sessions.service.ts";
import { createDirectorySignIn, safeNextPath, SignInError } from "./sign-in.service.ts";

const MINUTE = 60_000;
const SSO_COOKIE = "spiderfolio_sso";

const RouteSchema = z.strictObject({
  workspaceSlug: z.string().min(1).max(64),
  pluginId: PluginIdSchema,
  providerId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
});

const OptionsQuerySchema = z.object({ workspace: z.string().min(1).max(64).optional() });

// Never empty: a directory (Active Directory) takes an empty password as an anonymous bind.
const CredentialsSchema = z.strictObject({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(256),
});

const StartQuerySchema = z.object({ next: z.string().max(500).optional() });

function requestInfo(req: Request): RequestInfo {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 500) ?? null };
}

function routeOf(req: Request) {
  const { workspaceSlug, pluginId, providerId } = RouteSchema.parse(req.params);
  return { slug: workspaceSlug, pluginId, providerId };
}

export function directorySignInRouter(deps: AppDeps): Router {
  const { env } = deps;
  const signIn = createDirectorySignIn(deps);
  const router = express.Router();
  const appUrl = env.APP_URL.replace(/\/+$/u, "");
  const limit = (name: string, windowMs: number, max: number, key?: (req: Request) => string) =>
    sensitiveRateLimit(deps, { name, windowMs, limit: max, ...(key === undefined ? {} : { key }) });
  const byCompanyAndUsername = (req: Request) => {
    const username: unknown = (req.body as { username?: unknown } | undefined)?.username;
    const slug = typeof req.params.workspaceSlug === "string" ? req.params.workspaceSlug : "";
    const name =
      typeof username === "string" ? username.trim().normalize("NFKC").toLowerCase() : "";
    return `${slug}:${name}`;
  };
  // The browser that left for the identity provider: Lax, so it comes back with the redirect.
  const ssoCookie: CookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth/sso",
  };
  const readSsoCookie = (req: Request): string | undefined => {
    const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[SSO_COOKIE];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const sendAuth = (res: Response, issued: IssuedAuth) => {
    setRefreshCookie(res, env, issued.refresh.refreshToken, issued.refresh.expiresAt);
    res.json({
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      user: issued.user,
      kiosk: issued.kiosk,
      memberships: issued.memberships,
    });
  };
  const signInScreen = (slug: string, query: string) =>
    `${appUrl}/login/${encodeURIComponent(slug)}${query}`;

  router.get("/options", limit("sso-options-ip", 15 * MINUTE, 300), async (req, res) => {
    const { workspace } = OptionsQuerySchema.parse(req.query);
    res.json(await signIn.options(workspace));
  });

  router.post(
    "/:workspaceSlug/:pluginId/:providerId/login",
    limit("sso-login-ip", 15 * MINUTE, 50),
    limit(
      "sso-login-ip-user",
      15 * MINUTE,
      5,
      (req) => `${clientIp(req)}:${byCompanyAndUsername(req)}`,
    ),
    // From every IP together: also keeps guesses from piling up on the account in the directory itself.
    limit("sso-login-user", 15 * MINUTE, 10, byCompanyAndUsername),
    async (req, res) => {
      const result: LoginResult = await signIn.passwordSignIn(
        routeOf(req),
        CredentialsSchema.parse(req.body),
        requestInfo(req),
        readTrustedDeviceCookie(req),
      );
      // With 2FA there's no session yet: the app asks for the code with the challenge.
      if ("mfaRequired" in result) {
        res.json(result);
        return;
      }
      sendAuth(res, result);
    },
  );

  router.get(
    "/:workspaceSlug/:pluginId/:providerId/start",
    limit("sso-start-ip", 15 * MINUTE, 60),
    async (req, res) => {
      const route = routeOf(req);
      try {
        const { next } = StartQuerySchema.parse(req.query);
        const { url, browser } = await signIn.redirectStart(route, safeNextPath(next));
        res.cookie(SSO_COOKIE, browser, {
          ...ssoCookie,
          maxAge: directorySignInLimits.flowMinutes * MINUTE,
        });
        res.redirect(303, url);
      } catch (error) {
        if (!(error instanceof SignInError)) throw error;
        res.redirect(303, signInScreen(route.slug, `?signin=${error.failure}`));
      }
    },
  );

  router.get(
    "/:workspaceSlug/:pluginId/:providerId/callback",
    limit("sso-callback-ip", 15 * MINUTE, 60),
    async (req, res) => {
      const route = routeOf(req);
      res.clearCookie(SSO_COOKIE, ssoCookie);
      try {
        const { result, next } = await signIn.redirectCallback(
          route,
          new URL(req.originalUrl, `${appUrl}/`),
          readSsoCookie(req),
          requestInfo(req),
          readTrustedDeviceCookie(req),
        );
        if ("mfaRequired" in result) {
          // The code is asked on the sign-in screen; the challenge travels in the fragment (it never
          // reaches a server log or a Referer).
          res.redirect(
            303,
            signInScreen(route.slug, `#challenge=${encodeURIComponent(result.challenge)}`),
          );
          return;
        }
        setRefreshCookie(res, env, result.refresh.refreshToken, result.refresh.expiresAt);
        res.redirect(303, `${appUrl}${next ?? `/app/${encodeURIComponent(route.slug)}`}`);
      } catch (error) {
        const failure = error instanceof SignInError ? error.failure : "failed";
        if (!(error instanceof SignInError)) {
          deps.logger.error(
            { err: error, ip: clientIp(req) },
            "Inicio de sesión con directorio fallido",
          );
        }
        res.redirect(303, signInScreen(route.slug, `?signin=${failure}`));
      }
    },
  );

  return router;
}
