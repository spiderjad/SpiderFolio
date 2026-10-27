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

  const session = await prisma.session.findUnique({
    where: { id: claims.sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (
    session === null ||
    session.userId !== claims.userId ||
    session.revokedAt !== null ||
    session.expiresAt <= new Date()
  ) {
    return null;
  }
  return { userId: claims.userId, sessionId: claims.sessionId };
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
