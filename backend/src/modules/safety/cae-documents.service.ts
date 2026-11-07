// CAE documents (docs/spec/cae.md, «Documentos»): a file uploaded with the normal flow to the company's
// folder (or its worker's), given for a requirement; then accepted (with its validity) or rejected with
// a reason. The latest accepted one of each (requirement, company, worker) is the current one; the rest
// stay as history. An accepted one with a date sets a `cae.document` expiry for the internal
// responsible person, and resolves the one it replaces.
//
// Only `cae.manage` gives, accepts and rejects; the internal responsible person sees their companies'
// documents. Whoever opens the file still needs access to its folder, like any other file.
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { dayIn, dayMonthsLater, zoneOf } from "../../lib/time-zone.ts";
import { caeTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { CAE_DOCUMENT_EXPIRY } from "./cae-expiry.ts";
import { folderSpaceOf, syncCompanyFolder, syncWorkerFolder } from "./cae-folders.ts";
import { appliesToKind, dayOfDate } from "./cae-status.ts";
import type { CreateDocumentInput, ListDocumentsQuery } from "./cae.schemas.ts";
import { accessOf, loadCompany, loadWorker, type CaeAccess } from "./cae.service.ts";
import { canManageCae, requireCae } from "./safety-access.ts";

export interface CaeDocumentView {
  id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  validUntil: string | null;
  rejectReason: string | null;
  /** A newer one replaced it. */
  superseded: boolean;
  createdAt: Date;
  createdBy: { id: string; name: string };
  reviewed: { at: Date; by: { id: string; name: string } } | null;
  /** The file; name and space null once it's gone to the trash. */
  file: { id: string; name: string | null; spaceId: string | null };
  requirement: { id: string; name: string; scope: "COMPANY" | "WORKER" };
  company: { id: string; name: string };
  worker: { id: string; name: string } | null;
}

const documentSelect = {
  id: true,
  status: true,
  validUntil: true,
  rejectReason: true,
  supersededAt: true,
  createdAt: true,
  createdById: true,
  reviewedAt: true,
  reviewedById: true,
  nodeId: true,
  requirement: { select: { id: true, name: true, scope: true, validityMonths: true } },
  company: { select: { id: true, name: true, responsibleId: true } },
  worker: { select: { id: true, name: true } },
} as const;

type DocumentRecord = Prisma.CaeDocumentGetPayload<{ select: typeof documentSelect }>;

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canManageCae(ctx)) throw forbidden();
}

async function zoneOfCompany(ctx: AdminContext): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return zoneOf(workspace?.settings);
}

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

async function views(ctx: AdminContext, rows: DocumentRecord[]): Promise<CaeDocumentView[]> {
  const people = [
    ...new Set(
      rows.flatMap((row) =>
        row.reviewedById === null ? [row.createdById] : [row.createdById, row.reviewedById],
      ),
    ),
  ];
  const [members, nodes] = await Promise.all([
    people.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: people } },
          select: { id: true, user: { select: { name: true } } },
        }),
    rows.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: [...new Set(rows.map((row) => row.nodeId))] }, trashedAt: null },
          select: { id: true, name: true, spaceId: true },
        }),
  ]);
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  return rows.map((row) => {
    const node = nodeOf.get(row.nodeId);
    return {
      id: row.id,
      status: row.status,
      validUntil: dayOfDate(row.validUntil),
      rejectReason: row.rejectReason,
      superseded: row.supersededAt !== null,
      createdAt: row.createdAt,
      createdBy: { id: row.createdById, name: nameOf.get(row.createdById) ?? "" },
      reviewed:
        row.reviewedAt === null || row.reviewedById === null
          ? null
          : {
              at: row.reviewedAt,
              by: { id: row.reviewedById, name: nameOf.get(row.reviewedById) ?? "" },
            },
      file: { id: row.nodeId, name: node?.name ?? null, spaceId: node?.spaceId ?? null },
      requirement: {
        id: row.requirement.id,
        name: row.requirement.name,
        scope: row.requirement.scope,
      },
      company: { id: row.company.id, name: row.company.name },
      worker: row.worker,
    };
  });
}

/** Which documents the person sees: all with cae.manage; their companies' as the responsible. */
async function visibleDocuments(
  ctx: AdminContext,
  access: CaeAccess,
): Promise<Prisma.CaeDocumentWhereInput> {
  if (access.manage) return {};
  const mine = await ctx.db.caeCompany.count({ where: { responsibleId: ctx.tenant.membershipId } });
  if (mine === 0) throw forbidden();
  return { company: { is: { responsibleId: ctx.tenant.membershipId } } };
}

async function loadDocument(ctx: AdminContext, id: string): Promise<DocumentRecord> {
  const row = await ctx.db.caeDocument.findFirst({ where: { id }, select: documentSelect });
  if (row === null) throw notFound();
  return row;
}

// ─── Where documents go ──────────────────────────────────────────────────────────────────

export interface UploadTarget {
  spaceId: string;
  folderId: string;
}

/** The company's folder (recreated if it's gone), to upload its documents. */
export async function companyUploadTarget(ctx: AdminContext, id: string): Promise<UploadTarget> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const company = await loadCompany(ctx, access, id);
  const folderId = await syncCompanyFolder(ctx, company);
  if (folderId !== company.folderId) {
    await ctx.db.caeCompany.update({ where: { id }, data: { folderId }, select: { id: true } });
  }
  const spaceId = await folderSpaceOf(ctx, folderId);
  if (spaceId === null || folderId === null) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.noFolder });
  }
  return { spaceId, folderId };
}

/** The worker's folder inside the company's, created the first time. */
export async function workerUploadTarget(ctx: AdminContext, id: string): Promise<UploadTarget> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const worker = await loadWorker(ctx, access, id);
  const company = await companyUploadTarget(ctx, worker.companyId);
  const folderId = await syncWorkerFolder(ctx, worker, company.folderId);
  if (folderId === null) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.noFolder });
  }
  if (folderId !== worker.folderId) {
    await ctx.db.caeWorker.update({ where: { id }, data: { folderId }, select: { id: true } });
  }
  return { spaceId: company.spaceId, folderId };
}

/** The node is a live file somewhere inside the company's folder (otherwise 400). */
async function assertFileInFolder(
  ctx: AdminContext,
  nodeId: string,
  folderId: string | null,
): Promise<void> {
  const fail = () => new AppError("BAD_REQUEST", { message: caeTexts.messages.nodeNotInFolder });
  if (folderId === null) throw new AppError("BAD_REQUEST", { message: caeTexts.messages.noFolder });
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, type: "FILE", trashedAt: null },
    select: { parentId: true },
  });
  if (node === null) throw notFound();
  let parentId = node.parentId;
  for (let depth = 0; depth < 64 && parentId !== null; depth += 1) {
    if (parentId === folderId) return;
    const parent = await ctx.db.node.findFirst({
      where: { id: parentId, trashedAt: null },
      select: { parentId: true },
    });
    if (parent === null) throw fail();
    parentId = parent.parentId;
  }
  throw fail();
}

// ─── Giving, accepting, rejecting ────────────────────────────────────────────────────────

export async function createDocument(
  ctx: AdminContext,
  input: CreateDocumentInput,
): Promise<CaeDocumentView> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const m = caeTexts.messages;
  const company = await loadCompany(ctx, access, input.companyId);
  if (company.archivedAt !== null) throw new AppError("CONFLICT", { message: m.archived });
  const requirement = await ctx.db.caeRequirement.findFirst({
    where: { id: input.requirementId },
    select: { id: true, scope: true, appliesTo: true, validityMonths: true, archivedAt: true },
  });
  if (requirement === null) throw notFound();
  if (requirement.archivedAt !== null) {
    throw new AppError("BAD_REQUEST", { message: m.requirementArchived });
  }
  if (!appliesToKind(requirement.appliesTo, company.kind)) {
    throw new AppError("BAD_REQUEST", { message: m.requirementNotApplicable });
  }
  const workerId = input.workerId ?? null;
  if ((requirement.scope === "WORKER") !== (workerId !== null)) {
    throw new AppError("BAD_REQUEST", { message: m.requirementScope });
  }
  if (workerId !== null) {
    const worker = await loadWorker(ctx, access, workerId);
    if (worker.companyId !== company.id) {
      throw new AppError("BAD_REQUEST", { message: m.workerNotInCompany });
    }
    if (worker.archivedAt !== null) {
      throw new AppError("CONFLICT", { message: m.workerArchived });
    }
  }
  await assertFileInFolder(ctx, input.nodeId, company.folderId);
  // The proposed validity: today plus the requirement's months.
  const validUntil =
    input.validUntil !== undefined
      ? input.validUntil
      : requirement.validityMonths === null
        ? null
        : await (async () => {
            const zone = await zoneOfCompany(ctx);
            return dayIn(dayMonthsLater(new Date(), requirement.validityMonths ?? 0, zone), zone);
          })();
  const created = await ctx.db.caeDocument.create({
    data: {
      requirementId: requirement.id,
      companyId: company.id,
      workerId,
      nodeId: input.nodeId,
      validUntil: validUntil === null ? null : dateOf(validUntil),
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.document.upload",
    entityType: "CaeDocument",
    entityId: created.id,
    metadata: {
      requirementId: requirement.id,
      companyId: company.id,
      ...(workerId === null ? {} : { workerId }),
      nodeId: input.nodeId,
    },
  });
  if (input.accept) return await acceptDocument(ctx, created.id, {});
  const [view] = await views(ctx, [await loadDocument(ctx, created.id)]);
  if (view === undefined) throw notFound();
  return view;
}

function assertPending(row: { status: string }): void {
  if (row.status !== "PENDING") {
    throw new AppError("CONFLICT", { message: caeTexts.messages.notPending });
  }
}

/** Accepts it as the current one; the previous current one becomes history. */
export async function acceptDocument(
  ctx: AdminContext,
  id: string,
  input: { validUntil?: string | null | undefined },
): Promise<CaeDocumentView> {
  await requireManager(ctx);
  const row = await loadDocument(ctx, id);
  assertPending(row);
  const validUntil = input.validUntil === undefined ? dayOfDate(row.validUntil) : input.validUntil;
  const now = new Date();
  await ctx.db.$transaction(async (tx) => {
    const previous = await tx.caeDocument.findMany({
      where: {
        requirementId: row.requirement.id,
        companyId: row.company.id,
        workerId: row.worker?.id ?? null,
        status: "ACCEPTED",
        supersededAt: null,
        NOT: { id },
      },
      select: { id: true },
    });
    if (previous.length > 0) {
      await tx.caeDocument.updateMany({
        where: { id: { in: previous.map((doc) => doc.id) } },
        data: { supersededAt: now },
      });
      for (const doc of previous) await resolveExpiry(tx, CAE_DOCUMENT_EXPIRY, doc.id);
    }
    await tx.caeDocument.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        reviewedAt: now,
        reviewedById: ctx.tenant.membershipId,
        validUntil: validUntil === null ? null : dateOf(validUntil),
      },
      select: { id: true },
    });
    if (validUntil !== null) {
      await setExpiry(tx, {
        kind: CAE_DOCUMENT_EXPIRY,
        subjectId: id,
        dueOn: validUntil,
        responsibleId: row.company.responsibleId,
        setById: ctx.tenant.membershipId,
      });
    }
  });
  await auditAdmin(ctx, {
    action: "cae.document.accept",
    entityType: "CaeDocument",
    entityId: id,
    metadata: {
      requirementId: row.requirement.id,
      companyId: row.company.id,
      ...(row.worker === null ? {} : { workerId: row.worker.id }),
      validUntil,
    },
  });
  const [view] = await views(ctx, [await loadDocument(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

export async function rejectDocument(
  ctx: AdminContext,
  id: string,
  reason: string,
): Promise<CaeDocumentView> {
  await requireManager(ctx);
  const row = await loadDocument(ctx, id);
  assertPending(row);
  await ctx.db.caeDocument.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedAt: new Date(),
      reviewedById: ctx.tenant.membershipId,
      rejectReason: reason,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.document.reject",
    entityType: "CaeDocument",
    entityId: id,
    metadata: {
      requirementId: row.requirement.id,
      companyId: row.company.id,
      ...(row.worker === null ? {} : { workerId: row.worker.id }),
      reason,
    },
  });
  const [view] = await views(ctx, [await loadDocument(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

// ─── Lists ───────────────────────────────────────────────────────────────────────────────

const statusOf = { pending: "PENDING", accepted: "ACCEPTED", rejected: "REJECTED" } as const;

/**
 * «Por revisar» (status=pending, oldest first) and each requirement's history (with the company or
 * the worker, newest first).
 */
export async function listDocuments(
  ctx: AdminContext,
  query: ListDocumentsQuery,
): Promise<Page<CaeDocumentView>> {
  const access = await accessOf(ctx);
  const where: Prisma.CaeDocumentWhereInput = {
    AND: [
      await visibleDocuments(ctx, access),
      query.status === undefined ? {} : { status: statusOf[query.status] },
      query.requirementId === undefined ? {} : { requirementId: query.requirementId },
      query.workerId !== undefined
        ? { workerId: query.workerId }
        : query.companyId !== undefined
          ? { companyId: query.companyId, workerId: null }
          : {},
    ],
  };
  const dir = query.status === "pending" ? "asc" : "desc";
  const [rows, total] = await Promise.all([
    ctx.db.caeDocument.findMany({
      where,
      select: documentSelect,
      orderBy: [{ createdAt: dir }, { id: dir }],
      ...offsetArgs(query),
    }),
    ctx.db.caeDocument.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}
