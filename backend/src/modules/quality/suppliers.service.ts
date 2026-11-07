// Suppliers (docs/spec/calidad.md, «Fase 4»): the register with what each one supplies, its risk and
// fraud vulnerability; its certificates and technical sheets with their expiry; its yearly review, which
// sets its status and the next review; and its nonconformities. quality.manage handles them, quality.view
// reads them, and whoever follows a supplier sees it and loads its documents.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { ensureFolder, liveFolder } from "./quality-folders.ts";
import { SUPPLIER_DOC_EXPIRY, SUPPLIER_REVIEW_EXPIRY } from "./quality-expiry.ts";
import type {
  ReviewInput,
  SupplierDocInput,
  SupplierInput,
  SuppliersQuery,
  UpdateSupplierInput,
} from "./suppliers.schemas.ts";

const DUE_SOON_DAYS = 30;
const DOC_NOTICE_DAYS = [30, 7, 0] as const;
const REVIEW_NOTICE_DAYS = [30, 7, 0] as const;

type DocState = "valid" | "due_soon" | "expired" | "no_expiry";
const STATE_RANK: Record<DocState, number> = { expired: 0, due_soon: 1, valid: 2, no_expiry: 3 };
const CERTS = ["CERT_IFS", "CERT_BRCGS", "CERT_OTHER"] as const;

interface Person {
  id: string;
  name: string;
}

export interface SupplierDocView {
  id: string;
  kind: string;
  name: string;
  file: { id: string; name: string; spaceId: string; parentId: string | null } | null;
  validUntil: string | null;
  state: DocState;
  archived: boolean;
}

export interface SupplierView {
  id: string;
  name: string;
  taxId: string | null;
  category: string;
  supplies: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  fraudRisk: "LOW" | "MEDIUM" | "HIGH";
  fraudNote: string | null;
  contact: string | null;
  owner: Person | null;
  status: "PENDING" | "APPROVED" | "CONDITIONAL" | "BLOCKED";
  nextReviewOn: string | null;
  reviewDue: boolean;
  archived: boolean;
  /** The worst state of its certificates; null without any. */
  certificates: DocState | null;
  access: "manage" | "owner" | "read";
}

export interface SupplierDetail extends SupplierView {
  docs: SupplierDocView[];
  reviews: {
    id: string;
    reviewedOn: string;
    scores: Record<string, number>;
    result: string;
    note: string;
    by: Person;
  }[];
  ncs: { id: string; code: string; title: string; status: string; severity: string }[];
  folder: { id: string; spaceId: string } | null;
}

const supplierSelect = {
  id: true,
  name: true,
  taxId: true,
  category: true,
  supplies: true,
  risk: true,
  fraudRisk: true,
  fraudNote: true,
  contact: true,
  ownerId: true,
  status: true,
  nextReviewOn: true,
  folderId: true,
  archivedAt: true,
  createdById: true,
} as const;

type SupplierRow = Prisma.QualitySupplierGetPayload<{ select: typeof supplierSelect }>;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

function addMonths(day: string, months: number): string {
  const date = dateOf(day);
  date.setUTCMonth(date.getUTCMonth() + months);
  return dayOf(date);
}

async function today(db: TenantDb): Promise<string> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

function stateOf(validUntil: Date | null, day: string): DocState {
  if (validUntil === null) return "no_expiry";
  const until = dayOf(validUntil);
  if (until < day) return "expired";
  const soon = dateOf(day);
  soon.setUTCDate(soon.getUTCDate() + DUE_SOON_DAYS);
  return until <= dayOf(soon) ? "due_soon" : "valid";
}

function accessOf(ctx: AdminContext, row: { ownerId: string | null }): SupplierView["access"] {
  if (canManageQuality(ctx)) return "manage";
  if (row.ownerId === ctx.tenant.membershipId) return "owner";
  return "read";
}

/** Beyond quality.view, only the suppliers the person follows. */
function visibleWhere(ctx: AdminContext): Prisma.QualitySupplierWhereInput {
  return canViewQuality(ctx) ? {} : { ownerId: ctx.tenant.membershipId };
}

async function views(ctx: AdminContext, rows: SupplierRow[]): Promise<SupplierView[]> {
  if (rows.length === 0) return [];
  const day = await today(ctx.db);
  const ownerIds = [
    ...new Set(rows.map((row) => row.ownerId).filter((id): id is string => id !== null)),
  ];
  const [people, certs] = await Promise.all([
    ownerIds.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, user: { select: { name: true } } },
        }),
    ctx.db.qualitySupplierDoc.findMany({
      where: {
        supplierId: { in: rows.map((row) => row.id) },
        archivedAt: null,
        kind: { in: [...CERTS] },
      },
      select: { supplierId: true, validUntil: true },
    }),
  ]);
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  return rows.map((row) => {
    const states = certs
      .filter((doc) => doc.supplierId === row.id)
      .map((doc) => stateOf(doc.validUntil, day));
    const worst =
      states.length === 0
        ? null
        : states.reduce((a, b) => (STATE_RANK[a] <= STATE_RANK[b] ? a : b));
    return {
      id: row.id,
      name: row.name,
      taxId: row.taxId,
      category: row.category,
      supplies: row.supplies,
      risk: row.risk,
      fraudRisk: row.fraudRisk,
      fraudNote: row.fraudNote,
      contact: row.contact,
      owner: row.ownerId === null ? null : { id: row.ownerId, name: nameOf.get(row.ownerId) ?? "" },
      status: row.status,
      nextReviewOn: row.nextReviewOn === null ? null : dayOf(row.nextReviewOn),
      reviewDue: row.nextReviewOn !== null && dayOf(row.nextReviewOn) <= day,
      archived: row.archivedAt !== null,
      certificates: worst,
      access: accessOf(ctx, row),
    };
  });
}

async function loadSupplier(ctx: AdminContext, id: string): Promise<SupplierRow> {
  await requireQuality(ctx);
  const row = await ctx.db.qualitySupplier.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx)] },
    select: supplierSelect,
  });
  if (row === null) throw notFound();
  return row;
}

export async function getSupplier(ctx: AdminContext, id: string): Promise<SupplierDetail> {
  const row = await loadSupplier(ctx, id);
  const [view] = await views(ctx, [row]);
  if (view === undefined) throw notFound();
  const day = await today(ctx.db);
  const [docs, reviews, ncs, folder] = await Promise.all([
    ctx.db.qualitySupplierDoc.findMany({
      where: { supplierId: id },
      select: {
        id: true,
        kind: true,
        name: true,
        nodeId: true,
        validUntil: true,
        archivedAt: true,
      },
      orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 200,
    }),
    ctx.db.qualitySupplierReview.findMany({
      where: { supplierId: id },
      select: {
        id: true,
        reviewedOn: true,
        scores: true,
        result: true,
        note: true,
        reviewedById: true,
      },
      orderBy: [{ reviewedOn: "desc" }, { id: "asc" }],
      take: 50,
    }),
    ctx.db.qualityNc.findMany({
      where: { supplierId: id },
      select: { id: true, year: true, number: true, title: true, status: true, severity: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 50,
    }),
    row.folderId === null
      ? Promise.resolve(null)
      : ctx.db.node.findFirst({
          where: { id: row.folderId, type: "FOLDER", trashedAt: null },
          select: { id: true, spaceId: true },
        }),
  ]);
  const nodeIds = docs
    .map((doc) => doc.nodeId)
    .filter((nodeId): nodeId is string => nodeId !== null);
  const [nodes, people] = await Promise.all([
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: { id: true, name: true, spaceId: true, parentId: true },
        }),
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(reviews.map((review) => review.reviewedById))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  return {
    ...view,
    docs: docs.map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      name: doc.name,
      file: doc.nodeId === null ? null : (nodeOf.get(doc.nodeId) ?? null),
      validUntil: doc.validUntil === null ? null : dayOf(doc.validUntil),
      state: stateOf(doc.validUntil, day),
      archived: doc.archivedAt !== null,
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      reviewedOn: dayOf(review.reviewedOn),
      scores: review.scores as Record<string, number>,
      result: review.result,
      note: review.note,
      by: { id: review.reviewedById, name: nameOf.get(review.reviewedById) ?? "" },
    })),
    ncs: ncs.map((nc) => ({
      id: nc.id,
      code: qualityTexts.code(nc.year, nc.number),
      title: nc.title,
      status: nc.status,
      severity: nc.severity,
    })),
    folder,
  };
}

export async function listSuppliers(
  ctx: AdminContext,
  query: SuppliersQuery,
): Promise<Page<SupplierView>> {
  await requireQuality(ctx);
  const q = query.q?.trim() ?? "";
  const where: Prisma.QualitySupplierWhereInput = {
    AND: [
      visibleWhere(ctx),
      query.status === "archived"
        ? { archivedAt: { not: null } }
        : { archivedAt: null, ...(query.status === undefined ? {} : { status: query.status }) },
      ...(query.category === undefined ? [] : [{ category: query.category }]),
      ...(query.risk === undefined ? [] : [{ risk: query.risk }]),
      ...(q === ""
        ? []
        : [
            {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { taxId: { contains: q, mode: "insensitive" as const } },
                { supplies: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ]),
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.qualitySupplier.findMany({
      where,
      select: supplierSelect,
      orderBy: stableOrder({ nameKey: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.qualitySupplier.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}

async function assertMember(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await db.membership.count({ where: { id, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

async function assertFreeName(ctx: AdminContext, name: string, exceptId?: string): Promise<void> {
  const taken = await ctx.db.qualitySupplier.count({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
  });
  if (taken > 0) {
    throw new AppError("CONFLICT", { message: qualityTexts.supplierMessages.nameTaken });
  }
}

export async function createSupplier(
  ctx: AdminContext,
  input: SupplierInput,
): Promise<SupplierDetail> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  const name = cleanName(input.name);
  await assertFreeName(ctx, name);
  await assertMember(ctx.db, input.ownerId);
  const created = await ctx.db.qualitySupplier.create({
    data: {
      ...input,
      name,
      nameKey: nameKeyOf(name),
      taxId: input.taxId ?? null,
      fraudNote: input.fraudNote ?? null,
      contact: input.contact ?? null,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.supplier.create",
    entityType: "QualitySupplier",
    entityId: created.id,
    metadata: { name, category: input.category, risk: input.risk },
  });
  return await getSupplier(ctx, created.id);
}

async function loadEditable(ctx: AdminContext, id: string): Promise<SupplierRow> {
  const row = await loadSupplier(ctx, id);
  if (row.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: qualityTexts.supplierMessages.archived });
  }
  return row;
}

export async function updateSupplier(
  ctx: AdminContext,
  id: string,
  input: UpdateSupplierInput,
): Promise<SupplierDetail> {
  await loadEditable(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  const data: Prisma.QualitySupplierUncheckedUpdateInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    await assertFreeName(ctx, name, id);
    data.name = name;
    data.nameKey = nameKeyOf(name);
  }
  await assertMember(ctx.db, input.ownerId);
  await ctx.db.qualitySupplier.update({ where: { id }, data, select: { id: true } });
  await auditAdmin(ctx, {
    action: "quality.supplier.update",
    entityType: "QualitySupplier",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await getSupplier(ctx, id);
}

export async function setSupplierArchived(
  ctx: AdminContext,
  id: string,
  archived: boolean,
): Promise<SupplierDetail> {
  await loadSupplier(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualitySupplier.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select: { id: true },
    });
    if (archived) await resolveExpiry(tx, SUPPLIER_REVIEW_EXPIRY, id);
  });
  await auditAdmin(ctx, {
    action: archived ? "quality.supplier.archive" : "quality.supplier.restore",
    entityType: "QualitySupplier",
    entityId: id,
  });
  return await getSupplier(ctx, id);
}

/** A document (quality.manage or whoever follows the supplier), with its expiry notice. */
export async function addSupplierDoc(
  ctx: AdminContext,
  supplierId: string,
  input: SupplierDocInput,
): Promise<SupplierDetail> {
  const supplier = await loadEditable(ctx, supplierId);
  if (accessOf(ctx, supplier) === "read") throw forbidden();
  if (input.nodeId !== null) {
    // Only a live file of the supplier's own folder.
    const file = await ctx.db.node.count({
      where: {
        id: input.nodeId,
        type: "FILE",
        trashedAt: null,
        ...(supplier.folderId === null ? { id: "-" } : { parentId: supplier.folderId }),
      },
    });
    if (file === 0) {
      throw new AppError("BAD_REQUEST", { message: qualityTexts.supplierMessages.fileNotInFolder });
    }
  }
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qualitySupplierDoc.create({
      data: {
        supplierId,
        kind: input.kind,
        name: input.name,
        nodeId: input.nodeId,
        validUntil: input.validUntil === null ? null : dateOf(input.validUntil),
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    if (input.validUntil !== null) {
      await setExpiry(tx, {
        kind: SUPPLIER_DOC_EXPIRY,
        subjectId: created.id,
        dueOn: input.validUntil,
        responsibleId: supplier.ownerId ?? ctx.tenant.membershipId,
        noticeDays: [...DOC_NOTICE_DAYS],
      });
    }
    return created.id;
  });
  await auditAdmin(ctx, {
    action: "quality.supplier.doc",
    entityType: "QualitySupplier",
    entityId: supplierId,
    metadata: { docId: id, kind: input.kind, validUntil: input.validUntil },
  });
  return await getSupplier(ctx, supplierId);
}

export async function archiveSupplierDoc(
  ctx: AdminContext,
  docId: string,
): Promise<SupplierDetail> {
  await requireQuality(ctx);
  const doc = await ctx.db.qualitySupplierDoc.findFirst({
    where: { id: docId },
    select: { supplierId: true },
  });
  if (doc === null) throw notFound();
  const supplier = await loadEditable(ctx, doc.supplierId);
  if (accessOf(ctx, supplier) === "read") throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    await tx.qualitySupplierDoc.update({
      where: { id: docId },
      data: { archivedAt: new Date() },
      select: { id: true },
    });
    await resolveExpiry(tx, SUPPLIER_DOC_EXPIRY, docId);
  });
  await auditAdmin(ctx, {
    action: "quality.supplier.doc.archive",
    entityType: "QualitySupplier",
    entityId: doc.supplierId,
    metadata: { docId },
  });
  return await getSupplier(ctx, doc.supplierId);
}

/** The yearly review (quality.manage): its status and the next review (6 months if conditional). */
export async function reviewSupplier(
  ctx: AdminContext,
  id: string,
  input: ReviewInput,
): Promise<SupplierDetail> {
  const supplier = await loadEditable(ctx, id);
  if (!canManageQuality(ctx)) throw forbidden();
  const next = addMonths(input.reviewedOn, input.result === "CONDITIONAL" ? 6 : 12);
  await ctx.db.$transaction(async (tx) => {
    await tx.qualitySupplierReview.create({
      data: {
        supplierId: id,
        reviewedOn: dateOf(input.reviewedOn),
        scores: input.scores,
        result: input.result,
        note: input.note,
        reviewedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    await tx.qualitySupplier.update({
      where: { id },
      data: { status: input.result, nextReviewOn: dateOf(next) },
      select: { id: true },
    });
    await setExpiry(tx, {
      kind: SUPPLIER_REVIEW_EXPIRY,
      subjectId: id,
      dueOn: next,
      responsibleId: supplier.ownerId ?? ctx.tenant.membershipId,
      noticeDays: [...REVIEW_NOTICE_DAYS],
    });
  });
  await auditAdmin(ctx, {
    action: "quality.supplier.review",
    entityType: "QualitySupplier",
    entityId: id,
    metadata: { result: input.result, reviewedOn: input.reviewedOn, scores: input.scores },
  });
  return await getSupplier(ctx, id);
}

/** Its folder «Proveedores/<name>» in the module's space, created by the system the first time. */
export async function supplierFolder(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; spaceId: string }> {
  const supplier = await loadEditable(ctx, id);
  if (accessOf(ctx, supplier) === "read") throw forbidden();
  const settings = await requireQuality(ctx);
  if (settings.spaceId === undefined) throw notFound();
  const spaceId = settings.spaceId;
  const live = await liveFolder(ctx, supplier.folderId);
  if (live !== null) return live;
  const root = await ensureFolder(ctx, spaceId, null, qualityTexts.suppliersFolder);
  const folderId = await ensureFolder(ctx, spaceId, root, supplier.name);
  await ctx.db.qualitySupplier.update({ where: { id }, data: { folderId }, select: { id: true } });
  return { id: folderId, spaceId };
}

/** The files of its folder, to choose a document's file. */
export async function supplierFiles(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; name: string }[]> {
  const supplier = await loadSupplier(ctx, id);
  if (supplier.folderId === null) return [];
  return await ctx.db.node.findMany({
    where: { parentId: supplier.folderId, type: "FILE", trashedAt: null },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
  });
}

/** The supplier of an NC (its record links it), if the person sees it. */
export async function supplierOfNc(
  ctx: AdminContext,
  supplierId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (supplierId === null) return null;
  return await ctx.db.qualitySupplier.findFirst({
    where: { AND: [{ id: supplierId }, visibleWhere(ctx)] },
    select: { id: true, name: true },
  });
}

/** Whether a supplier exists (for an NC linked to it). */
export async function assertSupplier(ctx: AdminContext, id: string): Promise<void> {
  const found = await ctx.db.qualitySupplier.count({ where: { id, archivedAt: null } });
  if (found === 0) throw notFound();
}
