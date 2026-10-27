// Sesiones y refresh tokens (CLAUDE.md, secciones 7.1 y 7.3).
//
// - El refresh token es opaco (32 bytes); en la base solo su SHA-256.
// - Cada uso rota: la fila actual queda revocada con replacedAt y se crea otra en la familia.
// - Vence a los REFRESH_TTL_DAYS sin uso, y nunca después del tope absoluto de la familia
//   (familyCreatedAt + SESSION_MAX_AGE_DAYS): la rotación no lo extiende.
// - Reuso: si llega un token ya rotado hace más de 5 s, se revoca toda la familia y se
//   registra auth.refresh.reuse_detected. Dentro de los 5 s es una carrera entre pestañas: 401
//   sin revocar (la otra pestaña ya tiene la cookie nueva).
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { auditGlobal } from "../audit/audit.service.ts";
import { KIOSK_MAX_AGE_MS } from "../pin/pin-rules.ts";

/** Tope absoluto por defecto; el Módulo 7 permite uno menor por workspace. */
export const SESSION_MAX_AGE_DAYS = 90;
export const ROTATION_GRACE_MS = 5_000;
const DAY_MS = 24 * 3600 * 1000;

type Db = PrismaClient | Prisma.TransactionClient;

export interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionPolicy {
  refreshTtlDays: number;
  maxAgeDays: number;
}

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Con `idleSeconds` (sesión de tablet con PIN) el vencimiento por inactividad es ese lapso y
 * el tope absoluto, KIOSK_MAX_AGE_MS, en lugar de los días de una sesión normal.
 */
export function sessionExpiry(
  familyCreatedAt: Date,
  now: Date,
  policy: SessionPolicy,
  idleSeconds: number | null = null,
): Date {
  const kiosk = idleSeconds !== null;
  const idle = now.getTime() + (kiosk ? idleSeconds * 1000 : policy.refreshTtlDays * DAY_MS);
  const absolute =
    familyCreatedAt.getTime() + (kiosk ? KIOSK_MAX_AGE_MS : policy.maxAgeDays * DAY_MS);
  return new Date(Math.min(idle, absolute));
}

/** Nueva familia (login o registro). */
export async function createSession(
  db: Db,
  userId: string,
  info: RequestInfo,
  policy: SessionPolicy,
  now: Date = new Date(),
  idleSeconds: number | null = null,
  mfaAt: Date | null = null,
): Promise<IssuedSession> {
  return await insertSession(
    db,
    { userId, familyId: randomUUID(), familyCreatedAt: now, idleSeconds, mfaAt },
    info,
    policy,
    now,
  );
}

async function insertSession(
  db: Db,
  family: {
    userId: string;
    familyId: string;
    familyCreatedAt: Date;
    idleSeconds: number | null;
    /** Cuándo pasó el segundo paso (2FA); al rotar se conserva. */
    mfaAt?: Date | null;
  },
  info: RequestInfo,
  policy: SessionPolicy,
  now: Date,
): Promise<IssuedSession> {
  const refreshToken = randomToken();
  const expiresAt = sessionExpiry(family.familyCreatedAt, now, policy, family.idleSeconds);
  const session = await db.session.create({
    data: {
      ...family,
      tokenHash: sha256(refreshToken),
      userAgent: info.userAgent,
      ip: info.ip,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
    },
    select: { id: true },
  });
  return { sessionId: session.id, familyId: family.familyId, refreshToken, expiresAt };
}

export type RotationResult =
  | { ok: true; session: IssuedSession; userId: string; idleSeconds: number | null }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "race" | "reuse" };

export async function rotateSession(
  prisma: PrismaClient,
  refreshToken: string,
  info: RequestInfo,
  policy: SessionPolicy,
  now: Date = new Date(),
): Promise<RotationResult> {
  const current = await prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
  if (current === null) return { ok: false, reason: "unknown" };

  if (current.revokedAt !== null) {
    if (current.replacedAt === null) return { ok: false, reason: "revoked" };
    if (now.getTime() - current.replacedAt.getTime() <= ROTATION_GRACE_MS) {
      return { ok: false, reason: "race" };
    }
    await revokeFamily(prisma, current.familyId, now);
    await auditGlobal(prisma, {
      actorId: current.userId,
      action: "auth.refresh.reuse_detected",
      entityType: "session",
      entityId: current.familyId,
      ...info,
    });
    return { ok: false, reason: "reuse" };
  }

  if (
    current.expiresAt <= now ||
    sessionExpiry(current.familyCreatedAt, now, policy, current.idleSeconds) <= now
  ) {
    return { ok: false, reason: "expired" };
  }

  return await prisma.$transaction(async (tx) => {
    // Solo una rotación gana: la otra ve count 0 y se trata como carrera.
    const claimed = await tx.session.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: now, replacedAt: now },
    });
    if (claimed.count === 0) return { ok: false, reason: "race" } as const;
    const session = await insertSession(
      tx,
      {
        userId: current.userId,
        familyId: current.familyId,
        familyCreatedAt: current.familyCreatedAt,
        idleSeconds: current.idleSeconds,
        mfaAt: current.mfaAt,
      },
      info,
      policy,
      now,
    );
    return { ok: true, session, userId: current.userId, idleSeconds: current.idleSeconds } as const;
  });
}

export async function revokeFamily(db: Db, familyId: string, now: Date = new Date()) {
  await db.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
}

/** Revoca todas las sesiones del usuario, salvo (opcionalmente) una familia. */
export async function revokeUserSessions(
  db: Db,
  userId: string,
  options: { exceptFamilyId?: string } = {},
  now: Date = new Date(),
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptFamilyId === undefined
        ? {}
        : { familyId: { not: options.exceptFamilyId } }),
    },
    data: { revokedAt: now },
  });
  // Cerrar todas las sesiones también olvida los dispositivos de confianza de la 2FA.
  await db.trustedDevice.deleteMany({ where: { userId } });
  return result.count;
}
