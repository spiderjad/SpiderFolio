// Access token (CLAUDE.md, sección 7.1): JWT HS256 con sub (userId) y sid (sessionId), sin
// roles ni workspace. El algoritmo está fijo al verificar (nunca "none" ni RS/HS mezclados).
// aud distingue estos tokens de los del conector MCP (9B.2), que llevan la URL del MCP.
import jwt from "jsonwebtoken";

const ALGORITHM = "HS256";
const AUDIENCE = "spiderfolio-app";
const ISSUER = "spiderfolio";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export function signAccessToken(claims: AccessClaims, secret: string, ttlSeconds: number): string {
  return jwt.sign({ sid: claims.sessionId }, secret, {
    algorithm: ALGORITHM,
    subject: claims.userId,
    audience: AUDIENCE,
    issuer: ISSUER,
    expiresIn: ttlSeconds,
  });
}

/** Devuelve null si el token es inválido, vencido o no es un access token de la app. */
export function verifyAccessToken(token: string, secret: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [ALGORITHM],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    if (typeof payload === "string") return null;
    const { sub, sid } = payload as { sub?: unknown; sid?: unknown };
    if (typeof sub !== "string" || typeof sid !== "string") return null;
    return { userId: sub, sessionId: sid };
  } catch {
    return null;
  }
}
