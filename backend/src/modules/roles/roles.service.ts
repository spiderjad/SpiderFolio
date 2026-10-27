// Roles del workspace (CLAUDE.md, secciones 9.1 a 9.3): los 4 de sistema (solo lectura) y los
// personalizados. Cada cambio queda en el AuditLog.
import type { SystemRole } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { roleMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { peopleScopeOf } from "../people/people-scope.ts";
import { isCapability, type Capability } from "./capabilities.ts";
import { assertCanManageRole, assertRoleAllowed, isAdministrative } from "./role-rules.ts";
import type {
  CreateRoleInput,
  ListRolesQuery,
  RoleOptionsQuery,
  UpdateRoleInput,
} from "./roles.schemas.ts";

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  base: SystemRole;
  capabilities: Capability[];
  isSystem: boolean;
  memberCount: number;
  pendingInvitations: number;
}

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  base: SystemRole;
  capabilities: string[];
  isSystem: boolean;
};

const roleSelect = {
  id: true,
  name: true,
  description: true,
  base: true,
  capabilities: true,
  isSystem: true,
} as const;

function view(row: RoleRow, memberCount: number, pendingInvitations: number): RoleView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    base: row.base,
    capabilities: row.capabilities.filter(isCapability),
    isSystem: row.isSystem,
    memberCount,
    pendingInvitations,
  };
}

async function usage(ctx: Pick<AdminContext, "db">, roleId?: string | readonly string[]) {
  const roleFilter =
    roleId === undefined
      ? {}
      : { roleId: typeof roleId === "string" ? roleId : { in: [...roleId] } };
  const [members, invitations] = await Promise.all([
    ctx.db.membership.groupBy({
      by: ["roleId"],
      where: roleFilter,
      _count: { _all: true },
    }),
    ctx.db.invitation.groupBy({
      by: ["roleId"],
      where: {
        ...roleFilter,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: { roleId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.roleId, row._count._all]));
  return { members: count(members), invitations: count(invitations) };
}

function orderOf(query: ListRolesQuery) {
  const { dir } = query;
  if (query.sort === "name") return stableOrder({ name: dir });
  if (query.sort === "members") return stableOrder({ memberships: { _count: dir } });
  // Nivel: los de sistema primero (propietario, administrador, miembro, invitado) y los
  // personalizados por su rol base y su nombre.
  return stableOrder([
    { isSystem: dir === "asc" ? "desc" : "asc" } as const,
    { base: dir },
    { name: dir },
  ]);
}

export async function listRoles(
  ctx: Pick<AdminContext, "db">,
  query: ListRolesQuery,
): Promise<Page<RoleView>> {
  const where = {
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" as const } }),
    ...(query.kind === undefined ? {} : { isSystem: query.kind === "system" }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.role.findMany({
      where,
      select: roleSelect,
      orderBy: orderOf(query),
      ...offsetArgs(query),
    }),
    ctx.db.role.count({ where }),
  ]);
  const counts = await usage(
    ctx,
    rows.map((row) => row.id),
  );
  return pageOf(
    rows.map((row) =>
      view(row, counts.members.get(row.id) ?? 0, counts.invitations.get(row.id) ?? 0),
    ),
    total,
    query,
  );
}

/** Para los combobox de rol (invitar, editar personas): búsqueda y páginas, por nivel o nombre. */
export async function listRoleOptions(
  ctx: AdminContext,
  query: RoleOptionsQuery,
): Promise<Page<RoleView>> {
  const { manage } = await peopleScopeOf(ctx);
  if (manage.kind === "none") throw forbidden();
  const where = {
    // Jefe y subjefe solo invitan como Miembro o Lector: el rol Miembro, sin capacidades.
    ...(manage.kind === "own"
      ? { base: "MEMBER" as const, isSystem: true, capabilities: { isEmpty: true } }
      : {}),
    ...(query.ids === undefined ? {} : { id: { in: query.ids } }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" as const } }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.role.findMany({
      where,
      select: roleSelect,
      orderBy:
        query.sort === "name"
          ? stableOrder({ name: query.dir })
          : stableOrder([{ isSystem: "desc" } as const, { base: "asc" }, { name: "asc" }]),
      ...offsetArgs(query),
    }),
    ctx.db.role.count({ where }),
  ]);
  const counts = await usage(
    ctx,
    rows.map((row) => row.id),
  );
  return pageOf(
    rows.map((row) =>
      view(row, counts.members.get(row.id) ?? 0, counts.invitations.get(row.id) ?? 0),
    ),
    total,
    query,
  );
}

async function loadRole(ctx: Pick<AdminContext, "db">, id: string) {
  const row = await ctx.db.role.findFirst({ where: { id }, select: roleSelect });
  if (row === null) throw notFound();
  return row;
}

async function assertNameFree(ctx: Pick<AdminContext, "db">, name: string, exceptId?: string) {
  const taken = await ctx.db.role.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (taken !== null) throw new AppError("CONFLICT", { message: roleMessages.nameTaken });
}

export async function createRole(ctx: AdminContext, input: CreateRoleInput): Promise<RoleView> {
  assertRoleAllowed(ctx.actor, input);
  await assertNameFree(ctx, input.name);
  const row = await ctx.db.role.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      base: input.base,
      capabilities: input.capabilities,
      isSystem: false,
    },
    select: roleSelect,
  });
  await auditAdmin(ctx, {
    action: "role.create",
    entityType: "Role",
    entityId: row.id,
    metadata: { name: row.name, base: row.base, capabilities: input.capabilities },
  });
  return view(row, 0, 0);
}

export async function updateRole(
  ctx: AdminContext,
  id: string,
  input: UpdateRoleInput,
): Promise<RoleView> {
  const current = await loadRole(ctx, id);
  const currentShape = { ...current, capabilities: current.capabilities.filter(isCapability) };
  assertCanManageRole(ctx.actor, currentShape);
  const next = {
    base: input.base ?? current.base,
    capabilities: input.capabilities ?? currentShape.capabilities,
  };
  assertRoleAllowed(ctx.actor, next);
  if (input.name !== undefined && input.name !== current.name) {
    await assertNameFree(ctx, input.name, id);
  }

  // Un rol en uso tiene que seguir siendo válido para las personas que lo tienen (9A.4).
  const [readers, fullSeats] = await Promise.all([
    ctx.db.membership.count({ where: { roleId: id, seatType: "READER" } }),
    ctx.db.membership.count({ where: { roleId: id, seatType: "FULL" } }),
  ]);
  if (isAdministrative(next) && readers > 0) {
    throw new AppError("CONFLICT", { message: roleMessages.readersCannotAdminister });
  }
  if (next.base === "GUEST" && fullSeats > 0) {
    throw new AppError("CONFLICT", { message: roleMessages.guestsNeedReaderSeat });
  }

  const row = await ctx.db.role.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.base === undefined ? {} : { base: input.base }),
      ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
    },
    select: roleSelect,
  });
  await auditAdmin(ctx, {
    action: "role.update",
    entityType: "Role",
    entityId: id,
    metadata: {
      before: { name: current.name, base: current.base, capabilities: current.capabilities },
      after: { name: row.name, base: row.base, capabilities: row.capabilities },
    },
  });
  const counts = await usage(ctx, id);
  return view(row, counts.members.get(id) ?? 0, counts.invitations.get(id) ?? 0);
}

export async function deleteRole(ctx: AdminContext, id: string): Promise<void> {
  const current = await loadRole(ctx, id);
  assertCanManageRole(ctx.actor, {
    ...current,
    capabilities: current.capabilities.filter(isCapability),
  });
  const counts = await usage(ctx, id);
  const members = counts.members.get(id) ?? 0;
  const invitations = counts.invitations.get(id) ?? 0;
  if (members > 0 || invitations > 0) {
    throw new AppError("CONFLICT", { message: roleMessages.inUse(members, invitations) });
  }
  // Las invitaciones vencidas o revocadas también apuntan al rol (FK): se limpian primero.
  await ctx.db.$transaction(async (tx) => {
    await tx.invitation.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });
  });
  await auditAdmin(ctx, {
    action: "role.delete",
    entityType: "Role",
    entityId: id,
    metadata: { name: current.name },
  });
}
