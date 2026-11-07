// The contractor's portal (docs/spec/cae.md, «Portal de contratas»): a person of an external company,
// with no account, enters with the link and the code the host gave them and gets a short session for
// that access only. They see and do only what concerns ITS company: its data, requirements and
// workers, the site information it has to read and its work permits; they upload documents (PENDING,
// in its folder) and add or change its workers.
//
// Security (mirrors the audit rooms' auditor):
// - The code is only kept as a hash bound to the access; wrong codes count per access and lock it;
//   every failure answers the same generic error (nothing tells whether the access or company exists).
// - The session is a random token in an httpOnly cookie scoped to the access's path; only its hash is
//   kept. It's created after the code (a token sent before is ignored: no fixation), replaced every
//   few minutes of use and ended at logout.
// - Each request re-checks everything: session, access (not revoked, expired or locked), company (not
//   archived), CAE and the module on, and whoever issued the access still active with cae.manage.
// - Everything is read and written through the company's tenant (forTenant) with the issuer's context
//   and always for the session's company: no id from the request reaches another company or tenant.
// - What it creates is attributed to the portal: audited with no actor and `via: cae-portal`, and the
//   documents carry portalAccessId (their createdById is the issuer, who answers for the access).
import { caeLimits } from "@spiderfolio/limits";
import { forTenant, type TenantDb } from "../../db/tenant.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { cleanName } from "../../lib/names.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Storage } from "../../lib/storage.ts";
import { caeTexts } from "../../i18n/index.ts";
import { loadTenantContext } from "../../middleware/tenant.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { audit } from "../audit/audit.service.ts";
import { downloadControlledPdf } from "../documents/pdf.service.ts";
import { completeUpload, startUpload, type DestinationCheck } from "../files/files.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { companyUploadTarget, giveDocument, workerUploadTarget } from "./cae-documents.service.ts";
import { currentInfoDocuments, infoKey, missingInfo } from "./cae-info-docs.ts";
import { permitState } from "./cae-permits.service.ts";
import { portalCodeHash, samePortalHash } from "./cae-portal-codes.ts";
import { appliesToKind, companyStatusOf, dayOfDate, workerStatuses } from "./cae-status.ts";
import type { CreateWorkerInput, UpdateWorkerInput } from "./cae.schemas.ts";
import { caeEnabled, readSafetySettings } from "../workspaces/settings.ts";

export interface PortalInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface PortalSession {
  accessId: string;
  companyId: string;
  companyName: string;
  /** The issuer's context: every read and write goes through the company's tenant. */
  ctx: AdminContext;
  db: TenantDb;
  /** A replacement token when the session was rotated (the router sets the cookie). */
  rotated: { token: string; expiresAt: Date } | null;
  info: PortalInfo;
}

/** The one answer for any problem with the link, the code or the session. */
const invalid = () => new AppError("BAD_REQUEST", { message: caeTexts.portal.invalid });
const noSession = () => new AppError("UNAUTHENTICATED", { message: caeTexts.portal.noSession });

const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png"]);

type AccessRow = NonNullable<Awaited<ReturnType<PrismaClient["caePortalAccess"]["findUnique"]>>>;

/** Whether an access is usable right now: not revoked, expired or locked; company, CAE and issuer ok. */
async function usable(
  prisma: PrismaClient,
  access: AccessRow,
): Promise<{ ctx: AdminContext; company: { id: string; name: string } } | null> {
  if (access.revokedAt !== null || access.expiresAt <= new Date()) return null;
  if (access.failedAttempts >= caeLimits.portalMaxFailedAttempts) return null;
  const workspace = await prisma.workspace.findUnique({
    where: { id: access.workspaceId },
    select: { settings: true, deletedAt: true },
  });
  if (workspace === null || workspace.deletedAt !== null) return null;
  if (!caeEnabled(readSafetySettings(workspace.settings))) return null;
  const db = forTenant(prisma, access.workspaceId);
  const company = await db.caeCompany.findFirst({
    where: { id: access.companyId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (company === null) return null;
  const issuer = await prisma.membership.findFirst({
    where: { id: access.createdById, workspaceId: access.workspaceId, status: "ACTIVE" },
    select: { userId: true },
  });
  if (issuer === null) return null;
  const loaded = await loadTenantContext(prisma, { id: access.workspaceId }, issuer.userId);
  if (loaded?.tenant.capabilities.includes("cae.manage") !== true) return null;
  return {
    company,
    ctx: {
      db: loaded.db,
      tenant: loaded.tenant,
      actor: { base: loaded.tenant.role.base, capabilities: loaded.tenant.capabilities },
      // No member acts here: the log says «the contractor's portal».
      info: {
        actorId: "",
        ip: null,
        userAgent: null,
        via: { via: "cae-portal", client: company.name },
      },
    },
  };
}

async function portalAudit(
  db: TenantDb,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    accessId: string;
    company: string;
    info: PortalInfo;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await audit(db, {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorId: null,
    ip: entry.info.ip,
    userAgent: entry.info.userAgent,
    metadata: {
      ...(entry.metadata ?? {}),
      portalAccessId: entry.accessId,
      via: "cae-portal",
      client: entry.company,
    },
  });
}

/**
 * Enters with the code. Any problem (no such access, revoked, expired, locked, the company archived,
 * CAE off, the issuer gone, or the wrong code) answers the same.
 */
export async function enterPortal(
  prisma: PrismaClient,
  accessId: string,
  code: string,
  info: PortalInfo,
): Promise<{ token: string; expiresAt: Date }> {
  const access = await prisma.caePortalAccess.findUnique({ where: { id: accessId } });
  if (access === null) {
    // The same work as a real check, so the time doesn't tell either.
    samePortalHash(portalCodeHash(accessId, code), sha256("-"));
    throw invalid();
  }
  const db = forTenant(prisma, access.workspaceId);
  const open = await usable(prisma, access);
  const right = samePortalHash(access.codeHash, portalCodeHash(access.id, code));
  if (open === null || !right) {
    if (open !== null) {
      await db.caePortalAccess.updateMany({
        where: { id: access.id },
        data: { failedAttempts: { increment: 1 } },
      });
    }
    // Never the code typed.
    await portalAudit(db, {
      action: "cae.portal.login.failure",
      entityType: "CaeCompany",
      entityId: access.companyId,
      accessId: access.id,
      company: open?.company.name ?? "",
      info,
      metadata: { reason: open === null ? "closed" : "code" },
    });
    throw invalid();
  }
  const token = randomToken();
  const expiresAt = new Date(
    Math.min(access.expiresAt.getTime(), Date.now() + caeLimits.portalSessionHours * 3_600_000),
  );
  await db.caePortalSession.create({
    data: { accessId: access.id, tokenHash: sha256(token), expiresAt },
    select: { id: true },
  });
  await db.caePortalAccess.update({
    where: { id: access.id },
    data: { failedAttempts: 0, lastUsedAt: new Date() },
    select: { id: true },
  });
  await portalAudit(db, {
    action: "cae.portal.login",
    entityType: "CaeCompany",
    entityId: access.companyId,
    accessId: access.id,
    company: open.company.name,
    info,
  });
  return { token, expiresAt };
}

/** The session's access and company, all re-checked; otherwise nothing works. */
export async function portalSession(
  prisma: PrismaClient,
  accessId: string,
  token: string | undefined,
  info: PortalInfo,
): Promise<PortalSession> {
  if (token === undefined) throw noSession();
  const session = await prisma.caePortalSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { access: true },
  });
  const now = new Date();
  if (session?.accessId !== accessId || session.endedAt !== null || session.expiresAt <= now) {
    throw noSession();
  }
  const open = await usable(prisma, session.access);
  if (open === null) throw noSession();
  const db = forTenant(prisma, session.workspaceId);
  // A new token every few minutes of use; the old one still works for a minute (requests in flight).
  let rotated: PortalSession["rotated"] = null;
  if (now.getTime() - session.createdAt.getTime() > caeLimits.portalRotateMinutes * 60_000) {
    const next = randomToken();
    await db.caePortalSession.create({
      data: { accessId, tokenHash: sha256(next), expiresAt: session.expiresAt },
      select: { id: true },
    });
    await db.caePortalSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Math.min(session.expiresAt.getTime(), now.getTime() + 60_000)) },
      select: { id: true },
    });
    rotated = { token: next, expiresAt: session.expiresAt };
  }
  return {
    accessId,
    companyId: open.company.id,
    companyName: open.company.name,
    ctx: { ...open.ctx, info: { ...open.ctx.info, ip: info.ip, userAgent: info.userAgent } },
    db,
    rotated,
    info,
  };
}

/** Ends the session (kept, never deleted). */
export async function leavePortal(prisma: PrismaClient, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  await prisma.caePortalSession.updateMany({
    where: { tokenHash: sha256(token), endedAt: null },
    data: { endedAt: new Date() },
  });
}

// ─── What the contractor sees ────────────────────────────────────────────────────────────

export interface PortalRequirement {
  id: string;
  name: string;
  required: boolean;
  validityMonths: number | null;
  state: string;
  validUntil: string | null;
  /** The newest document if it's waiting for review or was rejected (with why). */
  latest: { status: string; rejectReason: string | null; createdAt: Date } | null;
}

const portalRequirements = (
  items: Awaited<ReturnType<typeof companyStatusOf>>["requirements"],
): PortalRequirement[] =>
  items.map((item) => ({
    id: item.requirement.id,
    name: item.requirement.name,
    required: item.requirement.required,
    validityMonths: item.requirement.validityMonths,
    state: item.state,
    validUntil: item.validUntil,
    latest:
      item.latest === null
        ? null
        : {
            status: item.latest.status,
            rejectReason: item.latest.rejectReason,
            createdAt: item.latest.createdAt,
          },
  }));

/** The company: its name, type, status with its reasons, its requirements and the site information. */
export async function portalOverview(s: PortalSession) {
  const company = await s.db.caeCompany.findFirst({
    where: { id: s.companyId },
    select: {
      id: true,
      name: true,
      kind: true,
      parentId: true,
      responsibleId: true,
      blockedAt: true,
      blockedReason: true,
      archivedAt: true,
      startsOn: true,
      endsOn: true,
    },
  });
  if (company === null) throw noSession();
  const [status, responsible, access, workspace] = await Promise.all([
    companyStatusOf(s.ctx, company),
    s.db.membership.findFirst({
      where: { id: company.responsibleId },
      select: { user: { select: { name: true } } },
    }),
    s.db.caePortalAccess.findFirst({ where: { id: s.accessId }, select: { expiresAt: true } }),
    s.db.workspace.findFirst({ where: {}, select: { name: true, settings: true } }),
  ]);
  const settings = readSafetySettings(workspace?.settings);
  const info = await currentInfoDocuments(s.ctx, settings.cae.infoNodeIds);
  const missing = new Set(
    ((await missingInfo(s.ctx, [company.id], info)).get(company.id) ?? []).map(infoKey),
  );
  return {
    host: workspace?.name ?? "",
    terms: settings.terms,
    company: {
      name: company.name,
      kind: company.kind,
      startsOn: dayOfDate(company.startsOn),
      endsOn: dayOfDate(company.endsOn),
      // Only a display name: none of the host's contact details.
      responsible: responsible?.user.name ?? null,
      authorized: status.authorized,
      state: status.state,
      reasons: status.reasons,
    },
    requirements: portalRequirements(status.requirements),
    info: info.map((doc) => ({ ...doc, delivered: !missing.has(infoKey(doc)) })),
    accessExpiresAt: access?.expiresAt ?? null,
  };
}

const workerSelect = {
  id: true,
  companyId: true,
  name: true,
  idNumber: true,
  task: true,
  blockedAt: true,
  blockedReason: true,
  archivedAt: true,
} as const;

/** Its workers (active by default), with each one's status. */
export async function portalWorkers(
  s: PortalSession,
  query: { page: number; pageSize: number; cursor?: string | undefined; archived: boolean },
) {
  const where = { companyId: s.companyId, archivedAt: query.archived ? { not: null } : null };
  const [rows, total] = await Promise.all([
    s.db.caeWorker.findMany({
      where,
      select: workerSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    s.db.caeWorker.count({ where }),
  ]);
  const statuses = await workerStatuses(s.ctx, rows);
  return pageOf(
    rows.map((row) => {
      const status = statuses.get(row.id);
      return {
        id: row.id,
        name: row.name,
        idNumber: row.idNumber,
        task: row.task,
        archived: row.archivedAt !== null,
        authorized: status?.authorized ?? false,
        reasons: status?.reasons ?? [],
        requirements: portalRequirements(status?.requirements ?? []),
      };
    }),
    total,
    query,
  );
}

/** One of ITS workers (otherwise 404). */
async function ownWorker(s: PortalSession, workerId: string) {
  const row = await s.db.caeWorker.findFirst({
    where: { id: workerId, companyId: s.companyId },
    select: workerSelect,
  });
  if (row === null) throw notFound();
  return row;
}

export async function portalCreateWorker(s: PortalSession, input: CreateWorkerInput) {
  const row = await s.db.caeWorker.create({
    data: {
      companyId: s.companyId,
      name: cleanName(input.name),
      idNumber: input.idNumber ?? null,
      task: input.task ?? null,
    },
    select: { id: true, name: true },
  });
  await portalAudit(s.db, {
    action: "cae.portal.worker.create",
    entityType: "CaeWorker",
    entityId: row.id,
    accessId: s.accessId,
    company: s.companyName,
    info: s.info,
    metadata: { name: row.name, companyId: s.companyId },
  });
  return { id: row.id };
}

export async function portalUpdateWorker(
  s: PortalSession,
  workerId: string,
  input: UpdateWorkerInput,
) {
  const current = await ownWorker(s, workerId);
  if (current.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.workerArchived });
  }
  await s.db.caeWorker.update({
    where: { id: current.id },
    data: {
      ...(input.name === undefined ? {} : { name: cleanName(input.name) }),
      ...(input.idNumber === undefined ? {} : { idNumber: input.idNumber }),
      ...(input.task === undefined ? {} : { task: input.task }),
    },
    select: { id: true },
  });
  await portalAudit(s.db, {
    action: "cae.portal.worker.update",
    entityType: "CaeWorker",
    entityId: current.id,
    accessId: s.accessId,
    company: s.companyName,
    info: s.info,
    metadata: { companyId: s.companyId, changed: Object.keys(input).join(",") },
  });
}

export async function portalArchiveWorker(s: PortalSession, workerId: string) {
  const current = await ownWorker(s, workerId);
  if (current.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.alreadyArchived });
  }
  await s.db.caeWorker.update({
    where: { id: current.id },
    data: { archivedAt: new Date() },
    select: { id: true },
  });
  await portalAudit(s.db, {
    action: "cae.portal.worker.archive",
    entityType: "CaeWorker",
    entityId: current.id,
    accessId: s.accessId,
    company: s.companyName,
    info: s.info,
    metadata: { name: current.name, companyId: s.companyId },
  });
}

/** Its work permits, read only: no names of the host's staff. */
export async function portalPermits(
  s: PortalSession,
  query: { page: number; pageSize: number; cursor?: string | undefined },
) {
  const where = { companyId: s.companyId, status: { not: "DRAFT" as const } };
  const [rows, total] = await Promise.all([
    s.db.caeWorkPermit.findMany({
      where,
      select: {
        id: true,
        type: true,
        customName: true,
        location: true,
        description: true,
        validFrom: true,
        validTo: true,
        status: true,
        workerIds: true,
        membershipIds: true,
        precautions: true,
        closeNote: true,
      },
      orderBy: [{ validFrom: "desc" }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    s.db.caeWorkPermit.count({ where }),
  ]);
  const workerIds = [...new Set(rows.flatMap((row) => row.workerIds))];
  const workers =
    workerIds.length === 0
      ? []
      : await s.db.caeWorker.findMany({
          where: { id: { in: workerIds }, companyId: s.companyId },
          select: { id: true, name: true },
        });
  const nameOf = new Map(workers.map((worker) => [worker.id, worker.name]));
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      customName: row.customName,
      location: row.location,
      description: row.description,
      validFrom: row.validFrom,
      validTo: row.validTo,
      state: permitState(row),
      workers: row.workerIds.flatMap((id) => {
        const name = nameOf.get(id);
        return name === undefined ? [] : [{ id, name }];
      }),
      ownStaff: row.membershipIds.length,
      precautions: (Array.isArray(row.precautions) ? row.precautions : []).flatMap((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const { label, done } = item as Record<string, unknown>;
        return typeof label === "string" && typeof done === "boolean" ? [{ label, done }] : [];
      }),
    })),
    total,
    query,
  );
}

/** One of the site information documents, as its controlled PDF (only those chosen for contractors). */
export async function portalInfoFile(
  s: PortalSession,
  deps: { storage: Storage; gotenbergUrl: string | undefined },
  nodeId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const info = await currentInfoDocuments(s.ctx);
  if (!info.some((doc) => doc.nodeId === nodeId)) throw notFound();
  const file = await downloadControlledPdf(s.ctx, deps, nodeId, undefined);
  await portalAudit(s.db, {
    action: "cae.portal.info.view",
    entityType: "Node",
    entityId: nodeId,
    accessId: s.accessId,
    company: s.companyName,
    info: s.info,
  });
  return file;
}

// ─── Uploads ─────────────────────────────────────────────────────────────────────────────

/**
 * The portal writes as the system into the company's (or worker's) CAE folder, like cae-folders.ts
 * creates the folders: it doesn't need the issuer to edit the module's space, and it can't go anywhere
 * else. Only that exact folder, alive, in a space that takes changes; the rest of the upload (size,
 * quota and limits, the real type by its bytes) is the normal one.
 */
const intoCaeFolder =
  (folderId: string): DestinationCheck =>
  async (ctx, spaceId, parentId) => {
    await assertSpaceWritable(ctx, spaceId);
    if (parentId !== folderId) throw notFound();
    const folder = await ctx.db.node.findFirst({
      where: { id: folderId, spaceId, type: "FOLDER", trashedAt: null },
      select: { id: true },
    });
    if (folder === null) throw notFound();
  };

/** Where an upload of the session's company goes: its folder, or the worker's inside it. */
async function uploadTarget(s: PortalSession, workerId: string | null) {
  return workerId === null
    ? await companyUploadTarget(s.ctx, s.companyId)
    : await workerUploadTarget(s.ctx, workerId);
}

/**
 * Starts an upload for one of its requirements (the company's or one of its workers'): the file goes to
 * its folder with the normal flow (presigned PUT, then the same checks on completion: real type by its
 * bytes, size and the company's limits). Only PDF, JPG or PNG, up to caeLimits.portalMaxFileMb.
 */
export async function portalStartUpload(
  s: PortalSession,
  deps: { storage: Storage; jobs?: Pick<Jobs, "enqueue"> },
  input: { requirementId: string; workerId: string | null; name: string; size: number },
): Promise<{ id: string; url: string; contentType: string }> {
  const p = caeTexts.portal;
  const extension = input.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension))
    throw new AppError("BAD_REQUEST", { message: p.fileType });
  if (input.size > caeLimits.portalMaxFileMb * 1024 * 1024) {
    throw new AppError("BAD_REQUEST", { message: p.fileTooLarge(caeLimits.portalMaxFileMb) });
  }
  const company = await s.db.caeCompany.findFirst({
    where: { id: s.companyId },
    select: { kind: true },
  });
  const requirement = await s.db.caeRequirement.findFirst({
    where: { id: input.requirementId, archivedAt: null },
    select: { id: true, scope: true, appliesTo: true },
  });
  if (
    company === null ||
    requirement === null ||
    !appliesToKind(requirement.appliesTo, company.kind)
  ) {
    throw notFound();
  }
  if ((requirement.scope === "WORKER") !== (input.workerId !== null)) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.requirementScope });
  }
  if (input.workerId !== null) {
    const worker = await ownWorker(s, input.workerId);
    if (worker.archivedAt !== null) {
      throw new AppError("CONFLICT", { message: caeTexts.messages.workerArchived });
    }
  }
  const target = await uploadTarget(s, input.workerId);
  const ticket = await startUpload(
    s.ctx,
    deps,
    target.spaceId,
    {
      parentId: target.folderId,
      name: input.name,
      size: input.size,
      onConflict: "keep_both",
    },
    intoCaeFolder(target.folderId),
  );
  if (ticket.url === null)
    throw new AppError("BAD_REQUEST", { message: p.fileTooLarge(caeLimits.portalMaxFileMb) });
  // The upload belongs to this access and this requirement: nothing else can complete it.
  await s.db.caePortalUpload.create({
    data: {
      id: ticket.id,
      accessId: s.accessId,
      requirementId: requirement.id,
      workerId: input.workerId,
    },
    select: { id: true },
  });
  return { id: ticket.id, url: ticket.url, contentType: ticket.contentType };
}

/** Completes it (same checks as any upload) and gives it as PENDING; the responsible is told. */
export async function portalCompleteUpload(
  s: PortalSession,
  deps: { storage: Storage; jobs?: Pick<Jobs, "enqueue"> },
  uploadId: string,
  validUntil: string | null,
): Promise<{ documentId: string }> {
  const pending = await s.db.caePortalUpload.findFirst({
    where: { id: uploadId, accessId: s.accessId, completedAt: null },
    select: { id: true, requirementId: true, workerId: true },
  });
  if (pending === null) throw new AppError("BAD_REQUEST", { message: caeTexts.portal.uploadGone });
  if (pending.workerId !== null) await ownWorker(s, pending.workerId);
  const target = await uploadTarget(s, pending.workerId);
  const uploaded = await completeUpload(s.ctx, deps, uploadId, intoCaeFolder(target.folderId));
  await s.db.caePortalUpload.updateMany({
    where: { id: uploadId, completedAt: null },
    data: { completedAt: new Date() },
  });
  const documentId = await giveDocument(
    s.ctx,
    {
      requirementId: pending.requirementId,
      companyId: s.companyId,
      workerId: pending.workerId,
      nodeId: uploaded.node.id,
      validUntil,
    },
    s.accessId,
  );
  // The internal responsible is told in the app (one notice per company until it's read).
  const company = await s.db.caeCompany.findFirst({
    where: { id: s.companyId },
    select: { responsibleId: true },
  });
  if (company !== null) {
    await s.db.notification.create({
      data: { membershipId: company.responsibleId, kind: "cae_portal_upload", detail: s.companyId },
      select: { id: true },
    });
  }
  return { documentId };
}

export type PortalPage<T> = Page<T>;
