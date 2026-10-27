// Endpoints /api/v1/auth (CLAUDE.md, sección 7.2). Las invitaciones llegan con el Módulo 2.
import express, { type Request, type Response, type Router } from "express";
import { authMiddleware, optionalAuthMiddleware } from "../../middleware/auth.ts";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import { requireSameOrigin } from "../../middleware/same-origin.ts";
import type { AppDeps } from "../../routes.ts";
import {
  AcceptInvitationSchema,
  AcceptTermsSchema,
  InvitationTokenParamsSchema,
  ChangeEmailSchema,
  ChangePasswordSchema,
  UpdateProfileSchema,
  EmailOnlySchema,
  LoginSchema,
  MfaCodeSchema,
  MfaDisableSchema,
  MfaVerifySchema,
  PinLoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  SessionIdSchema,
  TokenSchema,
} from "./auth.schemas.ts";
import { createAuthService, type AuthContext, type IssuedAuth } from "./auth.service.ts";
import { createMfaService } from "./mfa.service.ts";
import {
  clearRefreshCookie,
  clearTrustedDeviceCookie,
  readRefreshCookie,
  readTrustedDeviceCookie,
  setRefreshCookie,
  setTrustedDeviceCookie,
} from "./cookies.ts";
import type { RequestInfo } from "./sessions.service.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function requestInfo(req: Request): RequestInfo {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 500) ?? null };
}

/** Email del cuerpo, normalizado como lo guarda la base, para las claves de rate limit. */
function bodyEmail(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email.trim().normalize("NFKC").toLowerCase() : "";
}

function authOf(req: Request): AuthContext {
  if (req.auth === undefined) throw new Error("Ruta autenticada sin authMiddleware");
  return req.auth;
}

export function authRouter(deps: AppDeps): Router {
  const auth = createAuthService(deps);
  const mfa = createMfaService(deps);
  const { env } = deps;
  const router = express.Router();
  const requireAuth = authMiddleware(deps);
  const sameOrigin = requireSameOrigin(env);

  // Rate limits sensibles en Postgres (12): login con los valores de 7.3.
  const limit = (name: string, windowMs: number, max: number, key?: (req: Request) => string) =>
    sensitiveRateLimit(deps, { name, windowMs, limit: max, ...(key === undefined ? {} : { key }) });
  const byIpAndEmail = (req: Request) => `${clientIp(req)}:${bodyEmail(req)}`;
  const byUser = (req: Request) => authOf(req).userId;
  const byWorkspaceAndLoginName = (req: Request) => {
    const body = (req.body ?? {}) as { workspaceSlug?: unknown; loginName?: unknown };
    const part = (value: unknown) =>
      typeof value === "string" ? value.trim().normalize("NFKC").toLowerCase() : "";
    return `${part(body.workspaceSlug)}:${part(body.loginName)}`;
  };

  const sendAuth = (
    res: Response,
    issued: IssuedAuth,
    status = 200,
    extra: Record<string, string> = {},
  ) => {
    setRefreshCookie(res, env, issued.refresh.refreshToken, issued.refresh.expiresAt);
    res.status(status).json({
      ...extra,
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      user: issued.user,
      kiosk: issued.kiosk,
      memberships: issued.memberships,
    });
  };

  router.post("/register", limit("register-ip", HOUR, 10), async (req, res) => {
    const input = RegisterSchema.parse(req.body);
    sendAuth(res, await auth.register(input, requestInfo(req)), 201);
  });

  router.post(
    "/login",
    limit("login-ip", 15 * MINUTE, 50),
    limit("login-ip-email", 15 * MINUTE, 5, byIpAndEmail),
    async (req, res) => {
      const input = LoginSchema.parse(req.body);
      const result = await auth.login(input, requestInfo(req), readTrustedDeviceCookie(req));
      // Con 2FA: todavía no hay sesión (ni cookie); la app pide el código con el desafío.
      if ("mfaRequired" in result) {
        res.json(result);
        return;
      }
      sendAuth(res, result);
    },
  );

  // Ingreso con usuario + PIN (7.6). El bloqueo por cuenta (5 fallos) es la defensa principal;
  // el límite por IP es amplio porque varias tablets de una planta comparten IP.
  router.post(
    "/pin-login",
    limit("pin-login-ip", 15 * MINUTE, 200),
    limit("pin-login-user", 15 * MINUTE, 12, byWorkspaceAndLoginName),
    async (req, res) => {
      const input = PinLoginSchema.parse(req.body);
      sendAuth(res, await auth.pinLogin(input, requestInfo(req)));
    },
  );

  router.post("/refresh", sameOrigin, async (req, res) => {
    try {
      const result = await auth.refresh(readRefreshCookie(req), requestInfo(req));
      setRefreshCookie(res, env, result.refresh.refreshToken, result.refresh.expiresAt);
      res.json({ accessToken: result.accessToken, expiresIn: result.expiresIn });
    } catch (error) {
      clearRefreshCookie(res, env);
      throw error;
    }
  });

  router.post("/logout", sameOrigin, async (req, res) => {
    await auth.logout(readRefreshCookie(req), requestInfo(req));
    clearRefreshCookie(res, env);
    res.status(204).end();
  });

  router.post("/logout-all", requireAuth, async (req, res) => {
    await auth.logoutAll(authOf(req), requestInfo(req));
    clearRefreshCookie(res, env);
    clearTrustedDeviceCookie(res, env);
    res.status(204).end();
  });

  // Segundo paso del login. El bloqueo por cuenta (5 códigos incorrectos) es la defensa principal.
  router.post("/2fa/verify", limit("mfa-verify-ip", 15 * MINUTE, 50), async (req, res) => {
    const input = MfaVerifySchema.parse(req.body);
    const { auth: issued, trustedDevice } = await auth.verifyMfa(input, requestInfo(req));
    if (trustedDevice !== null) {
      setTrustedDeviceCookie(res, env, trustedDevice.token, trustedDevice.expiresAt);
    }
    sendAuth(res, issued);
  });

  // ─── Verificación en dos pasos (la propia persona) ────────────────────────────────────
  const mfaCodes = limit("mfa-code-user", 15 * MINUTE, 20, byUser);
  router.get("/2fa", requireAuth, async (req, res) => {
    res.json(await mfa.status(authOf(req)));
  });
  router.post(
    "/2fa/setup",
    requireAuth,
    limit("mfa-setup-user", HOUR, 20, byUser),
    async (req, res) => {
      res.json(await mfa.setup(authOf(req)));
    },
  );
  router.post("/2fa/enable", requireAuth, mfaCodes, async (req, res) => {
    const { code } = MfaCodeSchema.parse(req.body);
    res.json(await mfa.enable(authOf(req), code, requestInfo(req)));
  });
  router.post("/2fa/confirm", requireAuth, mfaCodes, async (req, res) => {
    const { code } = MfaCodeSchema.parse(req.body);
    res.json(await mfa.confirm(authOf(req), code, requestInfo(req)));
  });
  router.post(
    "/2fa/recovery-codes",
    requireAuth,
    limit("mfa-recovery-user", HOUR, 10, byUser),
    async (req, res) => {
      res.json(await mfa.regenerateRecoveryCodes(authOf(req), requestInfo(req)));
    },
  );
  router.post("/2fa/disable", requireAuth, mfaCodes, async (req, res) => {
    await mfa.disable(authOf(req), MfaDisableSchema.parse(req.body), requestInfo(req));
    clearTrustedDeviceCookie(res, env);
    res.status(204).end();
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.json(await auth.account(authOf(req).userId));
  });

  // Aceptar la versión vigente de los términos (tras un cambio de versión, al iniciar sesión).
  router.post(
    "/accept-terms",
    requireAuth,
    limit("accept-terms-user", HOUR, 20, byUser),
    async (req, res) => {
      AcceptTermsSchema.parse(req.body);
      await auth.acceptTerms(authOf(req), requestInfo(req));
      res.status(204).end();
    },
  );

  router.patch("/me", requireAuth, async (req, res) => {
    await auth.updateProfile(authOf(req), UpdateProfileSchema.parse(req.body), requestInfo(req));
    res.status(204).end();
  });

  router.post(
    "/change-email",
    requireAuth,
    limit("change-email-user", 15 * MINUTE, 5, byUser),
    async (req, res) => {
      const input = ChangeEmailSchema.parse(req.body);
      // Con 2FA activa, cambiar el email pide haber confirmado el código hace poco.
      await mfa.requireRecent(authOf(req));
      await auth.requestEmailChange(
        authOf(req),
        input,
        requestInfo(req),
      );
      res.status(204).end();
    },
  );

  router.get("/sessions", requireAuth, async (req, res) => {
    res.json({ sessions: await auth.listSessions(authOf(req)) });
  });

  router.delete("/sessions/:id", requireAuth, async (req, res) => {
    const { id } = SessionIdSchema.parse(req.params);
    await auth.revokeSession(authOf(req), id, requestInfo(req));
    res.status(204).end();
  });

  // Invitaciones (módulo 2): el token del enlace identifica la invitación. Rate limit en
  // Postgres por IP para que no se pueda probar tokens a ciegas.
  router.get("/invitations/:token", limit("invitation-preview-ip", HOUR, 60), async (req, res) => {
    const { token } = InvitationTokenParamsSchema.parse(req.params);
    res.json(await auth.previewInvitation(token));
  });

  router.post(
    "/invitations/:token/accept",
    limit("invitation-accept-ip", HOUR, 20),
    optionalAuthMiddleware(deps),
    async (req, res) => {
      const { token } = InvitationTokenParamsSchema.parse(req.params);
      const body = AcceptInvitationSchema.parse(req.body ?? {});
      const result = await auth.acceptInvitation(
        token,
        body,
        req.auth?.userId ?? null,
        requestInfo(req),
      );
      if (result.auth === null) {
        res.json({ workspaceSlug: result.workspaceSlug });
        return;
      }
      sendAuth(res, result.auth, 201, { workspaceSlug: result.workspaceSlug });
    },
  );

  router.post("/verify-email", limit("verify-email-ip", 15 * MINUTE, 20), async (req, res) => {
    const { token } = TokenSchema.parse(req.body);
    await auth.verifyEmail(token, requestInfo(req));
    res.status(204).end();
  });

  router.post(
    "/resend-verification",
    requireAuth,
    limit("resend-verification-user", 15 * MINUTE, 3, byUser),
    async (req, res) => {
      await auth.resendVerification(authOf(req));
      res.status(204).end();
    },
  );

  router.post(
    "/forgot-password",
    limit("forgot-password-ip", HOUR, 20),
    limit("forgot-password-ip-email", 15 * MINUTE, 3, byIpAndEmail),
    async (req, res) => {
      const { email } = EmailOnlySchema.parse(req.body);
      await auth.forgotPassword(email, requestInfo(req));
      // Siempre la misma respuesta: no revela si el email existe.
      res.status(204).end();
    },
  );

  router.post("/reset-password", limit("reset-password-ip", 15 * MINUTE, 10), async (req, res) => {
    const { token, password } = ResetPasswordSchema.parse(req.body);
    await auth.resetPassword(token, password, requestInfo(req));
    clearRefreshCookie(res, env);
    res.status(204).end();
  });

  router.post(
    "/change-password",
    requireAuth,
    limit("change-password-user", 15 * MINUTE, 5, byUser),
    async (req, res) => {
      const input = ChangePasswordSchema.parse(req.body);
      await auth.changePassword(authOf(req), input, requestInfo(req));
      res.status(204).end();
    },
  );

  return router;
}
