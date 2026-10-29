// Tokens de un solo uso (CLAUDE.md, sección 7.3): verificación de email (24 h) y
// restablecimiento de contraseña (1 h). En la base, solo el SHA-256.
import type { Prisma } from "../../generated/prisma/client.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

export const authTokenTypes = {
  VERIFY_EMAIL: { ttlMs: 24 * 3600 * 1000 },
  RESET_PASSWORD: { ttlMs: 3600 * 1000 },
  CHANGE_EMAIL: { ttlMs: 24 * 3600 * 1000 },
  /** Segundo paso del login: la contraseña ya se comprobó; falta el código (5 minutos). */
  MFA_CHALLENGE: { ttlMs: 5 * 60 * 1000 },
} as const;

export type AuthTokenType = keyof typeof authTokenTypes;

type Db = PrismaClient | Prisma.TransactionClient;

/** Crea un token nuevo e invalida los anteriores sin usar del mismo tipo: solo sirve el último. */
export async function issueAuthToken(
  db: Db,
  userId: string,
  type: AuthTokenType,
  now: Date = new Date(),
  data?: Prisma.InputJsonObject,
): Promise<string> {
  const token = randomToken();
  await db.authToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: now },
  });
  await db.authToken.create({
    data: {
      userId,
      type,
      tokenHash: sha256(token),
      ...(data === undefined ? {} : { data }),
      expiresAt: new Date(now.getTime() + authTokenTypes[type].ttlMs),
    },
  });
  return token;
}

/** Marca el token como usado de forma atómica. Devuelve el userId, o null si no sirve. */
export async function consumeAuthToken(
  db: Db,
  token: string,
  type: AuthTokenType,
  now: Date = new Date(),
): Promise<string | null> {
  const tokenHash = sha256(token);
  const claimed = await db.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count === 0) return null;
  const row = await db.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}
