// tenantMiddleware (CLAUDE.md, sección 7.4): resuelve el workspace del slug de la URL y la
// membresía activa del usuario. Si no existe o no es miembro: 404 (nunca 403, para no
// revelar que el workspace existe). Nunca se acepta workspaceId desde body o query.
import type { Request, RequestHandler } from "express";
import { forTenant, type TenantDb } from "../db/tenant.ts";
import type { SeatType, SystemRole } from "../generated/prisma/client.ts";
import { notFound, unauthenticated } from "../lib/errors.ts";
import type { PrismaClient } from "../lib/prisma.ts";
import type { LeaderRank } from "../modules/access/access.ts";
import { parentMapOf } from "../modules/departments/department-tree.ts";
import { scopeOfDepartments } from "../modules/access/access-scope.ts";
import {
  isCapability,
  registeredPluginCapabilities,
  type Capability,
} from "../modules/roles/capabilities.ts";

const LAST_SEEN_INTERVAL_MS = 5 * 60_000;

export interface TenantContext {
  workspaceId: string;
  workspaceSlug: string;
  membershipId: string;
  seatType: SeatType;
  role: { id: string; name: string; base: SystemRole };
  capabilities: readonly Capability[];
  /** Departamentos de la persona y los de sus ancestros (un subdepartamento hereda del padre). */
  departmentIds: readonly string[];
  /** Solo los departamentos en los que la persona está (sin los ancestros). */
  ownDepartmentIds: readonly string[];
  /**
   * Lo que alcanza por su cargo de jefe o subjefe: cada departamento que lidera y todas sus
   * subáreas → cuál lidera y con qué cargo (el de jefe gana si lidera por los dos).
   */
  ledScope: ReadonlyMap<string, { departmentId: string; rank: LeaderRank }>;
}

/** Qué workspace: por su slug (rutas) o por su id (descargas canjeadas con un token, jobs). */
export type WorkspaceRef = { slug: string } | { id: string };

export interface LoadedTenant {
  tenant: TenantContext;
  db: TenantDb;
  lastSeenAt: Date | null;
}

/**
 * Quién es la persona dentro del workspace: su membresía activa, rol, capacidades, departamentos
 * y lo que lidera. null si el workspace no existe o la persona no es miembro activo.
 */
export async function loadTenantContext(
  prisma: PrismaClient,
  workspace: WorkspaceRef,
  userId: string,
): Promise<LoadedTenant | null> {
  const found = await prisma.workspace.findFirst({
    where: { ...workspace, deletedAt: null },
    select: {
      id: true,
      slug: true,
      memberships: {
        where: { userId, status: "ACTIVE" },
        select: {
          id: true,
          seatType: true,
          lastSeenAt: true,
          role: { select: { id: true, name: true, base: true, capabilities: true } },
          departments: { select: { departmentId: true, position: true } },
        },
      },
    },
  });
  const membership = found?.memberships[0];
  if (found === null || membership === undefined) return null;

  const own = membership.departments.map((d) => d.departmentId);
  // El árbol solo se lee si la persona está en algún departamento.
  const tree =
    own.length === 0
      ? null
      : parentMapOf(
          await prisma.department.findMany({
            where: { workspaceId: found.id },
            select: { id: true, parentId: true },
          }),
        );
  const { departmentIds, ledScope } = scopeOfDepartments(membership.departments, tree);
  return {
    tenant: {
      workspaceId: found.id,
      workspaceSlug: found.slug,
      membershipId: membership.id,
      seatType: membership.seatType,
      role: { id: membership.role.id, name: membership.role.name, base: membership.role.base },
      // El propietario tiene también todas las capacidades de los plugins instalados.
      capabilities:
        membership.role.base === "OWNER"
          ? [
              ...membership.role.capabilities.filter(isCapability),
              ...registeredPluginCapabilities(),
            ]
          : membership.role.capabilities.filter(isCapability),
      departmentIds,
      ownDepartmentIds: own,
      ledScope,
    },
    db: forTenant(prisma, found.id),
    lastSeenAt: membership.lastSeenAt,
  };
}

export function tenantMiddleware(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const auth = req.auth;
    if (auth === undefined) throw unauthenticated();
    const slug = req.params.workspaceSlug;
    if (typeof slug !== "string") throw notFound();

    const loaded = await loadTenantContext(prisma, { slug }, auth.userId);
    if (loaded === null) throw notFound();

    // Último acceso: se actualiza como mucho cada 5 minutos para no escribir en cada pedido.
    const now = new Date();
    if (
      loaded.lastSeenAt === null ||
      now.getTime() - loaded.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS
    ) {
      await prisma.membership.updateMany({
        where: {
          id: loaded.tenant.membershipId,
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_INTERVAL_MS) } },
          ],
        },
        data: { lastSeenAt: now },
      });
    }
    req.tenant = loaded.tenant;
    req.db = loaded.db;
    next();
  };
}

/** Contexto de tenant de un request que pasó por tenantMiddleware. */
export function tenantOf(req: Request): { tenant: TenantContext; db: TenantDb } {
  if (req.tenant === undefined || req.db === undefined) {
    throw new Error("Ruta de tenant sin tenantMiddleware");
  }
  return { tenant: req.tenant, db: req.db };
}

/** Quién hace el pedido, para los eventos de auditoría (actorId es el usuario, no la membresía). */
export function auditInfo(req: Request): {
  actorId: string;
  ip: string | null;
  userAgent: string | null;
} {
  if (req.auth === undefined) throw new Error("Ruta de tenant sin authMiddleware");
  return {
    actorId: req.auth.userId,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
  };
}
