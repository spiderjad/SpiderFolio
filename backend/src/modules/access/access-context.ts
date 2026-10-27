// Atajos de resolveAccess para los servicios de contenido: el nivel de quien pide sobre un espacio
// o un nodo, y los chequeos que devuelven 404 (sin acceso: no existe) o 403 (ve, pero no alcanza).
import type { AccessLevel } from "../../generated/prisma/client.ts";
import { forbidden, notFound } from "../../lib/errors.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { accessActorOf, atLeast, loadAccess, type AccessResolver } from "./access.ts";

type Ctx = Pick<AdminContext, "db" | "tenant">;

/** Resolver de varios espacios y nodos a la vez (en lote). */
export async function accessFor(
  ctx: Ctx,
  target: { nodeIds?: readonly string[]; spaceIds?: readonly string[] },
): Promise<AccessResolver> {
  return await loadAccess(ctx.db, accessActorOf(ctx), target);
}

export async function levelOfSpace(ctx: Ctx, spaceId: string): Promise<AccessLevel | null> {
  return (await accessFor(ctx, { spaceIds: [spaceId] })).ofSpace(spaceId);
}

export async function levelOfNode(ctx: Ctx, nodeId: string): Promise<AccessLevel | null> {
  return (await accessFor(ctx, { nodeIds: [nodeId] })).ofNode(nodeId);
}

/** Sin acceso: 404 (no se revela que existe). Con acceso pero poco nivel: 403. */
export function requireLevel(level: AccessLevel | null, needed: AccessLevel): AccessLevel {
  if (level === null) throw notFound();
  if (!atLeast(level, needed)) throw forbidden();
  return level;
}

/** Gestionar un espacio: MANAGE sobre él o la capacidad spaces.manage. */
export function canManageSpace(
  ctx: Pick<AdminContext, "actor">,
  level: AccessLevel | null,
): boolean {
  return atLeast(level, "MANAGE") || ctx.actor.capabilities.includes("spaces.manage");
}
