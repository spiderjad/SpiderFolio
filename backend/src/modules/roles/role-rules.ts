// Reglas de roles (CLAUDE.md, secciones 9.1 y 9.2), puras y sin base de datos:
// nadie se asigna capacidades que no tiene, ni crea o edita roles por encima de su nivel.
import type { SystemRole } from "../../generated/prisma/client.ts";
import { AppError } from "../../lib/errors.ts";
import { roleMessages } from "../../i18n/index.ts";
import type { Capability } from "./capabilities.ts";

/** Nivel de cada rol base: mayor = más poder. */
export const baseRank: Record<SystemRole, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/** Bases que puede extender un rol personalizado: OWNER es solo del rol de sistema. */
export const customRoleBases = [
  "ADMIN",
  "MEMBER",
  "GUEST",
] as const satisfies readonly SystemRole[];

export interface Actor {
  base: SystemRole;
  capabilities: readonly Capability[];
}

export interface RoleShape {
  base: SystemRole;
  capabilities: readonly Capability[];
}

/** Capacidades de `wanted` que `actor` no tiene. */
export function missingCapabilities(
  actor: Actor,
  wanted: readonly Capability[],
): readonly Capability[] {
  return wanted.filter((capability) => !actor.capabilities.includes(capability));
}

/**
 * Valida un rol que `actor` crea o deja como resultado de una edición. Lanza AppError si:
 * - el rol base es OWNER, o está por encima del de quien lo hace (un OWNER puede cualquiera
 *   menos OWNER);
 * - un rol de invitado (GUEST) lleva capacidades administrativas;
 * - incluye capacidades que quien lo hace no tiene.
 */
export function assertRoleAllowed(actor: Actor, role: RoleShape): void {
  if (role.base === "OWNER" || baseRank[role.base] > baseRank[actor.base]) {
    throw new AppError("FORBIDDEN", { message: roleMessages.baseNotAllowed });
  }
  if (role.base === "GUEST" && role.capabilities.length > 0) {
    throw new AppError("BAD_REQUEST", { message: roleMessages.guestWithCapabilities });
  }
  const missing = missingCapabilities(actor, role.capabilities);
  if (missing.length > 0) {
    throw new AppError("FORBIDDEN", {
      message: roleMessages.capabilitiesNotHeld(missing),
    });
  }
}

/**
 * Quien edita o borra un rol personalizado tiene que ser, al menos, tan poderoso como el rol:
 * no se modifica un rol que da capacidades que uno no tiene.
 */
export function assertCanManageRole(actor: Actor, role: RoleShape & { isSystem: boolean }): void {
  if (role.isSystem) throw new AppError("FORBIDDEN", { message: roleMessages.systemRole });
  if (
    baseRank[role.base] > baseRank[actor.base] ||
    missingCapabilities(actor, role.capabilities).length > 0
  ) {
    throw new AppError("FORBIDDEN", { message: roleMessages.roleAboveYou });
  }
}

/** Un rol con capacidades administrativas no puede asignarse a una plaza de lector (9A.4). */
export function isAdministrative(role: Pick<RoleShape, "capabilities">): boolean {
  return role.capabilities.length > 0;
}
