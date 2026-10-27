// Reglas de miembros (CLAUDE.md, secciones 9.1, 9.3 y 9A.4), puras y sin base de datos.
import type { SeatType, SystemRole } from "../../generated/prisma/client.ts";
import { AppError } from "../../lib/errors.ts";
import { memberMessages } from "../../i18n/index.ts";
import {
  baseRank,
  isAdministrative,
  missingCapabilities,
  type Actor,
} from "../roles/role-rules.ts";
import type { Capability } from "../roles/capabilities.ts";

/**
 * Nadie actúa sobre un rol igual o superior al suyo, salvo el propietario (que puede con todos;
 * el último propietario lo protege otra regla). Un administrador no toca a otros
 * administradores ni a propietarios.
 */
export function assertCanManageTarget(actor: Actor, targetBase: SystemRole): void {
  if (actor.base === "OWNER") return;
  if (baseRank[targetBase] >= baseRank[actor.base]) {
    throw new AppError("FORBIDDEN", { message: memberMessages.targetAboveYou });
  }
}

/**
 * Valida que `actor` pueda asignar `role` a alguien: no el rol de propietario (la propiedad se
 * transfiere), no uno por encima del propio nivel ni con capacidades que no tiene.
 */
export function assertCanAssignRole(
  actor: Actor,
  role: { base: SystemRole; capabilities: readonly Capability[] },
): void {
  if (role.base === "OWNER") {
    throw new AppError("FORBIDDEN", { message: memberMessages.ownerRoleNotAssignable });
  }
  if (
    baseRank[role.base] > baseRank[actor.base] ||
    missingCapabilities(actor, role.capabilities).length > 0
  ) {
    throw new AppError("FORBIDDEN", { message: memberMessages.targetAboveYou });
  }
}

/**
 * Plaza resultante de una persona con ese rol: un invitado externo es siempre lector y un rol
 * administrativo exige plaza completa (un lector nunca administra, 9A.4). Sin restricción,
 * se respeta lo pedido o, si no, la plaza actual.
 */
export function resolveSeat(options: {
  current: SeatType;
  requested?: SeatType | undefined;
  role: { base: SystemRole; capabilities: readonly Capability[] };
}): SeatType {
  const { current, requested, role } = options;
  if (role.base === "GUEST") {
    if (requested === "FULL") {
      throw new AppError("BAD_REQUEST", { message: memberMessages.guestSeatMustBeReader });
    }
    return "READER";
  }
  if (isAdministrative(role)) {
    if (requested === "READER") {
      throw new AppError("BAD_REQUEST", { message: memberMessages.administrativeSeatMustBeFull });
    }
    return "FULL";
  }
  return requested ?? current;
}
