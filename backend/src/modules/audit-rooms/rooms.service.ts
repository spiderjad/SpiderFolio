// Audit rooms, for whoever builds them (docs/spec/salas-de-auditoria.md): audit.share creates a room for
// one external auditor, adds what it shares, revokes it and sees each access. Each one sees the rooms they
// created; the owner, every room.
import type { Jobs } from "../../jobs/boss.ts";
import { auditRoomTexts } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import {
  offsetArgs,
  pageOf,
  stableOrder,
  type Page,
  type PageQuery,
} from "../../lib/pagination.ts";
import { companyZone, endOfDayIn } from "../../lib/time-zone.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { describeItem } from "./room-items.ts";
import { MAX_ROOM_DAYS, type CreateRoomInput, type RoomItemInput } from "./rooms.schemas.ts";

export type RoomState = "open" | "expired" | "revoked";

export interface RoomView {
  id: string;
  name: string;
  auditorEmail: string;
  expiresAt: Date;
  allowDownload: boolean;
  state: RoomState;
  createdBy: { id: string; name: string };
  createdAt: Date;
  items: number;
  lastAccessAt: Date | null;
}

export interface RoomDetail extends RoomView {
  shared: { id: string; kind: string; report: string | null; title: string; createdAt: Date }[];
  accesses: { id: string; action: string; what: string | null; ip: string | null; at: Date }[];
}

const stateOf = (row: { revokedAt: Date | null; expiresAt: Date }, now = new Date()): RoomState =>
  row.revokedAt !== null ? "revoked" : row.expiresAt <= now ? "expired" : "open";

const ownerSeesAll = (ctx: AdminContext) => ctx.tenant.role.base === "OWNER";

async function loadRoom(ctx: AdminContext, id: string) {
  const row = await ctx.db.auditRoom.findFirst({
    where: { id, ...(ownerSeesAll(ctx) ? {} : { createdById: ctx.tenant.membershipId }) },
  });
  if (row === null) throw notFound();
  return row;
}

async function views(
  ctx: AdminContext,
  rows: Awaited<ReturnType<typeof loadRoom>>[],
): Promise<RoomView[]> {
  const ids = rows.map((row) => row.id);
  const [people, counts, lasts] = await Promise.all([
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
    ctx.db.auditRoomItem.groupBy({ by: ["roomId"], where: { roomId: { in: ids } }, _count: true }),
    ctx.db.auditRoomAccess.findMany({
      where: { roomId: { in: ids } },
      orderBy: { createdAt: "desc" },
      distinct: ["roomId"],
      select: { roomId: true, createdAt: true },
    }),
  ]);
  const names = new Map(people.map((row) => [row.id, row.user.name]));
  const count = new Map(counts.map((row) => [row.roomId, row._count]));
  const last = new Map(lasts.map((row) => [row.roomId, row.createdAt]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    auditorEmail: row.auditorEmail,
    expiresAt: row.expiresAt,
    allowDownload: row.allowDownload,
    state: stateOf(row),
    createdBy: { id: row.createdById, name: names.get(row.createdById) ?? "" },
    createdAt: row.createdAt,
    items: count.get(row.id) ?? 0,
    lastAccessAt: last.get(row.id) ?? null,
  }));
}

export async function listRooms(ctx: AdminContext, query: PageQuery): Promise<Page<RoomView>> {
  const where = ownerSeesAll(ctx) ? {} : { createdById: ctx.tenant.membershipId };
  const [rows, total] = await Promise.all([
    ctx.db.auditRoom.findMany({
      where,
      orderBy: stableOrder({ createdAt: "desc" }),
      ...offsetArgs(query),
    }),
    ctx.db.auditRoom.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}

export async function getRoom(ctx: AdminContext, id: string): Promise<RoomDetail> {
  const row = await loadRoom(ctx, id);
  const [[view], items, accesses] = await Promise.all([
    views(ctx, [row]),
    ctx.db.auditRoomItem.findMany({ where: { roomId: id }, orderBy: { createdAt: "asc" } }),
    ctx.db.auditRoomAccess.findMany({
      where: { roomId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
    }),
  ]);
  if (view === undefined) throw notFound();
  return {
    ...view,
    shared: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      report: item.report,
      title: item.title,
      createdAt: item.createdAt,
    })),
    accesses: accesses.map((access) => ({
      id: access.id,
      action: access.action,
      what: access.what,
      ip: access.ip,
      at: access.createdAt,
    })),
  };
}

export async function createRoom(
  ctx: AdminContext,
  jobs: Pick<Jobs, "enqueue">,
  input: CreateRoomInput,
): Promise<RoomDetail> {
  const e = auditRoomTexts.errors;
  const expiresAt = endOfDayIn(input.expiresOn, await companyZone(ctx.db));
  const now = Date.now();
  if (expiresAt.getTime() <= now) throw new AppError("BAD_REQUEST", { message: e.pastDate });
  // Up to 30 days (counted to the end of the last day).
  if (expiresAt.getTime() > now + (MAX_ROOM_DAYS + 1) * 86_400_000) {
    throw new AppError("BAD_REQUEST", { message: e.maxDays });
  }
  const row = await ctx.db.auditRoom.create({
    data: {
      name: input.name,
      auditorEmail: input.auditorEmail,
      expiresAt,
      allowDownload: input.allowDownload,
      createdById: ctx.tenant.membershipId,
    },
  });
  await auditAdmin(ctx, {
    action: "audit-room.create",
    entityType: "AuditRoom",
    entityId: row.id,
    // The auditor's email is the room's purpose; never the content shared.
    metadata: {
      auditorEmail: input.auditorEmail,
      expiresOn: input.expiresOn,
      allowDownload: input.allowDownload,
    },
  });
  await jobs.enqueue("email-send", { kind: "audit-room-invite", roomId: row.id });
  return await getRoom(ctx, row.id);
}

async function openRoom(ctx: AdminContext, id: string) {
  const row = await loadRoom(ctx, id);
  if (stateOf(row) !== "open") {
    throw new AppError("CONFLICT", { message: auditRoomTexts.errors.closed });
  }
  return row;
}

export async function addRoomItem(
  ctx: AdminContext,
  id: string,
  input: RoomItemInput,
): Promise<RoomDetail> {
  await openRoom(ctx, id);
  const item = await describeItem(ctx, input);
  const created = await ctx.db.auditRoomItem.create({
    data: {
      roomId: id,
      kind: item.kind,
      nodeId: item.nodeId,
      spaceId: item.spaceId,
      report: item.report,
      params: item.params,
      title: item.title,
      addedById: ctx.tenant.membershipId,
    },
  });
  await auditAdmin(ctx, {
    action: "audit-room.item.add",
    entityType: "AuditRoom",
    entityId: id,
    metadata: { itemId: created.id, kind: input.kind },
  });
  return await getRoom(ctx, id);
}

export async function removeRoomItem(
  ctx: AdminContext,
  id: string,
  itemId: string,
): Promise<RoomDetail> {
  await loadRoom(ctx, id);
  const removed = await ctx.db.auditRoomItem.deleteMany({ where: { id: itemId, roomId: id } });
  if (removed.count === 0) throw notFound();
  await auditAdmin(ctx, {
    action: "audit-room.item.remove",
    entityType: "AuditRoom",
    entityId: id,
    metadata: { itemId },
  });
  return await getRoom(ctx, id);
}

/** Closed for good: the auditor's sessions and codes stop working right away. */
export async function revokeRoom(ctx: AdminContext, id: string): Promise<RoomDetail> {
  await openRoom(ctx, id);
  await ctx.db.auditRoom.update({
    where: { id },
    data: { revokedAt: new Date(), revokedById: ctx.tenant.membershipId },
  });
  await ctx.db.auditRoomSession.deleteMany({ where: { roomId: id } });
  await ctx.db.auditRoomCode.deleteMany({ where: { roomId: id } });
  await auditAdmin(ctx, { action: "audit-room.revoke", entityType: "AuditRoom", entityId: id });
  return await getRoom(ctx, id);
}

export async function resendInvite(
  ctx: AdminContext,
  jobs: Pick<Jobs, "enqueue">,
  id: string,
): Promise<void> {
  await openRoom(ctx, id);
  await jobs.enqueue("email-send", { kind: "audit-room-invite", roomId: id });
  await auditAdmin(ctx, { action: "audit-room.resend", entityType: "AuditRoom", entityId: id });
}
