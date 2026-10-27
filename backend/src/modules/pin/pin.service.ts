// Personas que entran con usuario + PIN (CLAUDE.md, sección 7.6): crear y resetear el PIN.
// El login vive en auth.service. Estas funciones son de servicio (sin permisos): la ruta del
// panel verifica members.pin antes de llamarlas.
import { pinMessages } from "../../i18n/index.ts";
import { forTenant } from "../../db/tenant.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { violatedUniqueIndex } from "../../lib/prisma-errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { audit } from "../audit/audit.service.ts";
import type { Passwords } from "../auth/passwords.ts";
import type { AppDeps } from "../../routes.ts";
import { revokeUserSessions } from "../auth/sessions.service.ts";
import {
  generatePin,
  isPinFormat,
  isValidLoginName,
  isWeakPin,
  normalizeLoginName,
} from "./pin-rules.ts";

export interface PinDeps {
  prisma: PrismaClient;
  passwords: Passwords;
}

/** Dependencias de este módulo, tomadas de las de la app. */
export function pinDepsOf(deps: AppDeps): PinDeps {
  return { prisma: deps.prisma, passwords: deps.passwords };
}

export interface CreatePinMemberInput {
  workspaceId: string;
  /** Quién lo crea (User.id), para la auditoría. */
  actorUserId: string;
  name: string;
  loginName: string;
  roleId: string;
  departmentIds?: string[];
  /** Sin PIN, se genera uno. */
  pin?: string;
}

export interface CreatedPinMember {
  membershipId: string;
  userId: string;
  loginName: string;
  /** El PIN en claro solo existe acá: se muestra una vez y no se guarda. */
  pin: string;
}

function chosenPin(pin: string | undefined): string {
  if (pin === undefined) return generatePin();
  if (!isPinFormat(pin) || isWeakPin(pin)) {
    throw new AppError("BAD_REQUEST", { message: pinMessages.weakPin });
  }
  return pin;
}

/** Crea el usuario sin email, su membresía (plaza de lector) y su credencial de PIN. */
export async function createPinMember(
  deps: PinDeps,
  input: CreatePinMemberInput,
): Promise<CreatedPinMember> {
  const loginName = normalizeLoginName(input.loginName);
  if (!isValidLoginName(loginName)) {
    throw new AppError("BAD_REQUEST", { message: pinMessages.loginNameInvalid });
  }
  const pin = chosenPin(input.pin);
  const pinHash = await deps.passwords.hash(pin);

  try {
    return await deps.prisma.$transaction(async (tx) => {
      const db = forTenant(tx, input.workspaceId);
      const role = await db.role.findFirst({ where: { id: input.roleId } });
      if (role === null) throw notFound();
      // Sin capacidades: un lector de planta no administra nada.
      if (role.base !== "MEMBER" || role.capabilities.length > 0) {
        throw new AppError("BAD_REQUEST", { message: pinMessages.roleNotAllowed });
      }

      const user = await tx.user.create({
        data: { name: input.name, kind: "PIN" },
        select: { id: true },
      });
      const membership = await db.membership.create({
        data: { userId: user.id, roleId: role.id, seatType: "READER" },
        select: { id: true },
      });
      await db.pinLogin.create({
        data: {
          membershipId: membership.id,
          loginName,
          pinHash,
          pinChangedById: input.actorUserId,
        },
      });
      const departmentIds = input.departmentIds ?? [];
      if (departmentIds.length > 0) {
        const departments = await db.department.findMany({
          where: { id: { in: departmentIds } },
          select: { id: true },
        });
        await db.departmentMember.createMany({
          data: departments.map((d) => ({ departmentId: d.id, membershipId: membership.id })),
          skipDuplicates: true,
        });
      }
      await audit(db, {
        actorId: input.actorUserId,
        action: "pin.create",
        entityType: "Membership",
        entityId: membership.id,
        metadata: { loginName },
      });
      return { membershipId: membership.id, userId: user.id, loginName, pin };
    });
  } catch (error) {
    if (violatedUniqueIndex(error) === "PinLogin_workspaceId_loginName_key") {
      throw new AppError("CONFLICT", { message: pinMessages.loginNameTaken });
    }
    throw error;
  }
}

/**
 * Nuevo PIN de una persona (reset por un administrador): desbloquea la cuenta y cierra todas
 * sus sesiones. Devuelve el PIN en claro, que se muestra una vez.
 */
export async function resetPin(
  deps: PinDeps,
  input: { workspaceId: string; actorUserId: string; membershipId: string; pin?: string },
): Promise<{ loginName: string; pin: string }> {
  const pin = chosenPin(input.pin);
  const pinHash = await deps.passwords.hash(pin);
  return await deps.prisma.$transaction(async (tx) => {
    const db = forTenant(tx, input.workspaceId);
    const credential = await db.pinLogin.findFirst({
      where: { membershipId: input.membershipId },
      select: { id: true, loginName: true, membership: { select: { userId: true } } },
    });
    if (credential === null) {
      throw new AppError("BAD_REQUEST", { message: pinMessages.notPinMember });
    }
    await db.pinLogin.update({
      where: { id: credential.id },
      data: {
        pinHash,
        failedAttempts: 0,
        lockCount: 0,
        lockedUntil: null,
        pinChangedAt: new Date(),
        pinChangedById: input.actorUserId,
      },
    });
    await revokeUserSessions(tx, credential.membership.userId);
    await audit(db, {
      actorId: input.actorUserId,
      action: "pin.reset",
      entityType: "Membership",
      entityId: input.membershipId,
      metadata: { loginName: credential.loginName },
    });
    return { loginName: credential.loginName, pin };
  });
}
