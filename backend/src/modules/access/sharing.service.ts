// Compartir (docs/spec/acceso-a-contenido.md, 8.1): dar, cambiar y quitar accesos directos de un
// espacio, carpeta, archivo o página, y cortar o restaurar la herencia de un nodo. Un solo camino
// para todo: pide gestionar el elemento; los lectores e invitados llegan como mucho a Comentar; y
// nadie pierde sin querer el acceso que le permite gestionar lo que está compartiendo.
import type { Jobs } from "../../jobs/boss.ts";
import type { AccessLevel } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { contentMessages } from "../../i18n/index.ts";
import type { AppDeps } from "../../routes.ts";
import { departmentRecipients, notifyShared } from "../notifications/notifications.service.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { accessActorOf, atLeast, isLimitedActor, levelRank, loadAccess } from "./access.ts";
import { canManageSpace, levelOfNode, levelOfSpace, requireLevel } from "./access-context.ts";
import type { InheritanceInput, SetPermissionInput } from "./sharing.schemas.ts";

export interface SharingDeps {
  jobs: Pick<Jobs, "enqueue">;
}

export function sharingDepsOf(deps: AppDeps): SharingDeps {
  return { jobs: deps.jobs };
}

export type ShareTarget = { type: "space"; id: string } | { type: "node"; id: string };

interface Resolved {
  spaceId: string;
  nodeId: string | null;
  /** Para el AuditLog. */
  entity: { entityType: "Space" | "Node"; entityId: string };
}

/** El elemento existe y quien pide puede gestionarlo; el espacio no está archivado. */
async function resolveTarget(ctx: AdminContext, target: ShareTarget): Promise<Resolved> {
  if (target.type === "node") {
    const node = await ctx.db.node.findFirst({
      where: { id: target.id, trashedAt: null },
      select: { id: true, spaceId: true },
    });
    if (node === null) throw notFound();
    requireLevel(await levelOfNode(ctx, node.id), "MANAGE");
    await assertWritable(ctx, node.spaceId);
    return {
      spaceId: node.spaceId,
      nodeId: node.id,
      entity: { entityType: "Node", entityId: node.id },
    };
  }
  const space = await ctx.db.space.findFirst({ where: { id: target.id }, select: { id: true } });
  if (space === null) throw notFound();
  const level = await levelOfSpace(ctx, space.id);
  if (level === null && !ctx.actor.capabilities.includes("spaces.manage")) throw notFound();
  if (!canManageSpace(ctx, level)) throw forbidden();
  await assertWritable(ctx, space.id);
  return { spaceId: space.id, nodeId: null, entity: { entityType: "Space", entityId: space.id } };
}

async function assertWritable(ctx: AdminContext, spaceId: string): Promise<void> {
  const space = await ctx.db.space.findFirst({
    where: { id: spaceId },
    select: { archivedAt: true },
  });
  if (space === null) throw notFound();
  if (space.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: contentMessages.spaceArchived });
  }
}

/** Quien comparte conserva el poder de gestionar (salvo que ya no lo necesite: acceso total). */
async function canStillManage(
  ctx: AdminContext,
  db: AdminContext["db"],
  target: Resolved,
): Promise<boolean> {
  const access = await loadAccess(db, accessActorOf(ctx), {
    spaceIds: [target.spaceId],
    nodeIds: target.nodeId === null ? [] : [target.nodeId],
  });
  const level =
    target.nodeId === null ? access.ofSpace(target.spaceId) : access.ofNode(target.nodeId);
  return atLeast(level, "MANAGE") || (target.nodeId === null && canManageSpace(ctx, level));
}

export interface PermissionView {
  id: string;
  subject: { type: "person" | "department" | "company"; id: string; name: string };
  level: AccessLevel;
  expiresAt: Date | null;
  includeSubareas: boolean;
}

const viewSelect = {
  id: true,
  level: true,
  expiresAt: true,
  includeSubareas: true,
  everyone: true,
  membership: { select: { id: true, user: { select: { name: true } } } },
  department: { select: { id: true, name: true } },
} as const;

/** Da o cambia el acceso directo de una persona o un departamento (uno solo por sujeto). */
export async function setPermission(
  ctx: AdminContext,
  deps: SharingDeps,
  target: ShareTarget,
  input: SetPermissionInput,
): Promise<PermissionView> {
  const resolved = await resolveTarget(ctx, target);
  const everyone = input.everyone === true;
  if (
    [input.departmentId !== undefined, input.membershipId !== undefined, everyone].filter(Boolean)
      .length !== 1
  ) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.subjectRequired });
  }
  // Toda la empresa incluye lectores, que no pasan de Comentar: se da Ver, Comentar o Editar.
  if (everyone && input.level === "MANAGE") {
    throw new AppError("BAD_REQUEST", { message: contentMessages.companyLevel });
  }
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && expiresAt <= new Date()) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.expiryInPast });
  }
  if (input.membershipId !== undefined) {
    const person = await ctx.db.membership.findFirst({
      where: { id: input.membershipId, status: "ACTIVE" },
      select: { seatType: true, role: { select: { base: true } } },
    });
    if (person === null) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.memberNotActive });
    }
    if (
      (input.level === "EDIT" || input.level === "MANAGE") &&
      isLimitedActor({ base: person.role.base, seatType: person.seatType })
    ) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.limitedLevel });
    }
  } else if (input.departmentId !== undefined) {
    if ((await ctx.db.department.count({ where: { id: input.departmentId } })) === 0) {
      throw notFound();
    }
  }
  const subject = everyone
    ? { everyone: true }
    : input.departmentId === undefined
      ? { membershipId: input.membershipId ?? "" }
      : { departmentId: input.departmentId };
  const where =
    resolved.nodeId === null ? { spaceId: resolved.spaceId } : { nodeId: resolved.nodeId };

  const { row, notify, raised } = await ctx.db.$transaction(async (tx) => {
    const existing = await tx.permission.findFirst({
      where: { ...where, ...subject },
      select: { id: true, level: true },
    });
    const saved =
      existing === null
        ? await tx.permission.create({
            data: {
              ...where,
              ...subject,
              level: input.level,
              expiresAt,
              includeSubareas: input.departmentId !== undefined && input.includeSubareas === true,
              grantedById: ctx.tenant.membershipId,
            },
            select: viewSelect,
          })
        : await tx.permission.update({
            where: { id: existing.id },
            data: {
              level: input.level,
              expiresAt,
              grantedById: ctx.tenant.membershipId,
              ...(input.departmentId !== undefined && input.includeSubareas !== undefined
                ? { includeSubareas: input.includeSubareas }
                : {}),
            },
            select: viewSelect,
          });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "permission.set",
        ...resolved.entity,
        metadata: {
          ...subject,
          level: input.level,
          ...(input.departmentId === undefined ? {} : { includeSubareas: saved.includeSubareas }),
          ...(existing === null ? {} : { before: existing.level }),
          ...(expiresAt === null ? {} : { expiresAt: expiresAt.toISOString() }),
        },
      },
    );
    // Cambiarse a sí mismo (o a su departamento) no puede dejarle sin poder gestionar.
    const touchesMe =
      everyone ||
      input.membershipId === ctx.tenant.membershipId ||
      (input.departmentId !== undefined && ctx.tenant.departmentIds.includes(input.departmentId));
    if (touchesMe && !(await canStillManage(ctx, tx, resolved))) {
      throw new AppError("CONFLICT", { message: contentMessages.lockout });
    }
    // Aviso: solo a una persona, al darle el acceso o subirle el nivel (no a un departamento).
    const raised = existing === null || levelRank[input.level] > levelRank[existing.level];
    return {
      row: saved,
      raised,
      notify:
        input.membershipId !== undefined &&
        input.membershipId !== ctx.tenant.membershipId &&
        raised,
    };
  });
  if (notify) await deps.jobs.enqueue("email-send", { kind: "shared", permissionId: row.id });
  // La campana: a la persona, o a los miembros del departamento (con sus subáreas, si se incluyeron).
  if (raised && !everyone) {
    const recipients =
      input.membershipId !== undefined
        ? [input.membershipId]
        : await departmentRecipients(ctx.db, input.departmentId ?? "", row.includeSubareas);
    await notifyShared(ctx.db, {
      actorId: ctx.tenant.membershipId,
      recipients,
      target:
        resolved.nodeId === null
          ? { type: "space", id: resolved.spaceId }
          : { type: "node", id: resolved.nodeId },
      permissionId: row.id,
      expiresAt: row.expiresAt,
    });
  }
  // Menciones que esperaban a que la persona viera la página: ahora sí se avisan.
  if (resolved.nodeId !== null && input.membershipId !== undefined) {
    const pending = await ctx.db.mention.findMany({
      where: { nodeId: resolved.nodeId, mentionedId: input.membershipId, notifiedAt: null },
      select: { id: true },
    });
    for (const mention of pending) {
      await ctx.db.mention.update({ where: { id: mention.id }, data: { notifiedAt: new Date() } });
      await deps.jobs.enqueue("email-send", { kind: "mention", mentionId: mention.id });
    }
  }
  return toView(row);
}

type Row = {
  id: string;
  level: AccessLevel;
  expiresAt: Date | null;
  includeSubareas: boolean;
  membership: { id: string; user: { name: string } } | null;
  department: { id: string; name: string } | null;
  everyone: boolean;
};

function toView(row: Row): PermissionView {
  return {
    id: row.id,
    subject: row.everyone
      ? { type: "company", id: "", name: contentMessages.companyName }
      : row.membership !== null
        ? { type: "person", id: row.membership.id, name: row.membership.user.name }
        : { type: "department", id: row.department?.id ?? "", name: row.department?.name ?? "" },
    level: row.level,
    expiresAt: row.expiresAt,
    includeSubareas: row.includeSubareas,
  };
}

/** Quita un acceso directo. */
export async function removePermission(ctx: AdminContext, permissionId: string): Promise<void> {
  const existing = await ctx.db.permission.findFirst({
    where: { id: permissionId },
    select: {
      id: true,
      spaceId: true,
      nodeId: true,
      membershipId: true,
      departmentId: true,
      everyone: true,
      level: true,
    },
  });
  if (existing === null) throw notFound();
  const target: ShareTarget | null =
    existing.nodeId !== null
      ? { type: "node", id: existing.nodeId }
      : existing.spaceId !== null
        ? { type: "space", id: existing.spaceId }
        : null;
  if (target === null) throw notFound();
  const resolved = await resolveTarget(ctx, target);
  await ctx.db.$transaction(async (tx) => {
    await tx.permission.delete({ where: { id: existing.id } });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "permission.remove",
        ...resolved.entity,
        metadata: {
          ...(existing.membershipId === null ? {} : { membershipId: existing.membershipId }),
          ...(existing.departmentId === null ? {} : { departmentId: existing.departmentId }),
          ...(existing.everyone ? { everyone: true } : {}),
          level: existing.level,
        },
      },
    );
    if (!(await canStillManage(ctx, tx, resolved))) {
      throw new AppError("CONFLICT", { message: contentMessages.lockout });
    }
  });
}

export interface InheritanceResult {
  inheritAccess: boolean;
  /** Al cortar, quien cortó se quedaba sin poder gestionar: se le dio un acceso directo Gestionar. */
  keptAccess: boolean;
}

/**
 * Corta (false) o restaura (true) la herencia de un nodo. Al cortar, si quien corta perdería el
 * poder de gestionarlo, conserva un acceso directo «Gestionar» (propietario y administradores no
 * lo necesitan).
 */
export async function setInheritance(
  ctx: AdminContext,
  nodeId: string,
  input: InheritanceInput,
): Promise<InheritanceResult> {
  const resolved = await resolveTarget(ctx, { type: "node", id: nodeId });
  return await ctx.db.$transaction(async (tx) => {
    const node = await tx.node.findFirst({
      where: { id: nodeId },
      select: { inheritAccess: true },
    });
    if (node === null) throw notFound();
    if (node.inheritAccess === input.inheritAccess) {
      return { inheritAccess: node.inheritAccess, keptAccess: false };
    }
    await tx.node.update({ where: { id: nodeId }, data: { inheritAccess: input.inheritAccess } });
    let keptAccess = false;
    if (!input.inheritAccess && !(await canStillManage(ctx, tx, resolved))) {
      const mine = await tx.permission.findFirst({
        where: { nodeId, membershipId: ctx.tenant.membershipId },
        select: { id: true },
      });
      if (mine === null) {
        await tx.permission.create({
          data: {
            nodeId,
            membershipId: ctx.tenant.membershipId,
            level: "MANAGE",
            grantedById: ctx.tenant.membershipId,
          },
        });
      } else {
        await tx.permission.update({
          where: { id: mine.id },
          data: { level: "MANAGE", expiresAt: null },
        });
      }
      keptAccess = true;
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "node.inheritance.set",
        ...resolved.entity,
        metadata: { inheritAccess: input.inheritAccess, keptAccess },
      },
    );
    return { inheritAccess: input.inheritAccess, keptAccess };
  });
}
