// Invitaciones (CLAUDE.md, secciones 7.3, 9.3 y 9A.4): una persona se suma al workspace con un
// rol, un tipo de plaza y departamentos. La invitación pendiente ocupa plaza. El token lo crea
// el worker al enviar el email (solo se guarda su SHA-256); acá se guarda un hash provisional.
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { SeatType } from "../../generated/prisma/client.ts";
import { invitationMessages } from "../../i18n/index.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import type { AppDeps } from "../../routes.ts";
import type { PluginRuntime } from "../../plugins/runtime.ts";
import { resolveMemberScope } from "../departments/departments.scope.ts";
import { seatSummary } from "../members/seats.service.ts";
import { notifyLeaderInvitations } from "../notifications/notifications.service.ts";
import { assertGlobalManager, peopleScopeOf } from "../people/people-scope.ts";
import { isCapability } from "../roles/capabilities.ts";
import { baseRank, isAdministrative, missingCapabilities } from "../roles/role-rules.ts";
import type { CreateInvitationsInput, ListInvitationsQuery } from "./invitations.schemas.ts";

export interface InvitationDeps {
  prisma: PrismaClient;
  jobs: Jobs;
  plugins: PluginRuntime;
}

/** Dependencias de este módulo, tomadas de las de la app. */
export function invitationDepsOf(deps: AppDeps): InvitationDeps {
  return { prisma: deps.prisma, jobs: deps.jobs, plugins: deps.plugins };
}

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface InvitationView {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  seatType: SeatType;
  departmentIds: string[];
  invitedBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  status: "pending" | "expired";
}

export type SkipReason = "member" | "pending";

type InvitationRow = {
  id: string;
  email: string;
  roleId: string;
  seatType: SeatType;
  departmentIds: string[];
  invitedById: string;
  createdAt: Date;
  expiresAt: Date;
  role: { name: string };
};

const invitationSelect = {
  id: true,
  email: true,
  roleId: true,
  seatType: true,
  departmentIds: true,
  invitedById: true,
  createdAt: true,
  expiresAt: true,
  role: { select: { name: true } },
} as const;

const pendingWhere = { acceptedAt: null, revokedAt: null } as const;

function toView(
  row: InvitationRow,
  names: ReadonlyMap<string, string>,
  now: Date = new Date(),
): InvitationView {
  return {
    id: row.id,
    email: row.email,
    roleId: row.roleId,
    roleName: row.role.name,
    seatType: row.seatType,
    departmentIds: row.departmentIds,
    invitedBy: names.get(row.invitedById) ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.expiresAt > now ? "pending" : "expired",
  };
}

async function inviterNames(deps: InvitationDeps, ids: readonly string[]) {
  const users = await deps.prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Plaza por defecto: lector para un invitado externo, completa para el resto. */
export function defaultSeat(base: "OWNER" | "ADMIN" | "MEMBER" | "GUEST"): SeatType {
  return base === "GUEST" ? "READER" : "FULL";
}

export async function listInvitations(
  ctx: AdminContext,
  deps: InvitationDeps,
  query: ListInvitationsQuery,
): Promise<Page<InvitationView>> {
  const now = new Date();
  // Jefe y subjefe ven solo las invitaciones a su área y subáreas.
  const scope = await resolveMemberScope(ctx);
  const where = {
    ...pendingWhere,
    ...(scope.kind === "global" ? {} : { departmentIds: { hasSome: scope.departmentIds } }),
    ...(query.status === undefined
      ? {}
      : { expiresAt: query.status === "pending" ? { gt: now } : { lte: now } }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { email: { contains: query.q, mode: "insensitive" as const } }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.invitation.findMany({
      where,
      select: invitationSelect,
      orderBy: stableOrder({ [query.sort]: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.invitation.count({ where }),
  ]);
  const names = await inviterNames(
    deps,
    rows.map((r) => r.invitedById),
  );
  return pageOf(
    rows.map((row) => toView(row, names, now)),
    total,
    query,
  );
}

export async function createInvitations(
  ctx: AdminContext,
  deps: InvitationDeps,
  input: CreateInvitationsInput,
): Promise<{ invitations: InvitationView[]; skipped: { email: string; reason: SkipReason }[] }> {
  // Sin email verificado no se puede invitar (7.3).
  const actor = await deps.prisma.user.findUnique({
    where: { id: ctx.info.actorId },
    select: { emailVerifiedAt: true, name: true },
  });
  if (actor === null || actor.emailVerifiedAt === null) {
    throw new AppError("FORBIDDEN", { message: invitationMessages.verifyEmailFirst });
  }

  // Jefe y subjefe: solo como Miembro o Lector, solo a su área y subáreas, y si el workspace lo
  // permite. Propietario y administradores, sin restricción. Los demás, 403.
  const people = await peopleScopeOf(ctx);
  if (people.manage.kind === "none") throw forbidden();
  const leaderScope = people.manage.kind === "own" ? people.manage : null;
  if (leaderScope !== null) {
    if (!people.leadersCanInvite) throw forbidden();
    const outside = input.departmentIds.filter((id) => !leaderScope.departmentIds.includes(id));
    if (input.departmentIds.length === 0 || outside.length > 0) {
      throw new AppError("BAD_REQUEST", { message: invitationMessages.leaderOwnAreaOnly });
    }
  }

  const role = await ctx.db.role.findFirst({
    where: { id: input.roleId },
    select: { id: true, name: true, base: true, capabilities: true },
  });
  if (role === null) throw notFound();
  const roleCapabilities = role.capabilities.filter(isCapability);
  if (leaderScope !== null && (role.base !== "MEMBER" || roleCapabilities.length > 0)) {
    throw forbidden();
  }
  if (role.base === "OWNER") {
    throw new AppError("BAD_REQUEST", { message: invitationMessages.ownerRole });
  }
  if (
    baseRank[role.base] > baseRank[ctx.actor.base] ||
    missingCapabilities(ctx.actor, roleCapabilities).length > 0
  ) {
    throw forbidden();
  }

  const seatType = input.seatType ?? defaultSeat(role.base);
  if (role.base === "GUEST" && seatType !== "READER") {
    throw new AppError("BAD_REQUEST", { message: invitationMessages.guestMustBeReader });
  }
  if (seatType === "READER" && isAdministrative({ capabilities: roleCapabilities })) {
    throw new AppError("BAD_REQUEST", { message: invitationMessages.readerCannotAdminister });
  }

  if (input.departmentIds.length > 0) {
    if (role.base === "GUEST") {
      throw new AppError("BAD_REQUEST", { message: invitationMessages.guestsHaveNoDepartments });
    }
    const found = await ctx.db.department.count({ where: { id: { in: input.departmentIds } } });
    if (found !== input.departmentIds.length) throw notFound();
  }

  // Reglas de los plugins activos sobre el email (ej. dominios permitidos); no aplican a invitados
  // externos (9.3).
  if (role.base !== "GUEST") {
    const problems = await Promise.all(
      input.emails.map((email) => deps.plugins.checkMemberEmail(ctx.db.workspaceId, email)),
    );
    const issues = problems.flatMap((message, index) =>
      message === null
        ? []
        : [{ path: `emails.${String(index)}`, code: "domain_not_allowed", message }],
    );
    const first = issues[0];
    if (first !== undefined) {
      throw new AppError("VALIDATION_ERROR", { message: first.message, details: { issues } });
    }
  }

  const now = new Date();
  const [users, pending] = await Promise.all([
    deps.prisma.user.findMany({
      where: { email: { in: input.emails } },
      select: { id: true, email: true },
    }),
    ctx.db.invitation.findMany({
      where: { email: { in: input.emails }, ...pendingWhere, expiresAt: { gt: now } },
      select: { email: true },
    }),
  ]);
  const memberships =
    users.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { userId: { in: users.map((u) => u.id) } },
          select: { userId: true },
        });
  const memberIds = new Set(memberships.map((m) => m.userId));
  const memberEmails = new Set(users.filter((u) => memberIds.has(u.id)).map((u) => u.email));
  const pendingEmails = new Set(pending.map((p) => p.email));

  const skipped: { email: string; reason: SkipReason }[] = [];
  const toCreate: string[] = [];
  for (const email of input.emails) {
    if (memberEmails.has(email)) skipped.push({ email, reason: "member" });
    else if (pendingEmails.has(email)) skipped.push({ email, reason: "pending" });
    else toCreate.push(email);
  }
  if (toCreate.length === 0) return { invitations: [], skipped };

  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const rows = await ctx.db.$transaction(async (tx) => {
    const created: InvitationRow[] = [];
    for (const email of toCreate) {
      const row = await tx.invitation.create({
        data: {
          email,
          roleId: role.id,
          seatType,
          departmentIds: input.departmentIds,
          // Provisorio: el worker lo reemplaza por el hash del token real al enviar.
          tokenHash: sha256(randomToken()),
          invitedById: ctx.info.actorId,
          expiresAt,
        },
        select: invitationSelect,
      });
      await deps.jobs.enqueue("email-send", { kind: "invitation", invitationId: row.id }, { tx });
      await auditAdmin(
        { db: tx, info: ctx.info },
        {
          action: "invitation.create",
          entityType: "Invitation",
          entityId: row.id,
          // Lo hecho por un jefe queda marcado: los administradores lo ven en Invitaciones
          // pendientes, en la auditoría y en la campana (notifyLeaderInvitations).
          metadata: {
            email,
            roleId: role.id,
            seatType,
            departmentIds: input.departmentIds,
            ...(leaderScope === null ? {} : { byLeader: true }),
          },
        },
      );
      created.push(row);
    }
    return created;
  });
  // Lo que invita un jefe o subjefe les llega a quienes administran los miembros (campana).
  if (leaderScope !== null) {
    await notifyLeaderInvitations(ctx.db, {
      actorId: ctx.tenant.membershipId,
      invitationIds: rows.map((row) => row.id),
    });
  }
  const names = new Map([[ctx.info.actorId, actor.name]]);
  return { invitations: rows.map((row) => toView(row, names, now)), skipped };
}

async function loadPending(ctx: AdminContext, id: string) {
  const row = await ctx.db.invitation.findFirst({
    where: { id, ...pendingWhere },
    select: invitationSelect,
  });
  if (row === null) throw notFound();
  return row;
}

export async function revokeInvitation(ctx: AdminContext, id: string): Promise<void> {
  await assertGlobalManager(ctx);
  const row = await loadPending(ctx, id);
  await ctx.db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await auditAdmin(ctx, {
    action: "invitation.revoke",
    entityType: "Invitation",
    entityId: id,
    metadata: { email: row.email },
  });
}

/** Reenvía el email con un enlace nuevo (el anterior deja de servir) y renueva el plazo. */
export async function resendInvitation(
  ctx: AdminContext,
  deps: InvitationDeps,
  id: string,
): Promise<InvitationView> {
  await assertGlobalManager(ctx);
  const row = await loadPending(ctx, id);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const updated = await ctx.db.$transaction(async (tx) => {
    const result = await tx.invitation.update({
      where: { id },
      data: { expiresAt },
      select: invitationSelect,
    });
    await deps.jobs.enqueue("email-send", { kind: "invitation", invitationId: id }, { tx });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "invitation.resend",
        entityType: "Invitation",
        entityId: id,
        metadata: { email: row.email },
      },
    );
    return result;
  });
  return toView(updated, await inviterNames(deps, [updated.invitedById]), now);
}

export async function seats(ctx: AdminContext) {
  return await seatSummary(ctx.db);
}
