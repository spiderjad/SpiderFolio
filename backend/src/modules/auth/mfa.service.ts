// Verificación en dos pasos (TOTP), parte de la propia persona: alta con QR y código de confirmación,
// códigos de recuperación (10, de un solo uso, solo su hash; se muestran una vez), confirmación
// reciente y desactivación con contraseña y código. Los usuarios de PIN quedan fuera de la 2FA.
// Cada código incorrecto cuenta para el bloqueo (5 seguidos: 15 minutos).
import QRCode from "qrcode";
import { createMfaBox, type MfaBox } from "../../lib/mfa-box.ts";
import { AppError } from "../../lib/errors.ts";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "../../lib/totp.ts";
import type { AppDeps } from "../../routes.ts";
import { auditGlobal } from "../audit/audit.service.ts";
import type { AuthContext } from "./auth.service.ts";
import type { RequestInfo } from "./sessions.service.ts";
import { mfaMessages } from "../../i18n/index.ts";

/** Una confirmación con código vale 10 minutos para las acciones sensibles. */
export const MFA_RECENT_MS = 10 * 60 * 1000;
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_MS = 15 * 60 * 1000;
const ISSUER = "SpiderFolio";

export interface MfaStatus {
  enabled: boolean;
  enabledAt: Date | null;
  /** Códigos de recuperación sin usar. */
  recoveryCodesLeft: number;
  /** La sesión actual confirmó el código hace menos de 10 minutos. */
  recent: boolean;
  /** La 2FA está disponible en este servidor y para esta cuenta (no PIN). */
  available: boolean;
}

export function createMfaService(deps: Pick<AppDeps, "prisma" | "env" | "jobs" | "passwords">) {
  const { prisma, jobs, passwords } = deps;
  const box: MfaBox | null =
    deps.env.MFA_ENCRYPTION_KEY === undefined ? null : createMfaBox(deps.env);
  const requireBox = (): MfaBox => {
    if (box === null) throw new AppError("UNAVAILABLE", { message: mfaMessages.unavailable });
    return box;
  };

  async function loadUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kind: true,
        email: true,
        passwordHash: true,
        totpSecretEnc: true,
        totpEnabledAt: true,
        totpLastStep: true,
        totpFailedCount: true,
        totpLockedUntil: true,
      },
    });
    if (user === null) throw new AppError("UNAUTHENTICATED");
    if (user.kind === "PIN") throw new AppError("FORBIDDEN", { message: mfaMessages.pinUsers });
    return user;
  }
  type LoadedUser = Awaited<ReturnType<typeof loadUser>>;

  async function fail(user: LoadedUser, info: RequestInfo | null, now: Date): Promise<never> {
    const failures = user.totpFailedCount + 1;
    const lock = failures >= MFA_MAX_FAILURES;
    await prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { totpFailedCount: 0, totpLockedUntil: new Date(now.getTime() + MFA_LOCK_MS) }
        : { totpFailedCount: failures },
    });
    await auditGlobal(prisma, {
      actorId: user.id,
      action: lock ? "auth.2fa.locked" : "auth.2fa.failure",
      ...(info ?? {}),
    });
    if (lock) throw new AppError("RATE_LIMITED", { message: mfaMessages.locked });
    throw new AppError("MFA_INVALID_CODE", { message: mfaMessages.invalidCode });
  }

  /**
   * Comprueba un código TOTP (o, si `allowRecovery`, uno de recuperación) contra el secreto guardado,
   * con bloqueo. Un código TOTP aceptado deja de valer (se guarda su paso) y uno de recuperación se
   * gasta. `secretOverride`: el secreto en el alta (todavía sin confirmar).
   */
  async function checkCode(
    user: LoadedUser,
    code: string,
    options: { allowRecovery: boolean; info: RequestInfo | null; now?: Date },
  ): Promise<"totp" | "recovery"> {
    const now = options.now ?? new Date();
    if (user.totpLockedUntil !== null && user.totpLockedUntil > now) {
      throw new AppError("RATE_LIMITED", { message: mfaMessages.locked });
    }
    if (user.totpSecretEnc === null)
      throw new AppError("BAD_REQUEST", { message: mfaMessages.noSetup });
    if (options.allowRecovery && looksLikeRecoveryCode(code)) {
      const used = await prisma.recoveryCode.updateMany({
        where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
        data: { usedAt: now },
      });
      if (used.count === 0) return await fail(user, options.info, now);
      await prisma.user.update({ where: { id: user.id }, data: { totpFailedCount: 0 } });
      await auditGlobal(prisma, {
        actorId: user.id,
        action: "auth.2fa.recovery_used",
        ...(options.info ?? {}),
      });
      return "recovery";
    }
    const secret = requireBox().decrypt(user.id, user.totpSecretEnc);
    const step = verifyTotp(secret, code, now, user.totpLastStep);
    if (step === null) return await fail(user, options.info, now);
    // Solo un pedido gana con el mismo paso: el otro ve count 0 (el código ya se usó).
    const claimed = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
      },
      data: { totpLastStep: step, totpFailedCount: 0 },
    });
    if (claimed.count === 0) return await fail(user, options.info, now);
    return "totp";
  }

  const markSession = (sessionId: string, now: Date) =>
    prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { mfaAt: now } });

  async function newRecoveryCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await prisma.$transaction([
      prisma.recoveryCode.deleteMany({ where: { userId } }),
      prisma.recoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
      }),
    ]);
    return codes;
  }

  return {
    async status(auth: AuthContext, now: Date = new Date()): Promise<MfaStatus> {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { kind: true, totpEnabledAt: true },
      });
      const [left, session] = await Promise.all([
        prisma.recoveryCode.count({ where: { userId: auth.userId, usedAt: null } }),
        prisma.session.findUnique({ where: { id: auth.sessionId }, select: { mfaAt: true } }),
      ]);
      return {
        enabled: user?.totpEnabledAt != null,
        enabledAt: user?.totpEnabledAt ?? null,
        recoveryCodesLeft: user?.totpEnabledAt == null ? 0 : left,
        recent: session?.mfaAt != null && now.getTime() - session.mfaAt.getTime() < MFA_RECENT_MS,
        available: box !== null && user?.kind === "STANDARD",
      };
    },

    /** Paso 1 del alta: secreto nuevo (guardado cifrado, sin activar) y el QR para la app. */
    async setup(auth: AuthContext): Promise<{ secret: string; otpauthUri: string; qr: string }> {
      const sealer = requireBox();
      const user = await loadUser(auth.userId);
      if (user.totpEnabledAt !== null) {
        throw new AppError("CONFLICT", { message: mfaMessages.alreadyEnabled });
      }
      const secret = generateTotpSecret();
      await prisma.user.update({
        where: { id: user.id },
        data: { totpSecretEnc: sealer.encrypt(user.id, secret), totpLastStep: null },
      });
      const uri = otpauthUri({ secret, account: user.email ?? user.id, issuer: ISSUER });
      const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
      return { secret, otpauthUri: uri, qr };
    },

    /** Paso 2 del alta: con el primer código, se activa y se entregan los códigos de recuperación. */
    async enable(
      auth: AuthContext,
      code: string,
      info: RequestInfo,
    ): Promise<{ recoveryCodes: string[] }> {
      requireBox();
      const user = await loadUser(auth.userId);
      if (user.totpEnabledAt !== null) {
        throw new AppError("CONFLICT", { message: mfaMessages.alreadyEnabled });
      }
      await checkCode(user, code, { allowRecovery: false, info });
      const now = new Date();
      await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: now } });
      const recoveryCodes = await newRecoveryCodes(user.id);
      await markSession(auth.sessionId, now);
      await auditGlobal(prisma, { actorId: user.id, action: "auth.2fa.enable", ...info });
      await jobs.enqueue("email-send", { kind: "mfa-enabled", userId: user.id });
      return { recoveryCodes };
    },

    /** Para lo sensible fuera de este módulo (cambiar el email): MFA_RECENT_REQUIRED si hace falta. */
    async requireRecent(auth: AuthContext): Promise<void> {
      await requireRecentMfa(prisma, auth);
    },

    /** Segundo paso del login: el código (o uno de recuperación) de una cuenta con 2FA activa. */
    async verifyLoginCode(userId: string, code: string, info: RequestInfo): Promise<void> {
      const user = await loadUser(userId);
      if (user.totpEnabledAt === null) {
        throw new AppError("BAD_REQUEST", { message: mfaMessages.notEnabled });
      }
      await checkCode(user, code, { allowRecovery: true, info });
    },

    /** Confirmación reciente: un código (o uno de recuperación) vale 10 minutos para lo sensible. */
    async confirm(auth: AuthContext, code: string, info: RequestInfo): Promise<{ mfaAt: Date }> {
      const user = await loadUser(auth.userId);
      if (user.totpEnabledAt === null) {
        throw new AppError("BAD_REQUEST", { message: mfaMessages.notEnabled });
      }
      await checkCode(user, code, { allowRecovery: true, info });
      const now = new Date();
      await markSession(auth.sessionId, now);
      return { mfaAt: now };
    },

    /** Códigos de recuperación nuevos (los anteriores dejan de valer). Pide confirmación reciente. */
    async regenerateRecoveryCodes(
      auth: AuthContext,
      info: RequestInfo,
    ): Promise<{ recoveryCodes: string[] }> {
      const user = await loadUser(auth.userId);
      if (user.totpEnabledAt === null) {
        throw new AppError("BAD_REQUEST", { message: mfaMessages.notEnabled });
      }
      await requireRecentMfa(prisma, auth);
      const recoveryCodes = await newRecoveryCodes(user.id);
      await auditGlobal(prisma, {
        actorId: user.id,
        action: "auth.2fa.recovery_regenerated",
        ...info,
      });
      return { recoveryCodes };
    },

    /** Desactivar: con la contraseña y un código (o uno de recuperación). */
    async disable(
      auth: AuthContext,
      input: { password: string; code: string },
      info: RequestInfo,
    ): Promise<void> {
      const user = await loadUser(auth.userId);
      if (user.totpEnabledAt === null) {
        throw new AppError("BAD_REQUEST", { message: mfaMessages.notEnabled });
      }
      if (
        user.passwordHash === null ||
        !(await passwords.verify(user.passwordHash, input.password))
      ) {
        throw new AppError("INVALID_CREDENTIALS", { message: mfaMessages.wrongPassword });
      }
      await checkCode(user, input.code, { allowRecovery: true, info });
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            totpSecretEnc: null,
            totpEnabledAt: null,
            totpLastStep: null,
            totpFailedCount: 0,
            totpLockedUntil: null,
          },
        }),
        prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
        prisma.trustedDevice.deleteMany({ where: { userId: user.id } }),
        prisma.session.updateMany({ where: { userId: user.id }, data: { mfaAt: null } }),
      ]);
      await auditGlobal(prisma, { actorId: user.id, action: "auth.2fa.disable", ...info });
      await jobs.enqueue("email-send", { kind: "mfa-disabled", userId: user.id });
    },
  };
}

export type MfaService = ReturnType<typeof createMfaService>;

/**
 * Las acciones sensibles (desactivar, regenerar códigos, cambiar la política o el email, reiniciar la
 * 2FA de otro) exigen haber confirmado el código en esta sesión hace menos de 10 minutos. Sin 2FA
 * activa no aplica (no hay código que pedir).
 */
export async function requireRecentMfa(
  prisma: AppDeps["prisma"],
  auth: AuthContext,
  now: Date = new Date(),
): Promise<void> {
  const [user, session] = await Promise.all([
    prisma.user.findUnique({ where: { id: auth.userId }, select: { totpEnabledAt: true } }),
    prisma.session.findUnique({ where: { id: auth.sessionId }, select: { mfaAt: true } }),
  ]);
  if (user?.totpEnabledAt == null) return;
  if (session?.mfaAt == null || now.getTime() - session.mfaAt.getTime() >= MFA_RECENT_MS) {
    throw new AppError("MFA_RECENT_REQUIRED");
  }
}
