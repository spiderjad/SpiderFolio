// The external auditor (docs/spec/salas-de-auditoria.md): no account and no seat. They ask for a one-time
// code that goes to the room's email, enter with it and get a session for that room only. Everything is
// read through the room's company (forTenant) and only what the room shares, with its creator's access;
// once the room expires or is revoked, nothing works any more. Each entry, view and download is logged.
import { timingSafeEqual } from "node:crypto";
import { forTenant } from "../../db/tenant.ts";
import { auditRoomTexts } from "../../i18n/index.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { companyZone, formatDateTimeIn } from "../../lib/time-zone.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { loadTenantContext } from "../../middleware/tenant.ts";
import { atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import { audit } from "../audit/audit.service.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { AUDIT_CODE_TRIES, AUDITOR_SESSION_HOURS, auditCodeHash } from "./codes.ts";
import { describeItem, inputOf, type ItemRow } from "./room-items.ts";
import { roomItemPdf, type RenderDeps } from "./room-render.ts";

export interface AuditorInfo {
  ip: string | null;
  userAgent: string | null;
}

type Room = NonNullable<Awaited<ReturnType<PrismaClient["auditRoom"]["findUnique"]>>>;

const isOpen = (room: Pick<Room, "revokedAt" | "expiresAt">) =>
  room.revokedAt === null && room.expiresAt > new Date();

const closed = () => new AppError("FORBIDDEN", { message: auditRoomTexts.errors.closed });

/** What the sign-in screen shows: the company and the room's name, and whether it's still open. */
export async function roomCover(
  prisma: PrismaClient,
  roomId: string,
): Promise<{ company: string; name: string; open: boolean; expiresAt: Date }> {
  const room = await prisma.auditRoom.findUnique({
    where: { id: roomId },
    select: {
      name: true,
      expiresAt: true,
      revokedAt: true,
      workspace: { select: { name: true, deletedAt: true } },
    },
  });
  if (room === null || room.workspace.deletedAt !== null) throw notFound();
  return {
    company: room.workspace.name,
    name: room.name,
    open: isOpen(room),
    expiresAt: room.expiresAt,
  };
}

/** Sends a new code to the room's email (the worker creates it). Says nothing about who asks. */
export async function requestCode(
  deps: { prisma: PrismaClient; jobs: Pick<Jobs, "enqueue"> },
  roomId: string,
): Promise<void> {
  const room = await deps.prisma.auditRoom.findUnique({ where: { id: roomId } });
  if (room === null) throw notFound();
  if (!isOpen(room)) throw closed();
  await deps.jobs.enqueue("email-send", { kind: "audit-room-code", roomId });
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The code works once, for 10 minutes and 5 tries; it opens a session for this room only. */
export async function enterWithCode(
  prisma: PrismaClient,
  roomId: string,
  code: string,
  info: AuditorInfo,
): Promise<{ token: string; expiresAt: Date }> {
  const room = await prisma.auditRoom.findUnique({ where: { id: roomId } });
  if (room === null) throw notFound();
  if (!isOpen(room)) throw closed();
  const db = forTenant(prisma, room.workspaceId);
  const e = auditRoomTexts.errors;
  const latest = await db.auditRoomCode.findFirst({
    where: { roomId, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (latest === null || latest.expiresAt <= new Date()) {
    throw new AppError("BAD_REQUEST", { message: e.badCode });
  }
  if (latest.attempts >= AUDIT_CODE_TRIES) {
    throw new AppError("RATE_LIMITED", { message: e.tooManyTries });
  }
  if (!sameHash(latest.codeHash, auditCodeHash(roomId, code))) {
    await db.auditRoomCode.update({
      where: { id: latest.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError("BAD_REQUEST", { message: e.badCode });
  }
  // Once: two tries at the same time, only one gets it.
  const used = await db.auditRoomCode.updateMany({
    where: { id: latest.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count === 0) throw new AppError("BAD_REQUEST", { message: e.badCode });
  const token = randomToken();
  const expiresAt = new Date(
    Math.min(room.expiresAt.getTime(), Date.now() + AUDITOR_SESSION_HOURS * 3_600_000),
  );
  await db.auditRoomSession.create({
    data: { roomId, tokenHash: sha256(token), expiresAt },
  });
  await db.auditRoomAccess.create({
    data: { roomId, action: "enter", ip: info.ip, userAgent: info.userAgent },
  });
  await audit(db, {
    action: "audit-room.enter",
    entityType: "AuditRoom",
    entityId: roomId,
    actorId: null,
    ip: info.ip,
    userAgent: info.userAgent,
    metadata: { auditorEmail: room.auditorEmail },
  });
  // The first time, whoever created it is told (once).
  const first = await db.auditRoom.updateMany({
    where: { id: roomId, firstAccessAt: null },
    data: { firstAccessAt: new Date() },
  });
  if (first.count > 0) {
    await db.notification.create({
      data: {
        membershipId: room.createdById,
        kind: "audit_room_access",
        detail: roomId,
        dedupeKey: `audit-room-access:${roomId}`,
      },
    });
  }
  return { token, expiresAt };
}

export interface AuditorSession {
  room: Room;
  /** The room's creator: everything is read with their access. */
  ctx: AdminContext;
}

/** The session's room, open, and its creator still in the company; otherwise nothing works. */
export async function auditorSession(
  prisma: PrismaClient,
  roomId: string,
  token: string | undefined,
  info: AuditorInfo,
): Promise<AuditorSession> {
  const e = auditRoomTexts.errors;
  if (token === undefined) throw new AppError("UNAUTHENTICATED", { message: e.noSession });
  const session = await prisma.auditRoomSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { room: true },
  });
  if (session?.roomId !== roomId || session.expiresAt <= new Date()) {
    throw new AppError("UNAUTHENTICATED", { message: e.noSession });
  }
  if (!isOpen(session.room)) throw closed();
  const creator = await prisma.membership.findFirst({
    where: {
      id: session.room.createdById,
      workspaceId: session.room.workspaceId,
      status: "ACTIVE",
    },
    select: { userId: true },
  });
  const loaded =
    creator === null
      ? null
      : await loadTenantContext(prisma, { id: session.room.workspaceId }, creator.userId);
  if (loaded === null) throw new AppError("FORBIDDEN", { message: e.creatorGone });
  return {
    room: session.room,
    ctx: {
      db: loaded.db,
      tenant: loaded.tenant,
      actor: { base: loaded.tenant.role.base, capabilities: loaded.tenant.capabilities },
      // Nothing here writes to the company's audit log as the creator: the room logs the auditor.
      info: { actorId: "", ip: info.ip, userAgent: info.userAgent },
    },
  };
}

export async function leaveRoom(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  await prisma.auditRoomSession.deleteMany({ where: { tokenHash: sha256(token) } });
}

export interface AuditorItem {
  id: string;
  kind: "NODE" | "SPACE" | "REPORT";
  title: string;
  /** Inside a shared folder or space: its documents (a page or a file), with their folder. */
  documents: { id: string; name: string; type: string; path: string }[];
  /** The creator lost access to it (or it was trashed): it's listed but can't be opened. */
  unavailable: boolean;
}

const itemRowOf = (row: {
  kind: string;
  nodeId: string | null;
  spaceId: string | null;
  report: string | null;
  params: unknown;
  title: string;
}): ItemRow => ({
  kind: row.kind as ItemRow["kind"],
  nodeId: row.nodeId,
  spaceId: row.spaceId,
  report: row.report as ItemRow["report"],
  params: (row.params ?? {}) as Record<string, string>,
  title: row.title,
});

/** A folder's or a space's documents the creator sees, with their folder path. */
async function documentsIn(
  ctx: AdminContext,
  where: { spaceId: string; rootId: string | null },
): Promise<AuditorItem["documents"]> {
  const nodes = await ctx.db.node.findMany({
    where: { spaceId: where.spaceId, trashedAt: null },
    select: { id: true, name: true, type: true, parentId: true },
    take: 5000,
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inside = (id: string | null): boolean => {
    if (where.rootId === null) return true;
    for (let current = id, depth = 0; current !== null && depth < 64; depth += 1) {
      if (current === where.rootId) return true;
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  };
  const candidates = nodes.filter(
    (node) => (node.type === "PAGE" || node.type === "FILE") && inside(node.parentId),
  );
  const access = await accessFor(ctx, { nodeIds: candidates.map((node) => node.id) });
  const pathOf = (parentId: string | null): string => {
    const names: string[] = [];
    for (let current = parentId, depth = 0; current !== null && depth < 64; depth += 1) {
      if (current === where.rootId) break;
      const node = byId.get(current);
      if (node === undefined) break;
      names.unshift(node.name);
      current = node.parentId;
    }
    return names.join(" › ");
  };
  return candidates
    .filter((node) => atLeast(access.ofNode(node.id), "VIEW"))
    .map((node) => ({ id: node.id, name: node.name, type: node.type, path: pathOf(node.parentId) }))
    .sort((a, b) => `${a.path} ${a.name}`.localeCompare(`${b.path} ${b.name}`, "es"));
}

async function stillShared(ctx: AdminContext, item: ItemRow): Promise<boolean> {
  try {
    await describeItem(ctx, inputOf(item));
    return true;
  } catch {
    return false;
  }
}

/** What the room shares, as the auditor sees it. */
export async function roomItems(session: AuditorSession): Promise<{
  room: { name: string; expiresAt: Date; allowDownload: boolean; auditorEmail: string };
  items: AuditorItem[];
}> {
  const { ctx, room } = session;
  const rows = await ctx.db.auditRoomItem.findMany({
    where: { roomId: room.id },
    orderBy: { createdAt: "asc" },
  });
  const items: AuditorItem[] = [];
  for (const row of rows) {
    const item = itemRowOf(row);
    const available = await stillShared(ctx, item);
    let documents: AuditorItem["documents"] = [];
    if (available && item.kind === "SPACE" && item.spaceId !== null) {
      documents = await documentsIn(ctx, { spaceId: item.spaceId, rootId: null });
    } else if (available && item.kind === "NODE" && item.nodeId !== null) {
      const node = await ctx.db.node.findFirst({
        where: { id: item.nodeId },
        select: { type: true, spaceId: true },
      });
      if (node?.type === "FOLDER") {
        documents = await documentsIn(ctx, { spaceId: node.spaceId, rootId: item.nodeId });
      }
    }
    items.push({
      id: row.id,
      kind: item.kind,
      title: row.title,
      documents,
      unavailable: !available,
    });
  }
  return {
    room: {
      name: room.name,
      expiresAt: room.expiresAt,
      allowDownload: room.allowDownload,
      auditorEmail: room.auditorEmail,
    },
    items,
  };
}

/** One item (or a document inside a shared folder or space) as a PDF with the watermark; logged. */
export async function roomItemFile(
  session: AuditorSession,
  deps: RenderDeps,
  itemId: string,
  options: { nodeId: string | undefined; download: boolean },
  info: AuditorInfo,
): Promise<{ fileName: string; body: Uint8Array }> {
  const { ctx, room } = session;
  if (options.download && !room.allowDownload) {
    throw new AppError("FORBIDDEN", { message: auditRoomTexts.errors.noDownload });
  }
  const row = await ctx.db.auditRoomItem.findFirst({ where: { id: itemId, roomId: room.id } });
  if (row === null) throw notFound();
  const item = itemRowOf(row);
  if (!(await stillShared(ctx, item))) throw notFound();
  let nodeId: string | null = item.nodeId;
  let what = row.title;
  if (options.nodeId !== undefined) {
    // Only a document inside this shared folder or space.
    if (item.kind === "REPORT") throw notFound();
    const listed = (await roomItems(session)).items.find((entry) => entry.id === itemId);
    const document = listed?.documents.find((entry) => entry.id === options.nodeId);
    if (document === undefined) throw notFound();
    nodeId = document.id;
    what = `${row.title} › ${document.path === "" ? "" : `${document.path} › `}${document.name}`;
  } else if (item.kind === "SPACE") {
    throw notFound();
  } else if (item.kind === "NODE") {
    const node = await ctx.db.node.findFirst({
      where: { id: item.nodeId ?? "" },
      select: { type: true },
    });
    if (node?.type === "FOLDER") throw notFound();
  }
  const zone = await companyZone(ctx.db);
  const watermark = auditRoomTexts.watermark(
    room.auditorEmail,
    formatDateTimeIn(new Date(), zone, currentLocale()),
  );
  const body = await roomItemPdf(ctx, deps, item, nodeId, watermark);
  await ctx.db.auditRoomAccess.create({
    data: {
      roomId: room.id,
      action: options.download ? "download" : "view",
      itemId,
      what: what.slice(0, 300),
      ip: info.ip,
      userAgent: info.userAgent,
    },
  });
  return { fileName: `${what.replaceAll(/[\\/:*?"<>|]/gu, " ").slice(0, 120)}.pdf`, body };
}
