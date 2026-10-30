// Administración › Registro de auditoría: lista filtrable del AuditLog del workspace (scroll infinito por
// cursor del último elemento visto), su exportación a CSV y el recorte semanal según la retención que fija la
// empresa (si fijó una). Solo lectura: nada acá modifica un evento. La metadata nunca lleva contenido ni secretos.
import { companyZone, endOfDayIn, startOfDayIn } from "../../lib/time-zone.ts";
import { z } from "zod";
import { forTenant } from "../../db/tenant.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { toCsv } from "../../lib/csv.ts";
import { AppError } from "../../lib/errors.ts";
import {
  CursorQuerySchema,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  type CursorPosition,
} from "../../lib/pagination.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { workspaceLimits } from "../limits/limits.service.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { auditExportLabels } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.iso.date();

interface Deps {
  prisma: PrismaClient;
}

export const AuditFiltersSchema = z.object({
  /** Persona que hizo la acción (su membresía en el workspace). */
  memberId: Id.optional(),
  /** Acción exacta («document.published») o un área entera («document.»). */
  action: z.string().trim().min(1).max(80).optional(),
  entityType: z.string().trim().min(1).max(40).optional(),
  entityId: Id.optional(),
  /** Desde el comienzo de este día y hasta el final de este otro (hora del servidor, UTC). */
  from: Day.optional(),
  to: Day.optional(),
});
export type AuditFilters = z.infer<typeof AuditFiltersSchema>;

export const AuditListQuerySchema = AuditFiltersSchema.extend(CursorQuerySchema.shape);
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export interface AuditEvent {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string | null;
  entityId: string | null;
  /** null: evento sin persona (el sistema). `staff`: el equipo de SpiderFolio, que no es miembro. */
  actor: { id: string; name: string | null; email: string | null; staff: boolean } | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
}

/** El filtro por persona va por membresía; los eventos guardan el usuario. Sin esa persona: nada coincide. */
async function actorFilter(ctx: AdminContext, filters: AuditFilters): Promise<string | undefined> {
  if (filters.memberId === undefined) return undefined;
  const member = await ctx.db.membership.findFirst({
    where: { id: filters.memberId },
    select: { userId: true },
  });
  return member?.userId ?? "-";
}

/** «From» and «to» are whole days in the company's zone. */
function whereOf(
  workspaceId: string,
  filters: AuditFilters,
  actorId: string | undefined,
  zone: string,
): Prisma.AuditLogWhereInput {
  const created: Prisma.DateTimeFilter = {};
  if (filters.from !== undefined) created.gte = startOfDayIn(filters.from, zone);
  if (filters.to !== undefined)
    created.lte = new Date(endOfDayIn(filters.to, zone).getTime() + 999);
  return {
    workspaceId,
    ...(actorId === undefined ? {} : { actorId }),
    ...(filters.action === undefined
      ? {}
      : filters.action.endsWith(".")
        ? { action: { startsWith: filters.action } }
        : { action: filters.action }),
    ...(filters.entityType === undefined ? {} : { entityType: filters.entityType }),
    ...(filters.entityId === undefined ? {} : { entityId: filters.entityId }),
    ...(Object.keys(created).length === 0 ? {} : { createdAt: created }),
  };
}

type Row = {
  id: string;
  createdAt: Date;
  action: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
};

/** Quién es cada `actorId`: miembros del workspace, o el equipo de SpiderFolio si no lo es. */
async function actorsOf(ctx: AdminContext, { prisma }: Deps, ids: string[]) {
  const map = new Map<string, NonNullable<AuditEvent["actor"]>>();
  if (ids.length === 0) return map;
  const members = await ctx.db.membership.findMany({
    where: { userId: { in: ids } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  for (const { user } of members) {
    map.set(user.id, { id: user.id, name: user.name, email: user.email, staff: false });
  }
  const others = ids.filter((id) => !map.has(id));
  if (others.length > 0) {
    // Quien no es miembro (ya salió o es del equipo) se muestra solo con el nombre; el email no.
    const users = await prisma.user.findMany({
      where: { id: { in: others } },
      select: { id: true, name: true, isStaff: true },
    });
    for (const user of users) {
      map.set(user.id, {
        id: user.id,
        name: user.isStaff ? null : user.name,
        email: null,
        staff: user.isStaff,
      });
    }
  }
  return map;
}

function toEvents(rows: Row[], actors: Awaited<ReturnType<typeof actorsOf>>): AuditEvent[] {
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actor: row.actorId === null ? null : (actors.get(row.actorId) ?? null),
    ip: row.ip,
    userAgent: row.userAgent,
    metadata: row.metadata,
  }));
}

const select = {
  id: true,
  createdAt: true,
  action: true,
  actorId: true,
  entityType: true,
  entityId: true,
  ip: true,
  userAgent: true,
  metadata: true,
} as const;

export async function listAudit(ctx: AdminContext, deps: Deps, query: AuditListQuery) {
  const where = whereOf(
    ctx.db.workspaceId,
    query,
    await actorFilter(ctx, query),
    await companyZone(ctx.db),
  );
  const position = decodeCursor(query.cursor);
  if (query.cursor !== undefined && query.cursor !== "" && position === null) {
    throw new AppError("BAD_REQUEST", { message: auditExportLabels.invalidCursor });
  }
  // Orden estable: del más nuevo al más viejo, con el id de desempate.
  const after: Prisma.AuditLogWhereInput =
    position === null
      ? {}
      : {
          OR: [
            { createdAt: { lt: new Date(String(position.v)) } },
            { createdAt: new Date(String(position.v)), id: { lt: position.id } },
          ],
        };
  const [rows, total] = await Promise.all([
    ctx.db.auditLog.findMany({
      where: { AND: [where, after] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select,
    }),
    ctx.db.auditLog.count({ where }),
  ]);
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > query.limit && last !== undefined
      ? encodeCursor({ v: last.createdAt.toISOString(), id: last.id } satisfies CursorPosition)
      : null;
  const actors = await actorsOf(ctx, deps, [
    ...new Set(items.flatMap((row) => (row.actorId === null ? [] : [row.actorId]))),
  ]);
  return { items: toEvents(items, actors), total, nextCursor };
}

/** Tope de filas de un CSV: más que esto, se acota con las fechas. */
export const AUDIT_EXPORT_MAX = 50_000;

export async function auditCsv(
  ctx: AdminContext,
  deps: Deps,
  filters: AuditFilters,
): Promise<{ fileName: string; csv: string }> {
  const where = whereOf(
    ctx.db.workspaceId,
    filters,
    await actorFilter(ctx, filters),
    await companyZone(ctx.db),
  );
  const total = await ctx.db.auditLog.count({ where });
  if (total > AUDIT_EXPORT_MAX) {
    throw new AppError("BAD_REQUEST", {
      message: auditExportLabels.tooMany(AUDIT_EXPORT_MAX.toLocaleString(currentLocale())),
    });
  }
  const rows: Row[] = [];
  let cursorId: string | undefined;
  for (;;) {
    const batch = await ctx.db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_PAGE_SIZE * 10,
      ...(cursorId === undefined ? {} : { cursor: { id: cursorId }, skip: 1 }),
      select,
    });
    rows.push(...batch);
    const last = batch.at(-1);
    if (last === undefined || batch.length < MAX_PAGE_SIZE * 10) break;
    cursorId = last.id;
  }
  const actors = await actorsOf(ctx, deps, [
    ...new Set(rows.flatMap((row) => (row.actorId === null ? [] : [row.actorId]))),
  ]);
  const events = toEvents(rows, actors);
  await auditAdmin(ctx, {
    action: "audit.export",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { rows: events.length, filters: { ...filters } },
  });
  return {
    fileName: auditExportLabels.fileName,
    csv: toCsv(
      auditExportLabels.headers,
      events.map((event) => [
        event.createdAt,
        event.actor?.staff === true ? auditExportLabels.staff : (event.actor?.name ?? ""),
        event.actor?.email ?? "",
        event.action,
        event.entityType,
        event.entityId,
        event.ip,
        event.metadata === null || event.metadata === undefined
          ? ""
          : JSON.stringify(event.metadata),
      ]),
    ),
  };
}

const DAY_MS = 24 * 3600 * 1000;
const PRUNE_BATCH = 5000;

/**
 * Recorte semanal: borra los eventos más viejos que `auditRetentionDays` de cada workspace (sin
 * límite, lo predeterminado: no se borra nada). Es lo único que borra AuditLog, junto con la purga de
 * un workspace eliminado.
 */
export async function pruneAudit(
  deps: { prisma: PrismaClient },
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const workspaces = await deps.prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let deleted = 0;
  for (const { id } of workspaces) {
    const days = (await workspaceLimits(forTenant(deps.prisma, id))).auditRetentionDays;
    if (days === null) continue;
    const before = new Date(now.getTime() - days * DAY_MS);
    for (;;) {
      const old = await deps.prisma.auditLog.findMany({
        where: { workspaceId: id, createdAt: { lt: before } },
        select: { id: true },
        take: PRUNE_BATCH,
      });
      if (old.length === 0) break;
      const result = await deps.prisma.auditLog.deleteMany({
        where: { id: { in: old.map((row) => row.id) } },
      });
      deleted += result.count;
      if (old.length < PRUNE_BATCH) break;
    }
  }
  return { deleted };
}
