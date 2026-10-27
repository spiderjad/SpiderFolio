// Autenticación (CLAUDE.md, secciones 7.1 a 7.3). Usa el cliente base: User, Session y
// AuthToken son globales. Las transacciones que envían emails encolan dentro de la misma
// transacción, así nunca sale un email de algo que se revirtió.
import type { z } from "zod";
import { invitationMessages, pinMessages, specificErrorMessages, accountMessages, mfaLoginMessages } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { signAccessToken } from "../../lib/jwt.ts";
import { violatedUniqueIndex } from "../../lib/prisma-errors.ts";
import type { AppDeps } from "../../routes.ts";
import { auditGlobal } from "../audit/audit.service.ts";
import { describeDevice } from "../../emails/templates.ts";
import { isCapability, registeredPluginCapabilities } from "../roles/capabilities.ts";
import { createWorkspaceWithOwner, withSlugRetry } from "../workspaces/workspaces.service.ts";
import { consumeAuthToken, issueAuthToken } from "./auth-tokens.ts";
import { createMfaService } from "./mfa.service.ts";
import type {
  ChangeEmailSchema,
  ChangePasswordSchema,
  LoginSchema,
  PinLoginSchema,
  RegisterSchema,
  UpdateProfileSchema,
} from "./auth.schemas.ts";
import { MAX_PIN_FAILURES, pinLockMs } from "../pin/pin-rules.ts";
import { readPinLoginSettings } from "../workspaces/settings.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { userMediaUrl } from "../profile-media/profile-media.service.ts";
import {
  createSession,
  revokeFamily,
  revokeUserSessions,
  rotateSession,
  SESSION_MAX_AGE_DAYS,
  type IssuedSession,
  type RequestInfo,
  type SessionPolicy,
} from "./sessions.service.ts";
import {
  currentLocale,
  isLocale,
  readWorkspaceLocale,
  type Locale,
} from "../../i18n/locales.ts";

/** Bloqueo tras fallos seguidos (7.3). */
export const MAX_FAILED_LOGINS = 10;
export const LOCK_MS = 15 * 60 * 1000;
/** Sin una sesión con el mismo user agent en este lapso, el login avisa por email. */
const NEW_DEVICE_WINDOW_MS = 30 * 24 * 3600 * 1000;

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface Account {
  user: {
    id: string;
    kind: "STANDARD" | "PIN";
    /** null en los usuarios de PIN (lectores de planta sin email). */
    email: string | null;
    name: string;
    emailVerified: boolean;
    /** Equipo de SpiderFolio: ve el backoffice /internal. */
    isStaff: boolean;
    /** Tiene activa la verificación en dos pasos. */
    twoFactor: boolean;
    /** Email nuevo pedido, a la espera de su confirmación. */
    pendingEmail: string | null;
    /** null: sigue el idioma de la empresa. */
    locale: Locale | null;
    avatarKey: string | null;
    /** Direcciones de la foto y la portada (null sin imagen) y el encuadre vertical de la portada. */
    avatarUrl: string | null;
    coverUrl: string | null;
    coverPositionY: number;
    /** Términos y Privacidad: `required` pide aceptar la versión vigente antes de seguir. */
    terms: { currentVersion: string; acceptedVersion: string | null; required: boolean };
    marketingOptIn: boolean;
  };
  /** Sesión de tablet (usuario + PIN): cierre por inactividad y después de confirmar una lectura. */
  kiosk: { idleSeconds: number; closeAfterConfirm: boolean } | null;
  /** Lo que ofrece esta instalación (para avisar en la app lo que no está). */
  instance: { controlledPdf: boolean };
  memberships: {
    id: string;
    seatType: string;
    jobTitle: string | null;
    workspace: {
      id: string;
      name: string;
      slug: string;
      accentColor: string | null;
      logoKey: string | null;
      /** Idioma por defecto de la empresa. */
      locale: Locale;
    };
    role: { id: string; name: string; base: string };
    capabilities: string[];
    departments: { id: string; name: string; position: "HEAD" | "DEPUTY" | "MEMBER" }[];
    /** Jefe o subjefe con plaza completa: la interfaz le muestra Miembros y Departamentos. */
    leadsDepartments: boolean;
    /** La política del workspace le exige verificación en dos pasos (la tenga o no). */
    mfaRequired: boolean;
  }[];
}

/** El login con 2FA activa no abre sesión: devuelve el desafío para el segundo paso. */
export type LoginResult = IssuedAuth | { mfaRequired: true; challenge: string; expiresIn: number };

export const MFA_CHALLENGE_SECONDS = 5 * 60;
/** «Recordar este dispositivo»: 30 días. */
export const TRUSTED_DEVICE_MS = 30 * 24 * 3600 * 1000;

export interface IssuedAuth extends Account {
  accessToken: string;
  expiresIn: number;
  refresh: IssuedSession;
}

/** Datos de la sesión de tablet: solo para quien entra con PIN, según los ajustes de su workspace. */
function kioskOf(kind: string, settings: unknown): Account["kiosk"] {
  if (kind !== "PIN") return null;
  const pin = readPinLoginSettings(settings);
  return { idleSeconds: pin.idleMinutes * 60, closeAfterConfirm: pin.closeAfterConfirm };
}

const invalidCredentials = () => new AppError("INVALID_CREDENTIALS");
const invalidToken = () => new AppError("INVALID_TOKEN");

export function createAuthService(deps: AppDeps) {
  const { prisma, env, jobs, passwords } = deps;
  const mfa = createMfaService(deps);
  const policy: SessionPolicy = {
    refreshTtlDays: env.REFRESH_TTL_DAYS,
    maxAgeDays: SESSION_MAX_AGE_DAYS,
  };

  /** Access token de una sesión de tablet: nunca vive más que su lapso de inactividad. */
  const accessTtl = (idleSeconds: number | null) =>
    idleSeconds === null ? env.JWT_ACCESS_TTL : Math.min(env.JWT_ACCESS_TTL, idleSeconds);

  const accessToken = (userId: string, sessionId: string, ttlSeconds = env.JWT_ACCESS_TTL) =>
    signAccessToken({ userId, sessionId }, env.JWT_ACCESS_SECRET, ttlSeconds);

  async function account(userId: string): Promise<Account> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kind: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        pendingEmail: true,
        locale: true,
        avatarKey: true,
        coverKey: true,
        coverPositionY: true,
        marketingOptIn: true,
        isStaff: true,
        totpEnabledAt: true,
        termsAcceptances: { orderBy: { acceptedAt: "desc" }, take: 1, select: { version: true } },
        memberships: {
          // Suspendido o workspace borrado: no aparece (7.3).
          where: { status: "ACTIVE", workspace: { deletedAt: null } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            seatType: true,
            jobTitle: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                accentColor: true,
                logoKey: true,
                settings: true,
              },
            },
            role: { select: { id: true, name: true, base: true, capabilities: true } },
            departments: {
              select: { position: true, department: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (user === null) throw new AppError("UNAUTHENTICATED");
    const acceptedVersion = user.termsAcceptances[0]?.version ?? null;
    return {
      user: {
        id: user.id,
        kind: user.kind,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerifiedAt !== null,
        isStaff: user.isStaff,
        twoFactor: user.totpEnabledAt !== null,
        pendingEmail: user.pendingEmail,
        locale: isLocale(user.locale) ? user.locale : null,
        avatarKey: user.avatarKey,
        avatarUrl: userMediaUrl("avatar", user.id, user.avatarKey),
        coverUrl: userMediaUrl("cover", user.id, user.coverKey),
        coverPositionY: user.coverPositionY,
        terms: {
          currentVersion: env.TERMS_VERSION,
          acceptedVersion,
          // Los usuarios de PIN (tablets de planta, sin email) no aceptan términos.
          required: user.kind === "STANDARD" && acceptedVersion !== env.TERMS_VERSION,
        },
        marketingOptIn: user.marketingOptIn,
      },
      kiosk: kioskOf(user.kind, user.memberships[0]?.workspace.settings),
      instance: { controlledPdf: env.GOTENBERG_URL !== undefined },
      memberships: await Promise.all(
        user.memberships.map(async (m) => ({
          id: m.id,
          seatType: m.seatType,
          jobTitle: m.jobTitle,
          workspace: {
            id: m.workspace.id,
            name: m.workspace.name,
            slug: m.workspace.slug,
            accentColor: m.workspace.accentColor,
            logoKey: m.workspace.logoKey,
            locale: readWorkspaceLocale(m.workspace.settings),
          },
          role: { id: m.role.id, name: m.role.name, base: m.role.base },
          // El propietario tiene también las capacidades de los plugins instalados.
          capabilities: [
            ...m.role.capabilities.filter(isCapability),
            ...(m.role.base === "OWNER" ? registeredPluginCapabilities() : []),
          ],
          departments: m.departments.map((d) => ({ ...d.department, position: d.position })),
          leadsDepartments:
            m.seatType === "FULL" &&
            m.role.base !== "GUEST" &&
            m.departments.some((d) => d.position !== "MEMBER"),
          // 2FA obligatoria: la decide un plugin activo (las cuentas de PIN quedan siempre fuera).
          mfaRequired:
            user.kind === "STANDARD" &&
            (await deps.plugins.mfaRequired(m.workspace.id, {
              userKind: user.kind,
              roleBase: m.role.base,
              capabilities: m.role.capabilities,
            })),
        })),
      ),
    };
  }

  async function issue(
    userId: string,
    refresh: IssuedSession,
    ttlSeconds = env.JWT_ACCESS_TTL,
  ): Promise<IssuedAuth> {
    return {
      accessToken: accessToken(userId, refresh.sessionId, ttlSeconds),
      expiresIn: ttlSeconds,
      refresh,
      ...(await account(userId)),
    };
  }

  /** Invitación pendiente de ese token (la identifica su SHA-256) o INVALID_TOKEN. */
  async function findPendingInvitation(token: string) {
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      select: {
        id: true,
        workspaceId: true,
        email: true,
        roleId: true,
        seatType: true,
        departmentIds: true,
        invitedById: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        role: { select: { name: true, base: true } },
        workspace: { select: { name: true, slug: true, deletedAt: true } },
      },
    });
    if (
      invitation === null ||
      invitation.acceptedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt <= new Date() ||
      invitation.workspace.deletedAt !== null
    ) {
      throw invalidToken();
    }
    return invitation;
  }

  /** Casilla de novedades por email: se guarda aparte de la aceptación de los términos. */
  const marketingData = (optIn: boolean | undefined, now: Date) =>
    optIn === true ? { marketingOptIn: true, marketingOptInAt: now } : {};

  /** Evidencia de la aceptación: usuario, fecha, IP, user agent y versión vigente. */
  const recordTermsAcceptance = async (
    db: Pick<typeof prisma, "termsAcceptance">,
    userId: string,
    info: RequestInfo,
  ) => {
    await db.termsAcceptance.create({
      data: { userId, version: env.TERMS_VERSION, ip: info.ip, userAgent: info.userAgent },
    });
  };

  const entry = {
    account,

    async register(input: z.infer<typeof RegisterSchema>, info: RequestInfo): Promise<IssuedAuth> {
      const passwordHash = await passwords.hash(input.password);
      try {
        const { userId, session } = await withSlugRetry(() =>
          prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                email: input.email,
                name: input.name,
                passwordHash,
                // El idioma con el que se registró (el del navegador o el elegido en la pantalla).
                locale: currentLocale(),
                ...marketingData(input.marketingOptIn, new Date()),
              },
              select: { id: true },
            });
            await recordTermsAcceptance(tx, user.id, info);
            await createWorkspaceWithOwner(tx, {
              name: input.companyName,
              ownerUserId: user.id,
              settings: { timezone: input.timezone, locale: currentLocale() },
              request: info,
            });
            const session = await createSession(tx, user.id, info, policy);
            await auditGlobal(tx, { actorId: user.id, action: "auth.register", ...info });
            await jobs.enqueue("email-send", { kind: "verify-email", userId: user.id }, { tx });
            return { userId: user.id, session };
          }),
        );
        return await issue(userId, session);
      } catch (error) {
        if (violatedUniqueIndex(error) === "User_email_key") {
          throw new AppError("CONFLICT", { message: specificErrorMessages.emailTaken });
        }
        throw error;
      }
    },

    /**
     * Error único y mismo trabajo en los tres casos (email inexistente, contraseña incorrecta,
     * cuenta bloqueada): siempre una verificación de argon2.
     */
    /**
     * Primer paso: email y contraseña. Con la 2FA activa (y sin un dispositivo de confianza válido)
     * no abre sesión: devuelve un desafío de 5 minutos para el segundo paso (`verifyMfa`).
     */
    async login(
      input: z.infer<typeof LoginSchema>,
      info: RequestInfo,
      trustedDeviceToken?: string,
    ): Promise<LoginResult> {
      const now = new Date();
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true, passwordHash: true, lockedUntil: true, totpEnabledAt: true },
      });

      // Un usuario de PIN no tiene contraseña: por esta vía es igual que un email inexistente.
      if (user === null || user.passwordHash === null) {
        await passwords.verifyDummy(input.password);
        await auditGlobal(prisma, {
          action: "auth.login.failure",
          metadata: { reason: "unknown_email" },
          ...info,
        });
        throw invalidCredentials();
      }

      if (user.lockedUntil !== null && user.lockedUntil > now) {
        await passwords.verifyDummy(input.password);
        await auditGlobal(prisma, {
          actorId: user.id,
          action: "auth.login.failure",
          metadata: { reason: "locked" },
          ...info,
        });
        throw invalidCredentials();
      }

      if (!(await passwords.verify(user.passwordHash, input.password))) {
        const { failedLogins } = await prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: { increment: 1 } },
          select: { failedLogins: true },
        });
        if (failedLogins >= MAX_FAILED_LOGINS) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) },
          });
          await auditGlobal(prisma, { actorId: user.id, action: "auth.lockout", ...info });
        }
        await auditGlobal(prisma, {
          actorId: user.id,
          action: "auth.login.failure",
          metadata: { reason: "wrong_password" },
          ...info,
        });
        throw invalidCredentials();
      }

      // Parámetros de argon2 viejos: se recalcula el hash ahora que tenemos la contraseña.
      const newHash = passwords.needsRehash(user.passwordHash)
        ? await passwords.hash(input.password)
        : null;

      if (user.totpEnabledAt !== null && !(await trustedDevice(user.id, trustedDeviceToken, now))) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLogins: 0,
            lockedUntil: null,
            ...(newHash === null ? {} : { passwordHash: newHash }),
          },
        });
        const challenge = await issueAuthToken(prisma, user.id, "MFA_CHALLENGE", now);
        await auditGlobal(prisma, {
          actorId: user.id,
          action: "auth.login.mfa_challenge",
          ...info,
        });
        return { mfaRequired: true, challenge, expiresIn: MFA_CHALLENGE_SECONDS };
      }
      return await openSession(user.id, info, now, { rehashed: newHash, mfaAt: null });
    },

    /**
     * Segundo paso: el desafío del login y el código de la app (o uno de recuperación). Solo acá se
     * abre la sesión. El desafío sobrevive a un código incorrecto (lo frena el bloqueo de la 2FA) y
     * se gasta al acertar. `remember`: este navegador no vuelve a pedir el código durante 30 días.
     */
    async verifyMfa(
      input: { challenge: string; code: string; remember: boolean },
      info: RequestInfo,
    ): Promise<{ auth: IssuedAuth; trustedDevice: { token: string; expiresAt: Date } | null }> {
      const now = new Date();
      const row = await prisma.authToken.findUnique({
        where: { tokenHash: sha256(input.challenge) },
        select: { userId: true, type: true, usedAt: true, expiresAt: true },
      });
      if (
        row === null ||
        row.type !== "MFA_CHALLENGE" ||
        row.usedAt !== null ||
        row.expiresAt <= now
      ) {
        throw new AppError("INVALID_TOKEN", { message: mfaLoginMessages.challengeExpired });
      }
      await mfa.verifyLoginCode(row.userId, input.code, info);
      const userId = await consumeAuthToken(prisma, input.challenge, "MFA_CHALLENGE", now);
      if (userId === null) {
        throw new AppError("INVALID_TOKEN", { message: mfaLoginMessages.challengeExpired });
      }
      const issued = await openSession(userId, info, now, { rehashed: null, mfaAt: now });
      let device: { token: string; expiresAt: Date } | null = null;
      if (input.remember) {
        const token = randomToken();
        const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_MS);
        await prisma.trustedDevice.create({
          data: { userId, tokenHash: sha256(token), userAgent: info.userAgent, expiresAt },
        });
        await auditGlobal(prisma, { actorId: userId, action: "auth.2fa.device_trusted", ...info });
        device = { token, expiresAt };
      }
      return { auth: issued, trustedDevice: device };
    },
  };

  /** El dispositivo de confianza del navegador (cookie) es de esta persona y sigue vigente. */
  async function trustedDevice(userId: string, token: string | undefined, now: Date) {
    if (token === undefined) return false;
    const touched = await prisma.trustedDevice.updateMany({
      where: { tokenHash: sha256(token), userId, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    return touched.count > 0;
  }

  async function openSession(
    userId: string,
    info: RequestInfo,
    now: Date,
    options: { rehashed: string | null; mfaAt: Date | null },
  ): Promise<IssuedAuth> {
    const user = { id: userId };
    const newHash = options.rehashed;
    const session = await prisma.$transaction(async (tx) => {
      const previous = await tx.session.findMany({
        where: { userId: user.id },
        select: { userAgent: true, createdAt: true },
      });
      const knownDevice = previous.some(
        (s) =>
          s.userAgent === info.userAgent &&
          now.getTime() - s.createdAt.getTime() <= NEW_DEVICE_WINDOW_MS,
      );
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLogins: 0,
          lockedUntil: null,
          ...(newHash === null ? {} : { passwordHash: newHash }),
        },
      });
      const issued = await createSession(tx, user.id, info, policy, now, null, options.mfaAt);
      await auditGlobal(tx, {
        actorId: user.id,
        action: "auth.login",
        ...info,
        metadata: {
          ...(newHash === null ? {} : { rehashed: true }),
          ...(options.mfaAt === null ? {} : { mfa: true }),
        },
      });
      if (previous.length > 0 && !knownDevice) {
        await jobs.enqueue(
          "email-send",
          { kind: "new-login", userId: user.id, sessionId: issued.sessionId },
          { tx },
        );
      }
      return issued;
    });
    return await issue(user.id, session);
  }

  const service = {
    /**
     * Ingreso de lectores de planta con usuario + PIN (7.6). Error único y mismo trabajo (una
     * verificación de argon2) si el workspace no existe, el ingreso con PIN está apagado, el
     * usuario no existe, el PIN es incorrecto, la cuenta está bloqueada o suspendida.
     */
    async pinLogin(input: z.infer<typeof PinLoginSchema>, info: RequestInfo): Promise<IssuedAuth> {
      const now = new Date();
      const fail = async (
        reason: string,
        who: { workspaceId?: string; actorId?: string } = {},
      ): Promise<never> => {
        await auditGlobal(prisma, {
          workspaceId: who.workspaceId ?? null,
          actorId: who.actorId ?? null,
          action: "pin.login.failure",
          metadata: { reason },
          ...info,
        });
        throw new AppError("INVALID_CREDENTIALS", { message: pinMessages.invalidCredentials });
      };

      const workspace = await prisma.workspace.findFirst({
        where: { slug: input.workspaceSlug, deletedAt: null },
        select: { id: true, settings: true },
      });
      const settings = workspace === null ? null : readPinLoginSettings(workspace.settings);
      const credential =
        workspace === null || settings?.enabled !== true
          ? null
          : await prisma.pinLogin.findUnique({
              where: {
                workspaceId_loginName: { workspaceId: workspace.id, loginName: input.loginName },
              },
              select: {
                id: true,
                pinHash: true,
                lockedUntil: true,
                lockCount: true,
                membership: { select: { id: true, userId: true, status: true } },
              },
            });

      if (workspace === null || settings === null || credential === null) {
        await passwords.verifyDummy(input.pin);
        return await fail("unknown", workspace === null ? {} : { workspaceId: workspace.id });
      }
      const who = { workspaceId: workspace.id, actorId: credential.membership.userId };

      if (credential.lockedUntil !== null && credential.lockedUntil > now) {
        await passwords.verifyDummy(input.pin);
        return await fail("locked", who);
      }

      if (!(await passwords.verify(credential.pinHash, input.pin))) {
        const { failedAttempts } = await prisma.pinLogin.update({
          where: { id: credential.id },
          data: { failedAttempts: { increment: 1 } },
          select: { failedAttempts: true },
        });
        if (failedAttempts >= MAX_PIN_FAILURES) {
          const lockCount = credential.lockCount + 1;
          const lockedUntil = new Date(now.getTime() + pinLockMs(lockCount));
          await prisma.pinLogin.update({
            where: { id: credential.id },
            data: { failedAttempts: 0, lockCount, lockedUntil },
          });
          await auditGlobal(prisma, {
            ...who,
            action: "pin.login.locked",
            metadata: { lockCount },
            ...info,
          });
        }
        return await fail("wrong_pin", who);
      }

      if (credential.membership.status !== "ACTIVE") return await fail("suspended", who);

      const newHash = passwords.needsRehash(credential.pinHash)
        ? await passwords.hash(input.pin)
        : null;
      const idleSeconds = settings.idleMinutes * 60;
      const session = await prisma.$transaction(async (tx) => {
        await tx.pinLogin.update({
          where: { id: credential.id },
          data: {
            failedAttempts: 0,
            lockCount: 0,
            lockedUntil: null,
            ...(newHash === null ? {} : { pinHash: newHash }),
          },
        });
        const issued = await createSession(
          tx,
          credential.membership.userId,
          info,
          policy,
          now,
          idleSeconds,
        );
        await auditGlobal(tx, { ...who, action: "pin.login.success", ...info });
        return issued;
      });
      return await issue(credential.membership.userId, session, accessTtl(idleSeconds));
    },

    async refresh(refreshToken: string | undefined, info: RequestInfo) {
      if (refreshToken === undefined) throw new AppError("UNAUTHENTICATED");
      const result = await rotateSession(prisma, refreshToken, info, policy);
      if (!result.ok) throw new AppError("UNAUTHENTICATED");
      return {
        accessToken: accessToken(
          result.userId,
          result.session.sessionId,
          accessTtl(result.idleSeconds),
        ),
        expiresIn: accessTtl(result.idleSeconds),
        refresh: result.session,
      };
    },

    async logout(refreshToken: string | undefined, info: RequestInfo): Promise<void> {
      if (refreshToken === undefined) return;
      const session = await prisma.session.findUnique({
        where: { tokenHash: sha256(refreshToken) },
        select: { userId: true, familyId: true },
      });
      if (session === null) return;
      await revokeFamily(prisma, session.familyId);
      await auditGlobal(prisma, { actorId: session.userId, action: "auth.logout", ...info });
    },

    async logoutAll(auth: AuthContext, info: RequestInfo): Promise<void> {
      await revokeUserSessions(prisma, auth.userId);
      await auditGlobal(prisma, { actorId: auth.userId, action: "auth.logout_all", ...info });
    },

    async listSessions(auth: AuthContext) {
      const current = await prisma.session.findUnique({
        where: { id: auth.sessionId },
        select: { familyId: true },
      });
      const sessions = await prisma.session.findMany({
        where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastUsedAt: "desc" },
        select: {
          id: true,
          familyId: true,
          userAgent: true,
          ip: true,
          familyCreatedAt: true,
          lastUsedAt: true,
        },
      });
      return sessions.map((s) => ({
        id: s.id,
        device: describeDevice(s.userAgent),
        userAgent: s.userAgent,
        ip: s.ip,
        signedInAt: s.familyCreatedAt,
        lastUsedAt: s.lastUsedAt,
        current: s.familyId === current?.familyId,
      }));
    },

    async revokeSession(auth: AuthContext, sessionId: string, info: RequestInfo): Promise<void> {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId: auth.userId, revokedAt: null },
        select: { familyId: true },
      });
      if (session === null) throw new AppError("NOT_FOUND");
      await revokeFamily(prisma, session.familyId);
      await auditGlobal(prisma, {
        actorId: auth.userId,
        action: "auth.session.revoke",
        entityType: "session",
        entityId: session.familyId,
        ...info,
      });
    },

    /** Datos de una invitación para la pantalla de aceptación (el token prueba que es suya). */
    async previewInvitation(token: string) {
      const invitation = await findPendingInvitation(token);
      const account = await prisma.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      const inviter = await prisma.user.findUnique({
        where: { id: invitation.invitedById },
        select: { name: true },
      });
      return {
        email: invitation.email,
        workspaceName: invitation.workspace.name,
        roleName: invitation.role.name,
        inviterName: inviter?.name ?? null,
        hasAccount: account !== null,
        expiresAt: invitation.expiresAt,
      };
    },

    /**
     * Acepta una invitación. Sin cuenta para ese email: crea la cuenta (el email queda
     * verificado, el enlace prueba que es suyo) y abre sesión. Con cuenta: exige haber iniciado
     * sesión con ella.
     */
    async acceptInvitation(
      token: string,
      body: {
        name?: string | undefined;
        password?: string | undefined;
        acceptTerms?: boolean | undefined;
        marketingOptIn?: boolean | undefined;
      },
      authUserId: string | null,
      info: RequestInfo,
    ): Promise<{ workspaceSlug: string; auth: IssuedAuth | null }> {
      const invitation = await findPendingInvitation(token);
      const existing = await prisma.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (existing !== null) {
        if (authUserId === null) {
          throw new AppError("CONFLICT", { message: invitationMessages.alreadyHasAccount });
        }
        if (authUserId !== existing.id) {
          throw new AppError("FORBIDDEN", { message: invitationMessages.wrongAccount });
        }
      } else if (body.name === undefined || body.password === undefined) {
        throw new AppError("BAD_REQUEST", { message: invitationMessages.detailsRequired });
      } else if (body.acceptTerms !== true) {
        // Crear la cuenta exige aceptar los términos; quien ya tiene cuenta los aceptó al registrarse.
        throw new AppError("BAD_REQUEST", { message: invitationMessages.termsRequired });
      }
      const passwordHash =
        existing === null && body.password !== undefined
          ? await passwords.hash(body.password)
          : null;

      const now = new Date();
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.invitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { acceptedAt: now },
        });
        if (claimed.count === 0) throw invalidToken();

        let userId = existing?.id ?? null;
        if (userId === null) {
          const created = await tx.user.create({
            data: {
              email: invitation.email,
              name: body.name ?? "",
              passwordHash: passwordHash ?? "",
              emailVerifiedAt: now,
              // El idioma con el que aceptó la invitación; el de la empresa no cambia.
              locale: currentLocale(),
              ...marketingData(body.marketingOptIn, now),
            },
            select: { id: true },
          });
          userId = created.id;
          await recordTermsAcceptance(tx, userId, info);
        }
        await tx.membership.create({
          data: {
            userId,
            workspaceId: invitation.workspaceId,
            roleId: invitation.roleId,
            seatType: invitation.seatType,
          },
        });
        // Los departamentos que ya no existen se omiten; un invitado externo no entra a ninguno.
        if (invitation.role.base !== "GUEST" && invitation.departmentIds.length > 0) {
          const [membership, departments] = await Promise.all([
            tx.membership.findUniqueOrThrow({
              where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
              select: { id: true },
            }),
            tx.department.findMany({
              where: { id: { in: invitation.departmentIds }, workspaceId: invitation.workspaceId },
              select: { id: true },
            }),
          ]);
          await tx.departmentMember.createMany({
            data: departments.map((d) => ({
              departmentId: d.id,
              membershipId: membership.id,
              workspaceId: invitation.workspaceId,
            })),
            skipDuplicates: true,
          });
        }
        await auditGlobal(tx, {
          workspaceId: invitation.workspaceId,
          actorId: userId,
          action: "invitation.accept",
          entityType: "Invitation",
          entityId: invitation.id,
          ...info,
        });
        const session = existing === null ? await createSession(tx, userId, info, policy) : null;
        return { userId, session };
      });

      return {
        workspaceSlug: invitation.workspace.slug,
        auth: result.session === null ? null : await issue(result.userId, result.session),
      };
    },

    /** Acepta la versión vigente de los términos (queda la evidencia de esta aceptación). */
    async acceptTerms(auth: AuthContext, info: RequestInfo): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await recordTermsAcceptance(tx, auth.userId, info);
        await auditGlobal(tx, {
          actorId: auth.userId,
          action: "auth.terms.accept",
          metadata: { version: env.TERMS_VERSION },
          ...info,
        });
      });
    },

    async verifyEmail(token: string, info: RequestInfo): Promise<void> {
      await prisma.$transaction(async (tx) => {
        let userId = await consumeAuthToken(tx, token, "VERIFY_EMAIL");
        if (userId === null) {
          // ¿Es la confirmación de un cambio de email? El nuevo reemplaza al actual.
          userId = await consumeAuthToken(tx, token, "CHANGE_EMAIL");
          if (userId === null) throw invalidToken();
          const pending = await tx.user.findUnique({
            where: { id: userId },
            select: { pendingEmail: true },
          });
          if (pending?.pendingEmail == null) throw invalidToken();
          try {
            await tx.user.update({
              where: { id: userId },
              data: {
                email: pending.pendingEmail,
                emailVerifiedAt: new Date(),
                pendingEmail: null,
              },
            });
          } catch (error) {
            // Otra cuenta lo tomó mientras tanto.
            if (violatedUniqueIndex(error) === "User_email_key") throw invalidToken();
            throw error;
          }
          await auditGlobal(tx, { actorId: userId, action: "auth.email.change", ...info });
          return;
        }
        await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: new Date() },
        });
        await auditGlobal(tx, { actorId: userId, action: "auth.email.verify", ...info });
      });
    },

    /** Corregir el propio nombre (es el de la cuenta, el mismo en todas sus empresas). */
    async updateProfile(
      auth: AuthContext,
      input: z.infer<typeof UpdateProfileSchema>,
      info: RequestInfo,
    ): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: auth.userId },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.locale === undefined ? {} : { locale: input.locale }),
          },
        });
        await auditGlobal(tx, { actorId: auth.userId, action: "auth.profile.update", ...info });
      });
    },

    /**
     * Pedir otro email: con la contraseña actual, y el nuevo solo reemplaza al actual cuando se
     * confirma con el enlace que le llega (hasta entonces se sigue entrando con el de siempre).
     */
    async requestEmailChange(
      auth: AuthContext,
      input: z.infer<typeof ChangeEmailSchema>,
      info: RequestInfo,
    ): Promise<void> {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { passwordHash: true, kind: true, email: true },
      });
      if (user === null || user.kind === "PIN") throw new AppError("FORBIDDEN");
      if (
        user.passwordHash == null ||
        !(await passwords.verify(user.passwordHash, input.currentPassword))
      ) {
        throw new AppError("INVALID_CREDENTIALS", {
          message: accountMessages.currentPasswordWrong,
        });
      }
      if (input.email === user.email) {
        throw new AppError("BAD_REQUEST", { message: accountMessages.sameEmail });
      }
      const taken = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (taken !== null) {
        throw new AppError("CONFLICT", { message: accountMessages.emailTaken });
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: auth.userId }, data: { pendingEmail: input.email } });
        await auditGlobal(tx, {
          actorId: auth.userId,
          action: "auth.email.change_request",
          ...info,
        });
        await jobs.enqueue("email-send", { kind: "email-change", userId: auth.userId }, { tx });
      });
    },

    async resendVerification(auth: AuthContext): Promise<void> {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { emailVerifiedAt: true },
      });
      if (user === null || user.emailVerifiedAt !== null) return;
      await jobs.enqueue(
        "email-send",
        { kind: "verify-email", userId: auth.userId },
        { singletonKey: `verify-email:${auth.userId}` },
      );
    },

    /** Siempre termina bien: no revela si el email existe. */
    async forgotPassword(email: string, info: RequestInfo): Promise<void> {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (user === null) return;
      await prisma.$transaction(async (tx) => {
        await auditGlobal(tx, { actorId: user.id, action: "auth.password.reset_request", ...info });
        await jobs.enqueue("email-send", { kind: "reset-password", userId: user.id }, { tx });
      });
    },

    async resetPassword(token: string, password: string, info: RequestInfo): Promise<void> {
      const passwordHash = await passwords.hash(password);
      await prisma.$transaction(async (tx) => {
        const userId = await consumeAuthToken(tx, token, "RESET_PASSWORD");
        if (userId === null) throw invalidToken();
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash, failedLogins: 0, lockedUntil: null },
        });
        // Otros enlaces de restablecimiento pendientes dejan de servir.
        await tx.authToken.updateMany({
          where: { userId, type: "RESET_PASSWORD", usedAt: null },
          data: { usedAt: new Date() },
        });
        await revokeUserSessions(tx, userId);
        await auditGlobal(tx, { actorId: userId, action: "auth.password.reset", ...info });
        await jobs.enqueue("email-send", { kind: "password-changed", userId }, { tx });
      });
    },

    async changePassword(
      auth: AuthContext,
      input: z.infer<typeof ChangePasswordSchema>,
      info: RequestInfo,
    ): Promise<void> {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { passwordHash: true },
      });
      if (
        user?.passwordHash == null ||
        !(await passwords.verify(user.passwordHash, input.currentPassword))
      ) {
        throw new AppError("INVALID_CREDENTIALS", {
          message: accountMessages.currentPasswordWrong,
        });
      }
      const passwordHash = await passwords.hash(input.newPassword);
      const current = await prisma.session.findUnique({
        where: { id: auth.sessionId },
        select: { familyId: true },
      });
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: auth.userId }, data: { passwordHash } });
        await revokeUserSessions(tx, auth.userId, {
          ...(current === null ? {} : { exceptFamilyId: current.familyId }),
        });
        await auditGlobal(tx, { actorId: auth.userId, action: "auth.password.change", ...info });
        await jobs.enqueue("email-send", { kind: "password-changed", userId: auth.userId }, { tx });
      });
    },
  };

  return { ...entry, ...service };
}

export type AuthService = ReturnType<typeof createAuthService>;
