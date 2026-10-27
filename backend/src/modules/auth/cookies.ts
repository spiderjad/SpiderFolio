// Cookie del refresh token (CLAUDE.md, sección 7.1): HttpOnly, SameSite=Strict, Secure en
// producción, Path=/api/v1/auth y sin Domain (solo app.tudominio.com; la web pública del
// dominio raíz nunca la recibe). Se borra con los mismos atributos con que se creó.
import type { CookieOptions, Request, Response } from "express";
import type { Env } from "../../config/env.ts";

export const REFRESH_COOKIE = "spiderfolio_rt";

function baseOptions(env: Pick<Env, "NODE_ENV">): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
  };
}

export function setRefreshCookie(
  res: Response,
  env: Pick<Env, "NODE_ENV">,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions(env), expires: expiresAt });
}

export function clearRefreshCookie(res: Response, env: Pick<Env, "NODE_ENV">): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(env));
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Dispositivo de confianza de la 2FA («Recordar este dispositivo 30 días»): HttpOnly, SameSite=Strict,
// Secure en producción y la ruta mínima (solo la recibe el login). En la base, solo su SHA-256.
export const TRUSTED_DEVICE_COOKIE = "spiderfolio_td";

function deviceOptions(env: Pick<Env, "NODE_ENV">): CookieOptions {
  return { ...baseOptions(env), path: "/api/v1/auth/login" };
}

export function setTrustedDeviceCookie(
  res: Response,
  env: Pick<Env, "NODE_ENV">,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(TRUSTED_DEVICE_COOKIE, token, { ...deviceOptions(env), expires: expiresAt });
}

export function clearTrustedDeviceCookie(res: Response, env: Pick<Env, "NODE_ENV">): void {
  res.clearCookie(TRUSTED_DEVICE_COOKIE, deviceOptions(env));
}

export function readTrustedDeviceCookie(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    TRUSTED_DEVICE_COOKIE
  ];
  return typeof value === "string" && value !== "" ? value : undefined;
}
