// Products, their technical sheet, shelf life studies and labels (docs/spec/calidad.md, «Fase 6b»).
// quality.manage handles them, quality.view reads them; guests never. A label is approved against the
// sheet's version: when the sheet changes afterwards, the label shows as outdated.
import { qualityLimits } from "@spiderfolio/limits";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { qualityTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import { ensureFolder, liveFolder } from "./quality-folders.ts";
import { insertNc, managers } from "./ncs.service.ts";
import {
  labelChecks,
  optionalChecks,
  type LabelInput,
  type LabelReviewInput,
  type ProductInput,
  type ProductsQuery,
  type StudyInput,
  type StudyResultInput,
  type UpdateProductInput,
} from "./products.schemas.ts";

export type LabelState = "approved" | "outdated" | "in_review" | "none";

export interface ProductView {
  id: string;
  code: string | null;
  name: string;
  family: string | null;
  allergens: string[];
  mayContain: string[];
  shelfLifeDays: number | null;
  readyToEat: boolean;
  labelState: LabelState;
  /** Ready to eat without a passed shelf life study. */
  needsStudy: boolean;
  archived: boolean;
}

interface NodeRef {
  id: string;
  name: string;
  spaceId: string;
}

export interface StudyView {
  id: string;
  startedOn: string;
  targetDays: number;
  listeria: boolean;
  result: "PENDING" | "PASSED" | "FAILED";
  resultOn: string | null;
  conclusion: string | null;
  report: NodeRef | null;
  nc: { id: string; code: string } | null;
}

export interface LabelView {
  id: string;
  version: number;
  status: "IN_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  specVersion: number;
  file: NodeRef | null;
  checks: Record<string, string> | null;
  note: string | null;
  submittedBy: { id: string; name: string };
  submittedAt: string;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ProductDetail extends ProductView {
  ingredients: string;
  nutrition: Record<string, number> | null;
  storage: string | null;
  spec: NodeRef | null;
  folder: { id: string; spaceId: string } | null;
  notes: string | null;
  specVersion: number;
  studies: StudyView[];
  labels: LabelView[];
  canManage: boolean;
}

const select = {
  id: true,
  code: true,
  name: true,
  family: true,
  ingredients: true,
  allergens: true,
  mayContain: true,
  nutrition: true,
  shelfLifeDays: true,
  storage: true,
  readyToEat: true,
  specNodeId: true,
  folderId: true,
  notes: true,
  specVersion: true,
  archivedAt: true,
} as const;

type Row = Prisma.QualityProductGetPayload<{ select: typeof select }>;

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** The module on, quality.view (or manage) and never guests. */
async function requireProducts(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST" || !canViewQuality(ctx)) throw forbidden();
}

async function requireManage(ctx: AdminContext): Promise<void> {
  await requireProducts(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
}

function labelStateOf(
  specVersion: number,
  labels: { status: string; specVersion: number }[],
): LabelState {
  if (labels.some((label) => label.status === "IN_REVIEW")) return "in_review";
  const approved = labels.find((label) => label.status === "APPROVED");
  if (approved === undefined) return "none";
  return approved.specVersion < specVersion ? "outdated" : "approved";
}

async function views(ctx: AdminContext, rows: Row[]): Promise<ProductView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [labels, passed] = await Promise.all([
    ctx.db.qualityLabel.findMany({
      where: { productId: { in: ids }, status: { in: ["IN_REVIEW", "APPROVED"] } },
      select: { productId: true, status: true, specVersion: true },
    }),
    ctx.db.qualityShelfLifeStudy.findMany({
      where: { productId: { in: ids }, result: "PASSED" },
      select: { productId: true },
    }),
  ]);
  const withStudy = new Set(passed.map((row) => row.productId));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    family: row.family,
    allergens: row.allergens,
    mayContain: row.mayContain,
    shelfLifeDays: row.shelfLifeDays,
    readyToEat: row.readyToEat,
    labelState: labelStateOf(
      row.specVersion,
      labels.filter((label) => label.productId === row.id),
    ),
    needsStudy: row.readyToEat && !withStudy.has(row.id),
    archived: row.archivedAt !== null,
  }));
}

export async function listProducts(
  ctx: AdminContext,
  query: ProductsQuery,
): Promise<Page<ProductView>> {
  await requireProducts(ctx);
  const q = query.q?.trim() ?? "";
  const where: Prisma.QualityProductWhereInput = {
    AND: [
      query.ids === undefined ? {} : { id: { in: query.ids } },
      query.archived === "1" ? { archivedAt: { not: null } } : { archivedAt: null },
      ...(q === ""
        ? []
        : [
            {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { code: { contains: q, mode: "insensitive" as const } },
                { family: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ]),
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.qualityProduct.findMany({
      where,
      select,
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.qualityProduct.count({ where }),
  ]);
  return pageOf(await views(ctx, rows), total, query);
}

async function load(ctx: AdminContext, id: string): Promise<Row> {
  const row = await ctx.db.qualityProduct.findFirst({ where: { id }, select });
  if (row === null) throw notFound();
  return row;
}

async function names(ctx: AdminContext, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

export async function getProduct(ctx: AdminContext, id: string): Promise<ProductDetail> {
  await requireProducts(ctx);
  const row = await load(ctx, id);
  const [studies, labels, folder] = await Promise.all([
    ctx.db.qualityShelfLifeStudy.findMany({
      where: { productId: id },
      select: {
        id: true,
        startedOn: true,
        targetDays: true,
        listeria: true,
        result: true,
        resultOn: true,
        conclusion: true,
        reportNodeId: true,
        ncId: true,
      },
      orderBy: [{ startedOn: "desc" }, { id: "asc" }],
      take: 50,
    }),
    ctx.db.qualityLabel.findMany({
      where: { productId: id },
      select: {
        id: true,
        version: true,
        status: true,
        specVersion: true,
        nodeId: true,
        checks: true,
        note: true,
        submittedById: true,
        submittedAt: true,
        reviewedById: true,
        reviewedAt: true,
        reviewNote: true,
      },
      orderBy: [{ version: "desc" }],
      take: 50,
    }),
    liveFolder(ctx, row.folderId),
  ]);
  const nodeIds = [
    row.specNodeId,
    ...studies.map((study) => study.reportNodeId),
    ...labels.map((label) => label.nodeId),
  ].filter((nodeId): nodeId is string => nodeId !== null);
  const ncIds = studies.map((study) => study.ncId).filter((ncId): ncId is string => ncId !== null);
  const [nodes, ncs, people] = await Promise.all([
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: { id: true, name: true, spaceId: true },
        }),
    ncIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityNc.findMany({
          where: { id: { in: ncIds } },
          select: { id: true, year: true, number: true },
        }),
    names(
      ctx,
      labels.flatMap((label) =>
        label.reviewedById === null
          ? [label.submittedById]
          : [label.submittedById, label.reviewedById],
      ),
    ),
  ]);
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const ncOf = new Map(ncs.map((nc) => [nc.id, nc]));
  const node = (nodeId: string | null): NodeRef | null =>
    nodeId === null ? null : (nodeOf.get(nodeId) ?? null);
  const [view] = await views(ctx, [row]);
  if (view === undefined) throw notFound();
  return {
    ...view,
    ingredients: row.ingredients,
    nutrition: (row.nutrition as Record<string, number> | null) ?? null,
    storage: row.storage,
    spec: node(row.specNodeId),
    folder,
    notes: row.notes,
    specVersion: row.specVersion,
    studies: studies.map((study) => {
      const nc = study.ncId === null ? undefined : ncOf.get(study.ncId);
      return {
        id: study.id,
        startedOn: dayOf(study.startedOn),
        targetDays: study.targetDays,
        listeria: study.listeria,
        result: study.result,
        resultOn: study.resultOn === null ? null : dayOf(study.resultOn),
        conclusion: study.conclusion,
        report: node(study.reportNodeId),
        nc: nc === undefined ? null : { id: nc.id, code: qualityTexts.code(nc.year, nc.number) },
      };
    }),
    labels: labels.map((label) => ({
      id: label.id,
      version: label.version,
      status: label.status,
      specVersion: label.specVersion,
      file: node(label.nodeId),
      checks: (label.checks as Record<string, string> | null) ?? null,
      note: label.note,
      submittedBy: { id: label.submittedById, name: people.get(label.submittedById) ?? "" },
      submittedAt: label.submittedAt.toISOString(),
      reviewedBy:
        label.reviewedById === null
          ? null
          : { id: label.reviewedById, name: people.get(label.reviewedById) ?? "" },
      reviewedAt: label.reviewedAt?.toISOString() ?? null,
      reviewNote: label.reviewNote,
    })),
    canManage: canManageQuality(ctx),
  };
}

/** A file or page of the product's own folder (the sheet, a label's artwork, a study report). */
async function assertInFolder(
  ctx: AdminContext,
  folderId: string | null,
  nodeId: string | null | undefined,
): Promise<void> {
  if (nodeId === null || nodeId === undefined) return;
  const found =
    folderId === null
      ? 0
      : await ctx.db.node.count({
          where: {
            id: nodeId,
            parentId: folderId,
            type: { in: ["FILE", "PAGE"] },
            trashedAt: null,
          },
        });
  if (found === 0) throw notFound();
}

export async function createProduct(
  ctx: AdminContext,
  input: ProductInput,
): Promise<ProductDetail> {
  await requireManage(ctx);
  // A new product has no folder yet: its sheet is linked once the folder exists.
  if (input.specNodeId !== undefined && input.specNodeId !== null) throw notFound();
  const created = await ctx.db.qualityProduct.create({
    data: {
      code: input.code ?? null,
      name: input.name,
      family: input.family ?? null,
      ingredients: input.ingredients,
      allergens: input.allergens,
      mayContain: input.mayContain,
      ...(input.nutrition === undefined || input.nutrition === null
        ? {}
        : { nutrition: input.nutrition }),
      shelfLifeDays: input.shelfLifeDays ?? null,
      storage: input.storage ?? null,
      readyToEat: input.readyToEat,
      notes: input.notes ?? null,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.product.create",
    entityType: "QualityProduct",
    entityId: created.id,
    metadata: { allergens: input.allergens },
  });
  return await getProduct(ctx, created.id);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list: string[]): string[] => [...list].sort();

export async function updateProduct(
  ctx: AdminContext,
  id: string,
  input: UpdateProductInput,
): Promise<ProductDetail> {
  await requireManage(ctx);
  const current = await load(ctx, id);
  if (current.archivedAt !== null) throw notFound();
  await assertInFolder(ctx, current.folderId, input.specNodeId);
  // What a label is checked against: changing it raises the sheet's version.
  const specChanged =
    (input.ingredients !== undefined && input.ingredients !== current.ingredients) ||
    (input.allergens !== undefined && !same(sorted(input.allergens), sorted(current.allergens))) ||
    (input.mayContain !== undefined &&
      !same(sorted(input.mayContain), sorted(current.mayContain))) ||
    (input.nutrition !== undefined && !same(input.nutrition, current.nutrition)) ||
    (input.shelfLifeDays !== undefined && input.shelfLifeDays !== current.shelfLifeDays);
  const { nutrition, ...rest } = input;
  const data: Prisma.QualityProductUncheckedUpdateInput = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );
  if (nutrition !== undefined) data.nutrition = nutrition ?? Prisma.DbNull;
  if (specChanged) data.specVersion = { increment: 1 };
  await ctx.db.qualityProduct.update({ where: { id }, data, select: { id: true } });
  await auditAdmin(ctx, {
    action: "quality.product.update",
    entityType: "QualityProduct",
    entityId: id,
    metadata: { fields: Object.keys(input), specChanged },
  });
  return await getProduct(ctx, id);
}

export async function setProductArchived(
  ctx: AdminContext,
  id: string,
  archived: boolean,
): Promise<ProductDetail> {
  await requireManage(ctx);
  await load(ctx, id);
  await ctx.db.qualityProduct.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: archived ? "quality.product.archive" : "quality.product.restore",
    entityType: "QualityProduct",
    entityId: id,
  });
  return await getProduct(ctx, id);
}

/** Its folder «Productos/<name>» in the module's space, created the first time. */
export async function productFolder(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; spaceId: string }> {
  await requireManage(ctx);
  const product = await load(ctx, id);
  const settings = await requireQuality(ctx);
  if (settings.spaceId === undefined) throw notFound();
  const live = await liveFolder(ctx, product.folderId);
  if (live !== null) return live;
  const root = await ensureFolder(ctx, settings.spaceId, null, qualityTexts.productsFolder);
  const folderId = await ensureFolder(ctx, settings.spaceId, root, product.name);
  await ctx.db.qualityProduct.update({ where: { id }, data: { folderId }, select: { id: true } });
  return { id: folderId, spaceId: settings.spaceId };
}

/** The files and pages of its folder, to choose the sheet, a label or a report. */
export async function productFiles(
  ctx: AdminContext,
  id: string,
): Promise<{ id: string; name: string; type: "FILE" | "PAGE" }[]> {
  await requireProducts(ctx);
  const product = await load(ctx, id);
  if (product.folderId === null) return [];
  const rows = await ctx.db.node.findMany({
    where: { parentId: product.folderId, type: { in: ["FILE", "PAGE"] }, trashedAt: null },
    select: { id: true, name: true, type: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type === "PAGE" ? "PAGE" : "FILE",
  }));
}

export async function addStudy(
  ctx: AdminContext,
  productId: string,
  input: StudyInput,
): Promise<ProductDetail> {
  await requireManage(ctx);
  const product = await load(ctx, productId);
  if (product.archivedAt !== null) throw notFound();
  const created = await ctx.db.qualityShelfLifeStudy.create({
    data: {
      productId,
      startedOn: dateOf(input.startedOn),
      targetDays: input.targetDays,
      listeria: input.listeria,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.study.create",
    entityType: "QualityShelfLifeStudy",
    entityId: created.id,
    metadata: { productId, targetDays: input.targetDays, listeria: input.listeria },
  });
  return await getProduct(ctx, productId);
}

async function workspaceTitle(ctx: AdminContext, title: () => string): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return withLocale(readWorkspaceLocale(workspace?.settings), title).slice(
    0,
    qualityLimits.titleMax,
  );
}

/** The study's result, once; not met, its nonconformity (origin laboratory) if asked. */
export async function studyResult(
  ctx: AdminContext,
  id: string,
  input: StudyResultInput,
): Promise<ProductDetail> {
  await requireManage(ctx);
  const study = await ctx.db.qualityShelfLifeStudy.findFirst({
    where: { id },
    select: { id: true, productId: true, result: true },
  });
  if (study === null) throw notFound();
  if (study.result !== "PENDING") {
    throw new AppError("CONFLICT", { message: qualityTexts.studyClosed });
  }
  const product = await load(ctx, study.productId);
  await assertInFolder(ctx, product.folderId, input.reportNodeId);
  let ncId: string | null = null;
  if (input.result === "FAILED" && input.openNc) {
    const title = await workspaceTitle(ctx, () => qualityTexts.studyNcTitle(product.name));
    ncId = await insertNc(ctx, {
      title,
      description: input.conclusion ?? title,
      origin: "LAB",
      severity: input.severity,
      detectedOn: input.resultOn,
      location: null,
      ownerId: ctx.tenant.membershipId,
      reportedById: ctx.tenant.membershipId,
    });
  }
  await ctx.db.qualityShelfLifeStudy.update({
    where: { id },
    data: {
      result: input.result,
      resultOn: dateOf(input.resultOn),
      conclusion: input.conclusion ?? null,
      reportNodeId: input.reportNodeId,
      ncId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.study.result",
    entityType: "QualityShelfLifeStudy",
    entityId: id,
    metadata: { result: input.result, ncId },
  });
  return await getProduct(ctx, study.productId);
}

/** Sends a label to review against the sheet's current version. */
export async function submitLabel(
  ctx: AdminContext,
  productId: string,
  input: LabelInput,
): Promise<ProductDetail> {
  await requireManage(ctx);
  const product = await load(ctx, productId);
  if (product.archivedAt !== null) throw notFound();
  await assertInFolder(ctx, product.folderId, input.nodeId);
  const last = await ctx.db.qualityLabel.findFirst({
    where: { productId },
    select: { version: true },
    orderBy: { version: "desc" },
  });
  const created = await ctx.db.qualityLabel.create({
    data: {
      productId,
      version: (last?.version ?? 0) + 1,
      nodeId: input.nodeId,
      specVersion: product.specVersion,
      note: input.note ?? null,
      submittedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.label.submit",
    entityType: "QualityLabel",
    entityId: created.id,
    metadata: { productId },
  });
  const others = (await managers(ctx.db)).filter((id) => id !== ctx.tenant.membershipId);
  for (const membershipId of others.slice(0, 20)) await notifyLabel(ctx, membershipId, productId);
  return await getProduct(ctx, productId);
}

/** Approves (every check ticked, or not applicable where it may be) or rejects (with the reason). */
export async function reviewLabel(
  ctx: AdminContext,
  id: string,
  input: LabelReviewInput,
): Promise<ProductDetail> {
  await requireManage(ctx);
  const label = await ctx.db.qualityLabel.findFirst({
    where: { id },
    select: { id: true, productId: true, status: true, submittedById: true },
  });
  if (label === null) throw notFound();
  if (label.status !== "IN_REVIEW") {
    throw new AppError("CONFLICT", { message: qualityTexts.labels.notInReview });
  }
  const product = await load(ctx, label.productId);
  if (input.decision === "APPROVE") {
    const complete = labelChecks.every((check) => {
      const value = input.checks[check];
      return value === "ok" || (value === "na" && optionalChecks.includes(check));
    });
    if (!complete)
      throw new AppError("BAD_REQUEST", { message: qualityTexts.labels.checksMissing });
  } else if ((input.reviewNote ?? "").trim() === "") {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.labels.reasonRequired });
  }
  const approve = input.decision === "APPROVE";
  await ctx.db.$transaction(async (tx) => {
    if (approve) {
      await tx.qualityLabel.updateMany({
        where: { productId: label.productId, status: "APPROVED" },
        data: { status: "SUPERSEDED" },
      });
    }
    await tx.qualityLabel.update({
      where: { id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        // Approved against the sheet the reviewer sees now.
        specVersion: product.specVersion,
        checks: input.checks,
        reviewedById: ctx.tenant.membershipId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
      },
      select: { id: true },
    });
  });
  await auditAdmin(ctx, {
    action: approve ? "quality.label.approve" : "quality.label.reject",
    entityType: "QualityLabel",
    entityId: id,
    metadata: {
      productId: label.productId,
      specVersion: product.specVersion,
      selfReviewed: label.submittedById === ctx.tenant.membershipId,
    },
  });
  if (label.submittedById !== ctx.tenant.membershipId) {
    await notifyLabel(ctx, label.submittedById, label.productId);
  }
  return await getProduct(ctx, label.productId);
}

async function notifyLabel(ctx: AdminContext, membershipId: string, productId: string) {
  await ctx.db.notification.create({
    data: {
      membershipId,
      kind: "quality_label",
      actorId: ctx.tenant.membershipId,
      detail: productId,
    },
    select: { id: true },
  });
}

/** For the dashboard: outdated or in-review labels and ready-to-eat products without a study. */
export async function productFigures(
  ctx: AdminContext,
): Promise<{ labelsOutdated: number; labelsInReview: number; withoutStudy: number }> {
  const products = await ctx.db.qualityProduct.findMany({
    where: { archivedAt: null },
    select: { id: true, specVersion: true, readyToEat: true },
    take: 5000,
  });
  if (products.length === 0) return { labelsOutdated: 0, labelsInReview: 0, withoutStudy: 0 };
  const [labels, passed] = await Promise.all([
    ctx.db.qualityLabel.findMany({
      where: { status: { in: ["IN_REVIEW", "APPROVED"] }, product: { archivedAt: null } },
      select: { productId: true, status: true, specVersion: true },
      take: 10_000,
    }),
    ctx.db.qualityShelfLifeStudy.findMany({
      where: { result: "PASSED", product: { archivedAt: null } },
      select: { productId: true },
      take: 10_000,
    }),
  ]);
  const withStudy = new Set(passed.map((row) => row.productId));
  let labelsOutdated = 0;
  let labelsInReview = 0;
  let withoutStudy = 0;
  for (const product of products) {
    const state = labelStateOf(
      product.specVersion,
      labels.filter((label) => label.productId === product.id),
    );
    if (state === "outdated") labelsOutdated += 1;
    if (state === "in_review") labelsInReview += 1;
    if (product.readyToEat && !withStudy.has(product.id)) withoutStudy += 1;
  }
  return { labelsOutdated, labelsInReview, withoutStudy };
}
