// Miembros del workspace (CLAUDE.md, sección 9.3): listado del lado del servidor, cambios de rol,
// plaza y departamentos, suspender, quitar y cerrar sesiones. Cada acción queda en el AuditLog.
import type {
  DepartmentPosition,
  Prisma,
  SeatType,
  SystemRole,
} from "../../generated/prisma/client.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { violatedUniqueIndex } from "../../lib/prisma-errors.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { userMediaUrl } from "../profile-media/profile-media.service.ts";
import { memberExportLabels, memberMessages, mfaResetMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { revokeUserSessions } from "../auth/sessions.service.ts";
import { requireRecentMfa } from "../auth/mfa.service.ts";
import type { AppDeps } from "../../routes.ts";
import { isCapability, type Capability } from "../roles/capabilities.ts";
import { assertCanAssignRole, assertCanManageTarget, resolveSeat } from "./member-rules.ts";
import { toCsv } from "./members.csv.ts";
import type {
  ExportMembersQuery,
  ListMembersQuery,
  MemberGroup,
  UpdateMemberInput,
} from "./members.schemas.ts";
import { resolveMemberScope, scopeWhere } from "../departments/departments.scope.ts";
import { assertGlobalManager } from "../people/people-scope.ts";

export interface MemberDeps {
  prisma: PrismaClient;
  jobs: Jobs;
}

/** Dependencias de este módulo, tomadas de las de la app. */
export function memberDepsOf(deps: AppDeps): MemberDeps {
  return { prisma: deps.prisma, jobs: deps.jobs };
}

export interface MemberView {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  jobTitle: string | null;
  roleId: string;
  roleName: string;
  roleBase: SystemRole;
  seatType: SeatType;
  status: "ACTIVE" | "SUSPENDED";
  /** Departamentos a los que pertenece, con su cargo en cada uno. */
  departments: { id: string; name: string; position: DepartmentPosition }[];
  /** Los que lidera: jefe o subjefe (subconjunto de `departments`). */
  managedDepartments: { id: string; name: string; position: "HEAD" | "DEPUTY" }[];
  /** El rol tiene capacidades con alcance propio (rigen en los departamentos que lidera). */
  /** Entra con usuario y PIN (sin email). */
  kind: "STANDARD" | "PIN";
  /** Usuario de quien entra con PIN. */
  loginName: string | null;
  /** El PIN está bloqueado por demasiados intentos fallidos. */
  pinLocked: boolean;
  /** Tiene activa la verificación en dos pasos. */
  twoFactor: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  isSelf: boolean;
  /** Foto de perfil (null: se muestran las iniciales). */
  avatarUrl: string | null;
}

export const memberSelect = {
  id: true,
  jobTitle: true,
  status: true,
  seatType: true,
  createdAt: true,
  lastSeenAt: true,
  roleId: true,
  role: { select: { id: true, name: true, base: true, capabilities: true } },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      kind: true,
      avatarKey: true,
      totpEnabledAt: true,
    },
  },
  pinLogin: { select: { loginName: true, lockedUntil: true } },
  departments: {
    select: { position: true, department: { select: { id: true, name: true } } },
  },
} as const;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

export function toView(row: MemberRow, selfUserId: string): MemberView {
  const departments = row.departments
    .map((d) => ({ ...d.department, position: d.position }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return {
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    emailVerified: row.user.emailVerifiedAt !== null,
    jobTitle: row.jobTitle,
    roleId: row.role.id,
    roleName: row.role.name,
    roleBase: row.role.base,
    seatType: row.seatType,
    status: row.status,
    departments,
    managedDepartments: departments.flatMap((d) =>
      d.position === "MEMBER" ? [] : [{ ...d, position: d.position }],
    ),
    kind: row.user.kind,
    loginName: row.pinLogin?.loginName ?? null,
    pinLocked: row.pinLogin?.lockedUntil != null && row.pinLogin.lockedUntil > new Date(),
    twoFactor: row.user.totpEnabledAt !== null,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    isSelf: row.user.id === selfUserId,
    avatarUrl: userMediaUrl("avatar", row.user.id, row.user.avatarKey),
  };
}

function orderByOf(
  query: Pick<ListMembersQuery, "sort" | "dir">,
): Prisma.MembershipOrderByWithRelationInput[] {
  const { dir } = query;
  const primary: Prisma.MembershipOrderByWithRelationInput = {
    hierarchy: { user: { name: dir } },
    name: { user: { name: dir } },
    email: { user: { email: dir } },
    role: { role: { name: dir } },
    status: { status: dir },
    createdAt: { createdAt: dir },
    lastSeenAt: { lastSeenAt: { sort: dir, nulls: "last" as const } },
  }[query.sort];
  return [primary, { id: "asc" }];
}

const BOSS_BASES: SystemRole[] = ["OWNER", "ADMIN"];

/** Jefe o subjefe de algún departamento (sea cual sea su rol). */
const leadsSome: Prisma.MembershipWhereInput = {
  departments: { some: { position: { in: ["HEAD", "DEPUTY"] } } },
};
const leadsNone: Prisma.MembershipWhereInput = {
  departments: { none: { position: { in: ["HEAD", "DEPUTY"] } } },
};

/** Quién entra en cada grupo de la jerarquía (excluyentes; ver memberGroups). */
export function groupWhere(group: MemberGroup): Prisma.MembershipWhereInput {
  const notDirection: Prisma.MembershipWhereInput = { role: { base: { notIn: BOSS_BASES } } };
  switch (group) {
    case "owner":
      return { role: { base: "OWNER" } };
    case "admins":
      return { role: { base: "ADMIN" } };
    case "direction":
      return { role: { base: { in: BOSS_BASES } } };
    // La jefatura es un cargo, no un rol: cuenta a cualquiera que lidere (también administradores).
    case "managers":
      return leadsSome;
    case "readers":
      return { ...notDirection, seatType: "READER" };
    case "members":
      return { ...notDirection, seatType: "FULL" };
  }
}

export function whereOf(
  query: Pick<ListMembersQuery, "q" | "ids" | "status" | "role" | "department" | "group">,
): Prisma.MembershipWhereInput {
  const q = query.q;
  return {
    ...(query.ids === undefined ? {} : { id: { in: query.ids } }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.role === undefined ? {} : { roleId: query.role }),
    ...(query.department === undefined
      ? {}
      : query.department === "none"
        ? { departments: { none: {} } }
        : { departments: { some: { departmentId: query.department } } }),
    ...(query.group === undefined ? {} : { AND: [groupWhere(query.group)] }),
    ...(q === undefined || q === ""
      ? {}
      : {
          OR: [
            { user: { name: { contains: q, mode: "insensitive" } } },
            { user: { email: { contains: q, mode: "insensitive" } } },
            { jobTitle: { contains: q, mode: "insensitive" } },
          ],
        }),
  };
}

/** Escalones de la jerarquía en orden: propietario, administradores, jefes y el resto. */
const hierarchy = ["owner", "admins", "managers", "rest"] as const;
type Rung = (typeof hierarchy)[number];

function rungWhere(rung: Rung): Prisma.MembershipWhereInput {
  return rung === "rest"
    ? { role: { base: { notIn: BOSS_BASES } }, ...leadsNone }
    : rung === "managers"
      ? { role: { base: { notIn: BOSS_BASES } }, ...leadsSome }
      : groupWhere(rung);
}

/**
 * Orden por jerarquía (propietario, administradores, jefes, resto) y después por nombre, con
 * paginación en la base: se cuenta cada escalón y la página se arma con las filas que le tocan.
 */
async function listByHierarchy(
  ctx: AdminContext,
  query: ListMembersQuery,
): Promise<Page<MemberView>> {
  const filter: Prisma.MembershipWhereInput = {
    AND: [whereOf(query), scopeWhere(await resolveMemberScope(ctx))],
  };
  const rungs = query.dir === "asc" ? [...hierarchy] : [...hierarchy].reverse();
  const counts = await Promise.all(
    rungs.map((rung) => ctx.db.membership.count({ where: { AND: [filter, rungWhere(rung)] } })),
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  let { skip, take: missing } = offsetArgs(query);
  const rows: MemberRow[] = [];
  for (const [index, rung] of rungs.entries()) {
    const count = counts[index] ?? 0;
    if (skip >= count) {
      skip -= count;
      continue;
    }
    const found = await ctx.db.membership.findMany({
      where: { AND: [filter, rungWhere(rung)] },
      select: memberSelect,
      orderBy: orderByOf(query),
      skip,
      take: missing,
    });
    rows.push(...found);
    missing -= found.length;
    skip = 0;
    if (missing <= 0) break;
  }
  return pageOf(
    rows.map((row) => toView(row, ctx.info.actorId)),
    total,
    query,
  );
}

export async function listMembers(
  ctx: AdminContext,
  query: ListMembersQuery,
): Promise<Page<MemberView>> {
  if (query.sort === "hierarchy") return await listByHierarchy(ctx, query);
  const where: Prisma.MembershipWhereInput = {
    AND: [whereOf(query), scopeWhere(await resolveMemberScope(ctx))],
  };
  const [rows, total] = await Promise.all([
    ctx.db.membership.findMany({
      where,
      select: memberSelect,
      orderBy: orderByOf(query),
      ...offsetArgs(query),
    }),
    ctx.db.membership.count({ where }),
  ]);
  return pageOf(
    rows.map((row) => toView(row, ctx.info.actorId)),
    total,
    query,
  );
}

/** Cuántas personas hay en cada grupo (las tarjetas de arriba); sin filtros. */
export async function memberSummary(ctx: AdminContext) {
  const groups = ["owner", "admins", "managers", "members", "readers"] as const;
  const scope = scopeWhere(await resolveMemberScope(ctx));
  const counts = await Promise.all(
    groups.map((group) => ctx.db.membership.count({ where: { AND: [groupWhere(group), scope] } })),
  );
  const [owners = 0, admins = 0, managers = 0, members = 0, readers = 0] = counts;
  // Rol y jefatura son ejes distintos: un administrador puede ser además jefe, así que
  // "managers" no entra en la suma del total.
  return { owners, admins, managers, members, readers, total: owners + admins + members + readers };
}

/** Tope de filas de una exportación: más que el máximo de plazas de cualquier plan. */
const EXPORT_MAX_ROWS = 5000;

/** Lista filtrada como CSV (9.3). Registra la exportación en el AuditLog. */
export async function exportMembers(
  ctx: AdminContext,
  query: ExportMembersQuery,
): Promise<{ filename: string; csv: string; rows: number }> {
  const rows = await ctx.db.membership.findMany({
    where: { AND: [whereOf(query), scopeWhere(await resolveMemberScope(ctx))] },
    select: memberSelect,
    orderBy: orderByOf(query),
    take: EXPORT_MAX_ROWS,
  });
  const L = memberExportLabels;
  const date = (value: Date | null) => (value === null ? "" : value.toISOString());
  const table = [
    [
      L.name,
      L.email,
      L.loginName,
      L.jobTitle,
      L.role,
      L.seat,
      L.status,
      L.departments,
      L.lastSeen,
      L.createdAt,
    ],
    ...rows.map((row) => {
      const view = toView(row, ctx.info.actorId);
      return [
        view.name,
        view.email ?? "",
        view.loginName ?? "",
        view.jobTitle ?? "",
        view.roleName,
        L.seats[view.seatType],
        L.statuses[view.status],
        view.departments.map((d) => d.name).join(" | "),
        date(view.lastSeenAt),
        date(view.createdAt),
      ];
    }),
  ];
  await auditAdmin(ctx, {
    action: "member.export",
    entityType: "Membership",
    metadata: { rows: rows.length },
  });
  return {
    filename: `miembros-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(table),
    rows: rows.length,
  };
}

export async function getMember(ctx: AdminContext, id: string): Promise<MemberView> {
  // Con alcance propio, quien está fuera de sus departamentos no existe para la persona (404).
  const row = await ctx.db.membership.findFirst({
    where: { id, ...scopeWhere(await resolveMemberScope(ctx)) },
    select: memberSelect,
  });
  if (row === null) throw notFound();
  return toView(row, ctx.info.actorId);
}

interface Target {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  status: "ACTIVE" | "SUSPENDED";
  seatType: SeatType;
  roleId: string;
  role: { id: string; name: string; base: SystemRole; capabilities: Capability[] };
  departmentIds: string[];
}

async function loadTarget(ctx: AdminContext, id: string): Promise<Target> {
  const row = await ctx.db.membership.findFirst({
    where: { id },
    select: {
      id: true,
      status: true,
      seatType: true,
      roleId: true,
      role: { select: { id: true, name: true, base: true, capabilities: true } },
      user: { select: { id: true, name: true, email: true } },
      departments: { select: { departmentId: true } },
    },
  });
  if (row === null) throw notFound();
  return {
    id: row.id,
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    status: row.status,
    seatType: row.seatType,
    roleId: row.roleId,
    role: { ...row.role, capabilities: row.role.capabilities.filter(isCapability) },
    departmentIds: row.departments.map((d) => d.departmentId),
  };
}

async function loadRole(ctx: AdminContext, id: string) {
  const row = await ctx.db.role.findFirst({
    where: { id },
    select: { id: true, name: true, base: true, capabilities: true },
  });
  if (row === null) throw notFound();
  return { ...row, capabilities: row.capabilities.filter(isCapability) };
}

async function activeOwners(ctx: AdminContext): Promise<number> {
  return await ctx.db.membership.count({ where: { status: "ACTIVE", role: { base: "OWNER" } } });
}

async function assertNotLastOwner(ctx: AdminContext, target: Target): Promise<void> {
  if (
    target.role.base === "OWNER" &&
    target.status === "ACTIVE" &&
    (await activeOwners(ctx)) <= 1
  ) {
    throw new AppError("CONFLICT", { message: memberMessages.lastOwner });
  }
}

function assertNotSelf(ctx: AdminContext, target: Target): void {
  if (target.userId === ctx.info.actorId) {
    throw new AppError("BAD_REQUEST", { message: memberMessages.cannotActOnSelf });
  }
}

async function assertDepartmentsExist(ctx: AdminContext, ids: readonly string[]) {
  if (ids.length === 0) return;
  const found = await ctx.db.department.count({ where: { id: { in: [...ids] } } });
  if (found !== ids.length) throw notFound();
}

/**
 * Corregir el nombre o el email de una persona (por una equivocación al cargarla). Es la identidad
 * de su cuenta, así que solo se puede mientras la cuenta sea de esta empresa: si pertenece a otras,
 * o si ya confirmó su email, lo cambia la propia persona. Un email nuevo cierra sus sesiones y se
 * vuelve a confirmar.
 */
async function changeIdentity(
  ctx: AdminContext,
  deps: MemberDeps,
  target: Target,
  input: UpdateMemberInput,
): Promise<{ nameChanged: boolean; emailChanged: boolean }> {
  const nameChanged = input.name !== undefined && input.name !== target.name;
  const emailChanged = input.email !== undefined && input.email !== target.email;
  if (!nameChanged && !emailChanged) return { nameChanged, emailChanged };
  const user = await deps.prisma.user.findUnique({
    where: { id: target.userId },
    select: { kind: true, emailVerifiedAt: true },
  });
  if (user === null) throw notFound();
  const elsewhere = await deps.prisma.membership.count({
    where: { userId: target.userId, NOT: { workspaceId: ctx.tenant.workspaceId } },
  });
  if (elsewhere > 0) {
    throw new AppError("FORBIDDEN", { message: memberMessages.identityShared });
  }
  if (emailChanged) {
    if (user.kind === "PIN") {
      throw new AppError("BAD_REQUEST", { message: memberMessages.pinHasNoEmail });
    }
    if (user.emailVerifiedAt !== null) {
      throw new AppError("FORBIDDEN", { message: memberMessages.emailAlreadyConfirmed });
    }
  }
  try {
    await deps.prisma.user.update({
      where: { id: target.userId },
      data: {
        ...(input.name !== undefined && nameChanged ? { name: input.name } : {}),
        ...(input.email !== undefined && emailChanged
          ? { email: input.email, emailVerifiedAt: null }
          : {}),
      },
    });
  } catch (error) {
    if (violatedUniqueIndex(error) === "User_email_key") {
      throw new AppError("CONFLICT", { message: memberMessages.emailTaken });
    }
    throw error;
  }
  if (emailChanged) await revokeUserSessions(deps.prisma, target.userId);
  return { nameChanged, emailChanged };
}

export async function updateMember(
  ctx: AdminContext,
  deps: MemberDeps,
  id: string,
  input: UpdateMemberInput,
): Promise<MemberView> {
  await assertGlobalManager(ctx);
  const target = await loadTarget(ctx, id);
  assertCanManageTarget(ctx.actor, target.role.base);

  let role = target.role;
  if (input.roleId !== undefined && input.roleId !== target.roleId) {
    role = await loadRole(ctx, input.roleId);
    assertCanAssignRole(ctx.actor, role);
    // Bajarle el rol a un propietario: tiene que quedar otro activo.
    await assertNotLastOwner(ctx, target);
  }

  const seat = resolveSeat({ current: target.seatType, requested: input.seatType, role });

  const isGuest = role.base === "GUEST";
  if (isGuest && input.departmentIds !== undefined && input.departmentIds.length > 0) {
    throw new AppError("BAD_REQUEST", { message: memberMessages.guestsHaveNoDepartments });
  }
  if (input.departmentIds !== undefined) await assertDepartmentsExist(ctx, input.departmentIds);
  // Un invitado externo no pertenece a departamentos: al pasar a ese rol se vacían.
  const departmentIds = isGuest ? [] : input.departmentIds;
  const clearDepartments = isGuest && target.departmentIds.length > 0;

  const identity = await changeIdentity(ctx, deps, target, input);

  await ctx.db.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id },
      data: {
        ...(role.id === target.roleId ? {} : { roleId: role.id }),
        ...(seat === target.seatType ? {} : { seatType: seat }),
        ...(input.jobTitle === undefined ? {} : { jobTitle: input.jobTitle }),
      },
    });
    if (departmentIds !== undefined || clearDepartments) {
      const next = departmentIds ?? [];
      // Los que se conservan mantienen su cargo; los que salen lo pierden con la pertenencia.
      await tx.departmentMember.deleteMany({
        where: { membershipId: id, departmentId: { notIn: next } },
      });
      if (next.length > 0) {
        await tx.departmentMember.createMany({
          data: next.map((departmentId) => ({ departmentId, membershipId: id })),
          skipDuplicates: true,
        });
      }
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "member.update",
        entityType: "Membership",
        entityId: id,
        metadata: {
          before: { roleId: target.roleId, seatType: target.seatType },
          after: { roleId: role.id, seatType: seat },
          ...(input.departmentIds === undefined ? {} : { departmentIds: input.departmentIds }),
          ...(input.jobTitle === undefined ? {} : { jobTitleChanged: true }),
          ...(identity.nameChanged ? { nameChanged: true } : {}),
          ...(identity.emailChanged ? { emailChanged: true } : {}),
        },
      },
    );
  });
  if (identity.emailChanged) {
    // El email nuevo se confirma como cualquier cuenta nueva; el mensaje sale por el worker.
    await deps.jobs.enqueue("email-send", { kind: "verify-email", userId: target.userId });
  }
  return await getMember(ctx, id);
}

/** Cada persona corrige su propio puesto (es el de su membresía en esta empresa). */
export async function updateOwnJobTitle(ctx: AdminContext, jobTitle: string | null): Promise<void> {
  await ctx.db.membership.update({
    where: { id: ctx.tenant.membershipId },
    data: { jobTitle },
  });
  await auditAdmin(ctx, {
    action: "member.profile_update",
    entityType: "Membership",
    entityId: ctx.tenant.membershipId,
  });
}

export async function suspendMember(ctx: AdminContext, id: string): Promise<MemberView> {
  await assertGlobalManager(ctx);
  const target = await loadTarget(ctx, id);
  assertCanManageTarget(ctx.actor, target.role.base);
  assertNotSelf(ctx, target);
  if (target.status === "SUSPENDED") {
    throw new AppError("CONFLICT", { message: memberMessages.alreadySuspended });
  }
  await assertNotLastOwner(ctx, target);
  // Suspendida, la persona queda fuera de este workspace al instante (tenantMiddleware exige
  // ACTIVE) sin tocar sus otras empresas; deja de ocupar plaza.
  await ctx.db.membership.update({ where: { id }, data: { status: "SUSPENDED" } });
  await auditAdmin(ctx, { action: "member.suspend", entityType: "Membership", entityId: id });
  return await getMember(ctx, id);
}

export async function reactivateMember(
  ctx: AdminContext,
  _deps: MemberDeps,
  id: string,
): Promise<MemberView> {
  await assertGlobalManager(ctx);
  const target = await loadTarget(ctx, id);
  assertCanManageTarget(ctx.actor, target.role.base);
  if (target.status !== "SUSPENDED") {
    throw new AppError("CONFLICT", { message: memberMessages.notSuspended });
  }
  await ctx.db.membership.update({ where: { id }, data: { status: "ACTIVE" } });
  await auditAdmin(ctx, { action: "member.reactivate", entityType: "Membership", entityId: id });
  return await getMember(ctx, id);
}

export async function removeMember(
  ctx: AdminContext,
  id: string,
  transferToMembershipId?: string,
): Promise<void> {
  await assertGlobalManager(ctx);
  const target = await loadTarget(ctx, id);
  assertCanManageTarget(ctx.actor, target.role.base);
  assertNotSelf(ctx, target);
  await assertNotLastOwner(ctx, target);
  if (transferToMembershipId !== undefined) {
    const heir = await ctx.db.membership.findFirst({
      where: { id: transferToMembershipId, status: "ACTIVE", NOT: { id } },
      select: { id: true },
    });
    if (heir === null) {
      throw new AppError("BAD_REQUEST", { message: memberMessages.transferTargetInvalid });
    }
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id } });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "member.remove",
        entityType: "Membership",
        entityId: id,
        metadata: {
          email: target.email,
          roleId: target.roleId,
          ...(transferToMembershipId === undefined ? {} : { transferToMembershipId }),
        },
      },
    );
  });
}

/**
 * Cierra todas las sesiones de la cuenta. Las sesiones son de la cuenta, no del workspace: la
 * persona tendrá que volver a iniciar sesión también en sus otras empresas.
 */
export async function revokeMemberSessions(
  ctx: AdminContext,
  deps: MemberDeps,
  id: string,
): Promise<{ revoked: number }> {
  await assertGlobalManager(ctx);
  const target = await loadTarget(ctx, id);
  assertCanManageTarget(ctx.actor, target.role.base);
  const revoked = await revokeUserSessions(deps.prisma, target.userId);
  await auditAdmin(ctx, {
    action: "member.revoke_sessions",
    entityType: "Membership",
    entityId: id,
    metadata: { revoked },
  });
  return { revoked };
}

/**
 * Reiniciar la 2FA de un miembro (perdió el teléfono y los códigos): borra su secreto, sus códigos y
 * sus dispositivos de confianza y cierra sus sesiones; al volver a entrar la configura de nuevo (si la
 * política lo exige, antes de seguir). Lo hace un administrador con su propia 2FA activa y confirmada
 * hace menos de 10 minutos, con el mismo alcance que el resto de acciones sobre miembros. Queda en la
 * auditoría y la persona recibe un aviso por email.
 */
export async function resetMemberTwoFactor(
  ctx: AdminContext,
  deps: MemberDeps,
  auth: { userId: string; sessionId: string },
  id: string,
): Promise<void> {
  await assertGlobalManager(ctx);
  const target = await loadTarget(ctx, id);
  assertCanManageTarget(ctx.actor, target.role.base);
  if (target.userId === auth.userId) {
    throw new AppError("BAD_REQUEST", { message: mfaResetMessages.self });
  }
  const actor = await deps.prisma.user.findUnique({
    where: { id: auth.userId },
    select: { totpEnabledAt: true },
  });
  if (actor?.totpEnabledAt == null) {
    throw new AppError("FORBIDDEN", { message: mfaResetMessages.actorWithoutMfa });
  }
  await requireRecentMfa(deps.prisma, auth);
  const user = await deps.prisma.user.findUnique({
    where: { id: target.userId },
    select: { totpEnabledAt: true, totpSecretEnc: true },
  });
  if (user === null || (user.totpEnabledAt === null && user.totpSecretEnc === null)) {
    throw new AppError("BAD_REQUEST", { message: mfaResetMessages.notEnabled });
  }
  await deps.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.userId },
      data: {
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpFailedCount: 0,
        totpLockedUntil: null,
      },
    });
    await tx.recoveryCode.deleteMany({ where: { userId: target.userId } });
    await revokeUserSessions(tx, target.userId);
    await deps.jobs.enqueue(
      "email-send",
      { kind: "mfa-reset", userId: target.userId, workspaceId: ctx.db.workspaceId },
      { tx },
    );
  });
  await auditAdmin(ctx, {
    action: "member.2fa.reset",
    entityType: "Membership",
    entityId: id,
  });
}
