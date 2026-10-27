// Avisos de la campana: «X compartió Y contigo» y «Tu acceso a Y vence mañana». Cada persona lee solo
// las suyas (la consulta siempre filtra por su membresía). El nombre de lo compartido se muestra
// únicamente si la persona todavía lo ve: si perdió el acceso, el aviso queda sin nombre.
import type { NodeType } from "../../generated/prisma/client.ts";
import type { Jobs } from "../../jobs/boss.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { parentMapOf, withDescendants } from "../departments/department-tree.ts";
import type { NotificationsQuery } from "./notifications.schemas.ts";

/** Hasta cuántas personas reciben un aviso por un acceso dado a un departamento. */
const MAX_RECIPIENTS = 2000;

export const NOTIFICATION_KINDS = [
  "shared",
  "expiring",
  "expiring_granted",
  "approval_pending",
  "approval_approved",
  "approval_rejected",
  "approval_changes",
  "reading_required",
  "reading_reminder",
  "reading_overdue_leader",
  /** El SMTP propio de la empresa falló y los correos salieron por SpiderFolio (para administradores). */
  "email_fallback",
  /** El uso de consultas de Bian llegó al 80 % o 95 % del total (para administradores; `version` = umbral). */
  "bian_usage",
  /** Alguien pide más consultas de Bian (para administradores; `actor` = quien pide). */
  "bian_request",
  /** Un jefe o subjefe invitó a alguien a su área (para quienes administran miembros; `actor` = quien invitó). */
  "invitation_by_leader",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const kindOf = (value: string): NotificationKind =>
  NOTIFICATION_KINDS.find((kind) => kind === value) ?? "shared";

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  /** Versión del documento controlado a la que se refiere, si aplica. */
  version: number | null;
  /** Acceso del que se avisa (para abrirlo en «Compartido por mí»). */
  permissionId: string | null;
  /** A quién se le dio el acceso (avisos de quien compartió); null si ya no existe. */
  subject: { type: "person" | "department"; name: string } | null;
  createdAt: Date;
  readAt: Date | null;
  actor: { id: string; name: string } | null;
  /** Lo compartido, si la persona todavía lo ve; null si no. */
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
    parentId: string | null;
  } | null;
  expiresAt: Date | null;
  /** «invitation_by_leader»: a quién se invitó y a qué departamentos; null si ya no existe. */
  invitation: { email: string; departments: string[] } | null;
}

export async function listNotifications(
  ctx: AdminContext,
  query: NotificationsQuery,
): Promise<Page<NotificationView> & { unread: number }> {
  const where = { membershipId: ctx.tenant.membershipId };
  const [rows, total, unread] = await Promise.all([
    ctx.db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.notification.count({ where }),
    ctx.db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  const nodeIds = rows.flatMap((row) => (row.nodeId === null ? [] : [row.nodeId]));
  const spaceIds = rows.flatMap((row) => (row.spaceId === null ? [] : [row.spaceId]));
  const permissionIds = rows.flatMap((row) =>
    row.kind === "expiring_granted" && row.permissionId !== null ? [row.permissionId] : [],
  );
  const invitationIds = rows.flatMap((row) =>
    row.kind === "invitation_by_leader" && row.invitationId !== null ? [row.invitationId] : [],
  );
  const [access, nodes, spaces, actors, grants, invitations] = await Promise.all([
    accessFor(ctx, { nodeIds, spaceIds }),
    nodeIds.length === 0
      ? []
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: { id: true, name: true, type: true, spaceId: true, parentId: true },
        }),
    spaceIds.length === 0
      ? []
      : ctx.db.space.findMany({
          where: { id: { in: spaceIds } },
          select: { id: true, name: true },
        }),
    ctx.db.membership.findMany({
      where: {
        id: {
          in: [...new Set(rows.flatMap((row) => (row.actorId === null ? [] : [row.actorId])))],
        },
      },
      select: { id: true, user: { select: { name: true } } },
    }),
    permissionIds.length === 0
      ? []
      : ctx.db.permission.findMany({
          where: { id: { in: permissionIds } },
          select: {
            id: true,
            membership: { select: { user: { select: { name: true } } } },
            department: { select: { name: true } },
          },
        }),
    invitationIds.length === 0
      ? []
      : ctx.db.invitation.findMany({
          where: { id: { in: invitationIds } },
          select: { id: true, email: true, departmentIds: true },
        }),
  ]);
  const departmentIds = [...new Set(invitations.flatMap((row) => row.departmentIds))];
  const departments =
    departmentIds.length === 0
      ? []
      : await ctx.db.department.findMany({
          where: { id: { in: departmentIds } },
          select: { id: true, name: true },
        });
  const departmentName = new Map(departments.map((row) => [row.id, row.name]));
  const invitationById = new Map(
    invitations.map((row) => [
      row.id,
      {
        email: row.email,
        departments: row.departmentIds.flatMap((id) => {
          const name = departmentName.get(id);
          return name === undefined ? [] : [name];
        }),
      },
    ]),
  );
  const subjectById = new Map<string, NonNullable<NotificationView["subject"]>>();
  for (const grant of grants) {
    if (grant.membership !== null) {
      subjectById.set(grant.id, { type: "person", name: grant.membership.user.name });
    } else if (grant.department !== null) {
      subjectById.set(grant.id, { type: "department", name: grant.department.name });
    }
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const actorById = new Map(actors.map((actor) => [actor.id, actor.user.name]));
  const items = rows.map((row): NotificationView => {
    let target: NotificationView["target"] = null;
    if (row.nodeId !== null) {
      const node = nodeById.get(row.nodeId);
      if (node !== undefined && atLeast(access.ofNode(node.id), "VIEW")) {
        target = {
          type: "node",
          id: node.id,
          name: node.name,
          nodeType: node.type,
          spaceId: node.spaceId,
          parentId: node.parentId,
        };
      }
    } else if (row.spaceId !== null) {
      const space = spaceById.get(row.spaceId);
      if (space !== undefined && atLeast(access.ofSpace(space.id), "VIEW")) {
        target = {
          type: "space",
          id: space.id,
          name: space.name,
          nodeType: null,
          spaceId: space.id,
          parentId: null,
        };
      }
    }
    const actorName = row.actorId === null ? undefined : actorById.get(row.actorId);
    return {
      id: row.id,
      kind: kindOf(row.kind),
      version: row.version,
      permissionId: row.permissionId,
      subject: row.permissionId === null ? null : (subjectById.get(row.permissionId) ?? null),
      createdAt: row.createdAt,
      readAt: row.readAt,
      actor:
        row.actorId === null || actorName === undefined
          ? null
          : { id: row.actorId, name: actorName },
      target,
      expiresAt: row.expiresAt,
      invitation:
        row.invitationId === null ? null : (invitationById.get(row.invitationId) ?? null),
    };
  });
  return { ...pageOf(items, total, query), unread };
}

export async function unreadCount(ctx: AdminContext): Promise<{ unread: number }> {
  return {
    unread: await ctx.db.notification.count({
      where: { membershipId: ctx.tenant.membershipId, readAt: null },
    }),
  };
}

/** Marca una como leída; si no es de la persona, 404 (no se sabe que existe). */
export async function markRead(ctx: AdminContext, id: string): Promise<void> {
  const result = await ctx.db.notification.updateMany({
    where: { id, membershipId: ctx.tenant.membershipId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await ctx.db.notification.count({
      where: { id, membershipId: ctx.tenant.membershipId },
    });
    if (exists === 0) throw notFound();
  }
}

export async function markAllRead(ctx: AdminContext): Promise<void> {
  await ctx.db.notification.updateMany({
    where: { membershipId: ctx.tenant.membershipId, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Las personas activas a las que llega un acceso dado a un departamento (con sus subáreas, si se pidió). */
export async function departmentRecipients(
  db: TenantDb,
  departmentId: string,
  includeSubareas: boolean,
): Promise<string[]> {
  const ids = includeSubareas
    ? withDescendants(
        [departmentId],
        parentMapOf(await db.department.findMany({ select: { id: true, parentId: true } })),
      )
    : [departmentId];
  const members = await db.departmentMember.findMany({
    where: { departmentId: { in: ids }, membership: { status: "ACTIVE" } },
    take: MAX_RECIPIENTS,
    select: { membershipId: true },
  });
  return [...new Set(members.map((member) => member.membershipId))];
}

/** Quienes administran los miembros: el propietario y quien tiene «members.manage». */
export async function memberAdminIds(db: TenantDb): Promise<string[]> {
  const admins = await db.membership.findMany({
    where: {
      status: "ACTIVE",
      role: { OR: [{ base: "OWNER" }, { capabilities: { has: "members.manage" } }] },
    },
    take: MAX_RECIPIENTS,
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

/** «X (jefe) invitó a Y a Z»: un aviso por invitación para cada administrador (no a quien invitó). */
export async function notifyLeaderInvitations(
  db: TenantDb,
  input: { actorId: string; invitationIds: readonly string[] },
): Promise<void> {
  if (input.invitationIds.length === 0) return;
  const recipients = (await memberAdminIds(db)).filter((id) => id !== input.actorId);
  if (recipients.length === 0) return;
  await db.notification.createMany({
    data: recipients.flatMap((membershipId) =>
      input.invitationIds.map((invitationId) => ({
        membershipId,
        kind: "invitation_by_leader",
        actorId: input.actorId,
        invitationId,
        dedupeKey: `invitation_by_leader:${invitationId}`,
      })),
    ),
    skipDuplicates: true,
  });
}

/** «X compartió Y contigo» para cada persona (menos quien compartió). */
export async function notifyShared(
  db: TenantDb,
  input: {
    actorId: string;
    recipients: readonly string[];
    target: { type: "space" | "node"; id: string };
    permissionId: string;
    expiresAt: Date | null;
  },
): Promise<void> {
  const recipients = [...new Set(input.recipients)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return;
  await db.notification.createMany({
    data: recipients.map((membershipId) => ({
      membershipId,
      kind: "shared",
      actorId: input.actorId,
      permissionId: input.permissionId,
      expiresAt: input.expiresAt,
      ...(input.target.type === "node"
        ? { nodeId: input.target.id }
        : { spaceId: input.target.id }),
    })),
  });
}

/** Avisos de un documento controlado (campana + email): uno por persona, sin repetir a quien actúa. */
export async function createDocumentNotices(
  db: TenantDb,
  jobs: Pick<Jobs, "enqueue">,
  input: {
    kind: Exclude<
      NotificationKind,
      | "shared"
      | "expiring"
      | "expiring_granted"
      | "email_fallback"
      | "bian_usage"
      | "bian_request"
      | "invitation_by_leader"
    >;
    /** Quién lo origina (null: el sistema, en los recordatorios). */
    actorId: string | null;
    recipients: readonly string[];
    nodeId: string;
    version: number;
    /** Plazo de la lectura (se guarda como vencimiento del aviso). */
    dueAt?: Date | null;
    /** Evita repetir el mismo aviso (recordatorios): único por persona. */
    dedupeKey?: string;
  },
): Promise<void> {
  const recipients = [...new Set(input.recipients)].filter((id) => id !== input.actorId);
  for (const membershipId of recipients) {
    const created = await db.notification.create({
      data: {
        membershipId,
        kind: input.kind,
        ...(input.actorId === null ? {} : { actorId: input.actorId }),
        nodeId: input.nodeId,
        version: input.version,
        ...(input.dueAt === undefined || input.dueAt === null ? {} : { expiresAt: input.dueAt }),
        ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      },
      select: { id: true },
    });
    await jobs.enqueue("email-send", { kind: "document-notice", notificationId: created.id });
  }
}
