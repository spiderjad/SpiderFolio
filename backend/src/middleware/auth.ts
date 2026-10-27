// authMiddleware (CLAUDE.md, sección 7.4): Bearer JWT HS256 + sesión activa en la base.
// Revocar una sesión corta el acceso aunque el JWT no haya vencido.
import type { Request, RequestHandler } from "express";
import { unauthenticated } from "../lib/errors.ts";
import { verifyAccessToken } from "../lib/jwt.ts";
import type { AppDeps } from "../routes.ts";

type AuthDeps = Pick<AppDeps, "prisma" | "env">;

/** Sesión del Bearer del pedido, o null si no hay token o no sirve (vencido, revocado, ajeno). */
async function resolveAuth(
  req: Request,
  { prisma, env }: AuthDeps,
): Promise<{ userId: string; sessionId: string } | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") === true ? header.slice(7).trim() : "";
  const claims = token === "" ? null : verifyAccessToken(token, env.JWT_ACCESS_SECRET);
  if (claims === null) return null;

  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { id: claims.sessionId },
    select: { userId: true, revokedAt: true, replacedAt: true, expiresAt: true, familyId: true },
  });
  if (session === null || session.userId !== claims.userId) return null;
  if (session.revokedAt === null) {
    return session.expiresAt > now ? { userId: claims.userId, sessionId: claims.sessionId } : null;
  }
  // Rotated by another tab (not revoked by logout or reuse): the access token stays valid until it
  // expires while the family is alive, and the request is bound to the family's active session.
  // Logout, reuse detection and "sign out sessions" revoke the whole family, leaving none active.
  if (session.replacedAt === null) return null;
  const active = await prisma.session.findFirst({
    where: {
      familyId: session.familyId,
      userId: claims.userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return active === null ? null : { userId: claims.userId, sessionId: active.id };
}

export function authMiddleware(deps: AuthDeps): RequestHandler {
  return async (req, _res, next) => {
    const auth = await resolveAuth(req, deps);
    if (auth === null) throw unauthenticated();
    req.auth = auth;
    next();
  };
}

/** Como authMiddleware, pero sin sesión válida deja pasar el pedido como anónimo. */
export function optionalAuthMiddleware(deps: AuthDeps): RequestHandler {
  return async (req, _res, next) => {
    const auth = await resolveAuth(req, deps);
    if (auth !== null) req.auth = auth;
    next();
  };
}
