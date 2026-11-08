// Traceability (docs/spec/calidad.md, «Fase 7»): lots of raw material, intermediate and finished product,
// which lots went into each one and which went out to customers; the trace backward (to the raw materials
// and their suppliers) and forward (to the customers), exported as CSV or PDF. quality.view traces;
// quality.manage loads lots by hand. What an external system loaded (source PLUGIN) is only changed by it.
import { escapeHtml } from "@spiderfolio/content";
import { qualityLimits } from "@spiderfolio/limits";
import { qualityTexts } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { toCsv } from "../../lib/csv.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { companyZone, formatDateTimeIn } from "../../lib/time-zone.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import type {
  LinkInput,
  LotInput,
  LotKind,
  LotsQuery,
  ShipmentInput,
  TraceDirection,
  UpdateLotInput,
} from "./lots.schemas.ts";

const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);
const numberOf = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : value.toNumber();

/** quality.view (or manage); never guests. */
export async function requireTrace(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (ctx.tenant.role.base === "GUEST" || !canViewQuality(ctx)) throw forbidden();
}

async function requireTraceManage(ctx: AdminContext): Promise<void> {
  await requireTrace(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
}

const fromPlugin = () =>
  new AppError("CONFLICT", { message: qualityTexts.trace.messages.fromPlugin });

// ─── Views ───────────────────────────────────────────────────────────────────────────────

export interface LotView {
  id: string;
  kind: LotKind;
  code: string;
  product: { id: string; name: string } | null;
  material: string | null;
  supplier: { id: string; name: string } | null;
  supplierLot: string | null;
  origin: string | null;
  quantity: number | null;
  unit: string | null;
  date: string;
  expiresOn: string | null;
  source: "MANUAL" | "CSV" | "PLUGIN";
  editable: boolean;
}

const lotSelect = {
  id: true,
  kind: true,
  code: true,
  productId: true,
  material: true,
  supplierId: true,
  supplierLot: true,
  origin: true,
  quantity: true,
  unit: true,
  date: true,
  expiresOn: true,
  source: true,
} as const;

type LotRow = Prisma.QualityLotGetPayload<{ select: typeof lotSelect }>;

async function lotViews(ctx: AdminContext, rows: LotRow[]): Promise<LotView[]> {
  if (rows.length === 0) return [];
  const productIds = [...new Set(rows.flatMap((row) => (row.productId === null ? [] : [row.productId])))];
  const supplierIds = [
    ...new Set(rows.flatMap((row) => (row.supplierId === null ? [] : [row.supplierId]))),
  ];
  const [products, suppliers] = await Promise.all([
    productIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        }),
    supplierIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualitySupplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true },
        }),
  ]);
  const productOf = new Map(products.map((product) => [product.id, product]));
  const supplierOf = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const manage = canManageQuality(ctx);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    code: row.code,
    product: row.productId === null ? null : (productOf.get(row.productId) ?? null),
    material: row.material,
    supplier: row.supplierId === null ? null : (supplierOf.get(row.supplierId) ?? null),
    supplierLot: row.supplierLot,
    origin: row.origin,
    quantity: numberOf(row.quantity),
    unit: row.unit,
    date: dayOf(row.date),
    expiresOn: row.expiresOn === null ? null : dayOf(row.expiresOn),
    source: row.source,
    editable: manage && row.source !== "PLUGIN",
  }));
}

/** What a lot shows in a list or a trace: its product, or its material, or nothing. */
const whatOf = (lot: LotView) => lot.product?.name ?? lot.material ?? "";

// ─── Listing and detail ──────────────────────────────────────────────────────────────────

export async function listLots(ctx: AdminContext, query: LotsQuery): Promise<Page<LotView>> {
  await requireTrace(ctx);
  const q = query.q?.trim() ?? "";
  const where: Prisma.QualityLotWhereInput = {
    AND: [
      query.ids === undefined ? {} : { id: { in: query.ids } },
      query.kind === undefined ? {} : { kind: query.kind },
      query.from === undefined ? {} : { date: { gte: dateOf(query.from) } },
      query.to === undefined ? {} : { date: { lte: dateOf(query.to) } },
      q === ""
        ? {}
        : {
            OR: [
              { code: { contains: q, mode: "insensitive" as const } },
              { supplierLot: { contains: q, mode: "insensitive" as const } },
              { material: { contains: q, mode: "insensitive" as const } },
            ],
          },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.qualityLot.findMany({
      where,
      select: lotSelect,
      orderBy: stableOrder(query.sort === "code" ? { code: query.dir } : { date: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.qualityLot.count({ where }),
  ]);
  return pageOf(await lotViews(ctx, rows), total, query);
}

async function loadLot(ctx: AdminContext, id: string): Promise<LotRow> {
  const row = await ctx.db.qualityLot.findFirst({ where: { id }, select: lotSelect });
  if (row === null) throw notFound();
  return row;
}

export interface LinkView {
  id: string;
  lot: LotView;
  quantity: number | null;
  unit: string | null;
  editable: boolean;
}

export interface ShipmentView {
  id: string;
  customer: string;
  document: string | null;
  shippedOn: string;
  quantity: number | null;
  unit: string | null;
  editable: boolean;
}

export interface LotDetail extends LotView {
  /** The lots it's made of. */
  inputs: LinkView[];
  /** The lots it went into. */
  outputs: LinkView[];
  shipments: ShipmentView[];
  /** Where it's mentioned: product on hold, complaints and recall tests. */
  holds: { id: string; product: string; status: string }[];
  complaints: { id: string; from: string; product: string; status: string }[];
  recallTests: { id: string; date: string; kind: string; minutes: number }[];
}

const MANY = 500;

export async function getLot(ctx: AdminContext, id: string): Promise<LotDetail> {
  await requireTrace(ctx);
  const row = await loadLot(ctx, id);
  const linkSelect = {
    id: true,
    inputId: true,
    outputId: true,
    quantity: true,
    unit: true,
    source: true,
  } as const;
  const [inputs, outputs, shipments, holds, complaints, recallTests] = await Promise.all([
    ctx.db.qualityLotLink.findMany({
      where: { outputId: id },
      select: linkSelect,
      orderBy: { createdAt: "asc" },
      take: MANY,
    }),
    ctx.db.qualityLotLink.findMany({
      where: { inputId: id },
      select: linkSelect,
      orderBy: { createdAt: "asc" },
      take: MANY,
    }),
    ctx.db.qualityShipment.findMany({
      where: { lotId: id },
      select: {
        id: true,
        customer: true,
        document: true,
        shippedOn: true,
        quantity: true,
        unit: true,
        source: true,
      },
      orderBy: [{ shippedOn: "asc" }, { id: "asc" }],
      take: MANY,
    }),
    ctx.db.qualityHold.findMany({
      where: { lotId: id },
      select: { id: true, product: true, status: true },
      take: 50,
    }),
    ctx.db.qualityComplaint.findMany({
      where: { lotId: id },
      select: { id: true, from: true, product: true, status: true },
      take: 50,
    }),
    ctx.db.qualityRecallTest.findMany({
      where: { lotId: id },
      select: { id: true, date: true, kind: true, minutes: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);
  const otherIds = [...inputs.map((link) => link.inputId), ...outputs.map((link) => link.outputId)];
  const others = await lotViews(
    ctx,
    otherIds.length === 0
      ? []
      : await ctx.db.qualityLot.findMany({ where: { id: { in: otherIds } }, select: lotSelect }),
  );
  const otherOf = new Map(others.map((lot) => [lot.id, lot]));
  const manage = canManageQuality(ctx);
  const links = (rows: typeof inputs, key: "inputId" | "outputId"): LinkView[] =>
    rows.flatMap((link) => {
      const lot = otherOf.get(link[key]);
      return lot === undefined
        ? []
        : [
            {
              id: link.id,
              lot,
              quantity: numberOf(link.quantity),
              unit: link.unit,
              editable: manage && link.source !== "PLUGIN",
            },
          ];
    });
  const [view] = await lotViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return {
    ...view,
    inputs: links(inputs, "inputId"),
    outputs: links(outputs, "outputId"),
    shipments: shipments.map((shipment) => ({
      id: shipment.id,
      customer: shipment.customer,
      document: shipment.document,
      shippedOn: dayOf(shipment.shippedOn),
      quantity: numberOf(shipment.quantity),
      unit: shipment.unit,
      editable: manage && shipment.source !== "PLUGIN",
    })),
    holds,
    complaints,
    recallTests: recallTests.map((test) => ({
      id: test.id,
      date: dayOf(test.date),
      kind: test.kind,
      minutes: test.minutes,
    })),
  };
}

/** A lot of the company picked in another record (product on hold, complaint, recall test). */
export async function assertLot(db: TenantDb, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  if ((await db.qualityLot.count({ where: { id } })) === 0) throw notFound();
}

// ─── Loading by hand ─────────────────────────────────────────────────────────────────────

async function assertRefs(
  db: TenantDb,
  refs: { productId?: string | null | undefined; supplierId?: string | null | undefined },
): Promise<void> {
  if (refs.productId !== null && refs.productId !== undefined) {
    if ((await db.qualityProduct.count({ where: { id: refs.productId } })) === 0) throw notFound();
  }
  if (refs.supplierId !== null && refs.supplierId !== undefined) {
    if ((await db.qualitySupplier.count({ where: { id: refs.supplierId } })) === 0) throw notFound();
  }
}

const isUnique = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function createLot(ctx: AdminContext, input: LotInput): Promise<LotDetail> {
  await requireTraceManage(ctx);
  await assertRefs(ctx.db, input);
  let id: string;
  try {
    const created = await ctx.db.qualityLot.create({
      data: {
        kind: input.kind,
        code: input.code,
        productId: input.productId ?? null,
        material: input.material ?? null,
        supplierId: input.supplierId ?? null,
        supplierLot: input.supplierLot ?? null,
        origin: input.origin ?? null,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        date: dateOf(input.date),
        expiresOn: input.expiresOn === null || input.expiresOn === undefined ? null : dateOf(input.expiresOn),
      },
      select: { id: true },
    });
    id = created.id;
  } catch (error) {
    if (isUnique(error)) {
      throw new AppError("CONFLICT", { message: qualityTexts.trace.messages.duplicate });
    }
    throw error;
  }
  await auditAdmin(ctx, {
    action: "quality.lot.create",
    entityType: "QualityLot",
    entityId: id,
    metadata: { kind: input.kind, code: input.code },
  });
  return await getLot(ctx, id);
}

export async function updateLot(
  ctx: AdminContext,
  id: string,
  input: UpdateLotInput,
): Promise<LotDetail> {
  await requireTraceManage(ctx);
  const current = await loadLot(ctx, id);
  if (current.source === "PLUGIN") throw fromPlugin();
  await assertRefs(ctx.db, input);
  const data: Prisma.QualityLotUncheckedUpdateInput = {
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    ...(input.material === undefined ? {} : { material: input.material }),
    ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
    ...(input.supplierLot === undefined ? {} : { supplierLot: input.supplierLot }),
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.date === undefined ? {} : { date: dateOf(input.date) }),
    ...(input.expiresOn === undefined
      ? {}
      : { expiresOn: input.expiresOn === null ? null : dateOf(input.expiresOn) }),
  };
  try {
    await ctx.db.qualityLot.update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    if (isUnique(error)) {
      throw new AppError("CONFLICT", { message: qualityTexts.trace.messages.duplicate });
    }
    throw error;
  }
  await auditAdmin(ctx, {
    action: "quality.lot.update",
    entityType: "QualityLot",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return await getLot(ctx, id);
}

/** A lot loaded by hand or by CSV, with its links and shipments. */
export async function deleteLot(ctx: AdminContext, id: string): Promise<{ deleted: true }> {
  await requireTraceManage(ctx);
  const current = await loadLot(ctx, id);
  if (current.source === "PLUGIN") throw fromPlugin();
  await ctx.db.qualityLot.delete({ where: { id }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "quality.lot.delete",
    entityType: "QualityLot",
    entityId: id,
    metadata: { kind: current.kind, code: current.code },
  });
  return { deleted: true };
}

/** Whether `target` is among the lots `start` is made of (or is `start`). */
export async function isUpstream(db: TenantDb, start: string, target: string): Promise<boolean> {
  let frontier = [start];
  const seen = new Set(frontier);
  for (let depth = 0; depth < qualityLimits.traceDepth * 5 && frontier.length > 0; depth += 1) {
    if (frontier.includes(target)) return true;
    const links = await db.qualityLotLink.findMany({
      where: { outputId: { in: frontier } },
      select: { inputId: true },
      take: qualityLimits.traceLots * 5,
    });
    frontier = [...new Set(links.map((link) => link.inputId))].filter((lot) => !seen.has(lot));
    for (const lot of frontier) seen.add(lot);
  }
  return false;
}

/** The input lot went into `outputId`; refused if it would close a loop. */
export async function addInput(
  ctx: AdminContext,
  outputId: string,
  input: LinkInput,
): Promise<LotDetail> {
  await requireTraceManage(ctx);
  await loadLot(ctx, outputId);
  await loadLot(ctx, input.inputId);
  if (input.inputId === outputId) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.trace.messages.sameLot });
  }
  if (await isUpstream(ctx.db, input.inputId, outputId)) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.trace.messages.cycle });
  }
  try {
    const link = await ctx.db.qualityLotLink.create({
      data: {
        inputId: input.inputId,
        outputId,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
      },
      select: { id: true },
    });
    await auditAdmin(ctx, {
      action: "quality.lot.link",
      entityType: "QualityLotLink",
      entityId: link.id,
      metadata: { inputId: input.inputId, outputId },
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new AppError("CONFLICT", { message: qualityTexts.trace.messages.linked });
    }
    throw error;
  }
  return await getLot(ctx, outputId);
}

export async function removeLink(ctx: AdminContext, id: string): Promise<{ deleted: true }> {
  await requireTraceManage(ctx);
  const link = await ctx.db.qualityLotLink.findFirst({
    where: { id },
    select: { id: true, source: true, inputId: true, outputId: true },
  });
  if (link === null) throw notFound();
  if (link.source === "PLUGIN") throw fromPlugin();
  await ctx.db.qualityLotLink.delete({ where: { id }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "quality.lot.unlink",
    entityType: "QualityLotLink",
    entityId: id,
    metadata: { inputId: link.inputId, outputId: link.outputId },
  });
  return { deleted: true };
}

export async function addShipment(
  ctx: AdminContext,
  lotId: string,
  input: ShipmentInput,
): Promise<LotDetail> {
  await requireTraceManage(ctx);
  await loadLot(ctx, lotId);
  const created = await ctx.db.qualityShipment.create({
    data: {
      lotId,
      customer: input.customer,
      document: input.document ?? null,
      shippedOn: dateOf(input.shippedOn),
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.shipment.create",
    entityType: "QualityShipment",
    entityId: created.id,
    metadata: { lotId },
  });
  return await getLot(ctx, lotId);
}

export async function removeShipment(ctx: AdminContext, id: string): Promise<{ deleted: true }> {
  await requireTraceManage(ctx);
  const shipment = await ctx.db.qualityShipment.findFirst({
    where: { id },
    select: { id: true, source: true, lotId: true },
  });
  if (shipment === null) throw notFound();
  if (shipment.source === "PLUGIN") throw fromPlugin();
  await ctx.db.qualityShipment.delete({ where: { id }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "quality.shipment.delete",
    entityType: "QualityShipment",
    entityId: id,
    metadata: { lotId: shipment.lotId },
  });
  return { deleted: true };
}

// ─── The trace ───────────────────────────────────────────────────────────────────────────

export interface TraceLot extends LotView {
  /** How many steps from the lot traced (0 is the lot itself). */
  depth: number;
}

export interface Trace {
  root: LotView;
  direction: TraceDirection;
  lots: TraceLot[];
  links: { inputId: string; outputId: string; quantity: number | null; unit: string | null }[];
  /** Forward: what went out to customers from any lot reached. */
  shipments: (ShipmentView & { lotId: string })[];
  totals: {
    lots: number;
    rawMaterials: number;
    suppliers: number;
    customers: number;
    /** Quantity shipped, per unit. */
    shipped: { unit: string; quantity: number }[];
  };
  /** The limit cut it: there's more than what's shown. */
  truncated: boolean;
  ms: number;
}

export async function traceLot(
  ctx: AdminContext,
  id: string,
  direction: TraceDirection,
): Promise<Trace> {
  await requireTrace(ctx);
  const started = Date.now();
  const root = await loadLot(ctx, id);
  const depthOf = new Map<string, number>([[root.id, 0]]);
  const links: Trace["links"] = [];
  let frontier = [root.id];
  let truncated = false;
  for (let depth = 1; frontier.length > 0; depth += 1) {
    if (depth > qualityLimits.traceDepth) {
      truncated = true;
      break;
    }
    const rows = await ctx.db.qualityLotLink.findMany({
      where: direction === "backward" ? { outputId: { in: frontier } } : { inputId: { in: frontier } },
      select: { inputId: true, outputId: true, quantity: true, unit: true },
      take: qualityLimits.traceLots + 1,
    });
    if (rows.length > qualityLimits.traceLots) truncated = true;
    const next: string[] = [];
    for (const row of rows.slice(0, qualityLimits.traceLots)) {
      links.push({
        inputId: row.inputId,
        outputId: row.outputId,
        quantity: numberOf(row.quantity),
        unit: row.unit,
      });
      const reached = direction === "backward" ? row.inputId : row.outputId;
      if (depthOf.has(reached)) continue;
      if (depthOf.size >= qualityLimits.traceLots) {
        truncated = true;
        continue;
      }
      depthOf.set(reached, depth);
      next.push(reached);
    }
    frontier = next;
  }
  const ids = [...depthOf.keys()];
  const [rows, shipmentRows] = await Promise.all([
    ctx.db.qualityLot.findMany({ where: { id: { in: ids } }, select: lotSelect }),
    direction === "forward"
      ? ctx.db.qualityShipment.findMany({
          where: { lotId: { in: ids } },
          select: {
            id: true,
            lotId: true,
            customer: true,
            document: true,
            shippedOn: true,
            quantity: true,
            unit: true,
            source: true,
          },
          orderBy: [{ shippedOn: "asc" }, { id: "asc" }],
          take: qualityLimits.traceLots,
        })
      : Promise.resolve([]),
  ]);
  const views = await lotViews(ctx, rows);
  const lots = views
    .map((lot) => ({ ...lot, depth: depthOf.get(lot.id) ?? 0 }))
    .sort((a, b) => a.depth - b.depth || a.code.localeCompare(b.code));
  const rootView = lots.find((lot) => lot.id === root.id);
  if (rootView === undefined) throw notFound();
  const shipped = new Map<string, number>();
  for (const shipment of shipmentRows) {
    if (shipment.quantity === null) continue;
    const unit = shipment.unit ?? "";
    shipped.set(unit, (shipped.get(unit) ?? 0) + shipment.quantity.toNumber());
  }
  const raw = lots.filter((lot) => lot.kind === "RAW");
  return {
    root: rootView,
    direction,
    lots,
    links,
    shipments: shipmentRows.map((shipment) => ({
      id: shipment.id,
      lotId: shipment.lotId,
      customer: shipment.customer,
      document: shipment.document,
      shippedOn: dayOf(shipment.shippedOn),
      quantity: numberOf(shipment.quantity),
      unit: shipment.unit,
      editable: false,
    })),
    totals: {
      lots: lots.length,
      rawMaterials: raw.length,
      suppliers: new Set(raw.flatMap((lot) => (lot.supplier === null ? [] : [lot.supplier.id]))).size,
      customers: new Set(shipmentRows.map((shipment) => shipment.customer.trim().toLowerCase())).size,
      shipped: [...shipped.entries()].map(([unit, quantity]) => ({ unit, quantity })),
    },
    truncated,
    ms: Date.now() - started,
  };
}

export interface ExportFile {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
}

/** The trace as a CSV (one row per lot, and per shipment) or a PDF to send; audited. */
export async function exportTrace(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  id: string,
  direction: TraceDirection,
  format: "csv" | "pdf",
): Promise<ExportFile> {
  if (format === "pdf" && deps.gotenbergUrl === undefined) {
    await requireTrace(ctx);
    throw new AppError("UNAVAILABLE", { message: qualityTexts.trace.messages.pdfUnavailable });
  }
  const trace = await traceLot(ctx, id, direction);
  const t = qualityTexts.trace;
  const quantity = (value: number | null) =>
    value === null ? "" : value.toLocaleString(currentLocale(), { maximumFractionDigits: 3 });
  const lotRows = trace.lots.map((lot) => [
    String(lot.depth),
    t.kinds[lot.kind],
    lot.code,
    whatOf(lot),
    lot.supplier?.name ?? "",
    lot.supplierLot ?? "",
    lot.origin ?? "",
    quantity(lot.quantity),
    lot.unit ?? "",
    lot.date,
    "",
    "",
    "",
  ]);
  const codeOf = new Map(trace.lots.map((lot) => [lot.id, lot]));
  const shipmentRows = trace.shipments.map((shipment) => {
    const lot = codeOf.get(shipment.lotId);
    return [
      lot === undefined ? "" : String(lot.depth),
      lot === undefined ? "" : t.kinds[lot.kind],
      lot?.code ?? "",
      lot === undefined ? "" : whatOf(lot),
      "",
      "",
      "",
      quantity(shipment.quantity),
      shipment.unit ?? "",
      "",
      shipment.customer,
      shipment.document ?? "",
      shipment.shippedOn,
    ];
  });
  await auditAdmin(ctx, {
    action: "quality.trace.export",
    entityType: "QualityLot",
    entityId: id,
    metadata: { code: trace.root.code, direction, format },
  });
  if (format === "csv") {
    return {
      fileName: t.export.fileName(trace.root.code, "csv"),
      contentType: "text/csv; charset=utf-8",
      body: toCsv(t.export.columns, [...lotRows, ...shipmentRows]),
    };
  }
  const zone = await companyZone(ctx.db);
  const locale = currentLocale();
  const table = (header: readonly string[], rows: string[][]) =>
    `<table><thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  const columns = t.export.columns;
  const lotHeader = columns.slice(0, 10);
  const shipmentHeader = [columns[2] ?? "", columns[3] ?? "", columns[10] ?? "", columns[11] ?? "", columns[12] ?? "", columns[7] ?? "", columns[8] ?? ""];
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 9px; color: #111; }
    h1 { font-size: 15px; margin: 0 0 .3em; } h2 { font-size: 11px; margin: 1.2em 0 .4em; }
    .meta { color: #555; margin: 0 0 .5em; } .warn { color: #b45309; }
    table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; font-weight: normal; }
  `;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body><h1>${escapeHtml(
    t.export.title(trace.root.code),
  )}</h1><p class="meta">${escapeHtml(
    t.export.summary(
      t.directions[direction],
      trace.totals.lots,
      trace.totals.customers,
      formatDateTimeIn(new Date(), zone, locale),
    ),
  )}</p>${trace.truncated ? `<p class="warn">${escapeHtml(t.export.truncated)}</p>` : ""}<h2>${escapeHtml(
    t.export.lots,
  )}</h2>${table(
    lotHeader,
    lotRows.map((row) => row.slice(0, 10)),
  )}${
    shipmentRows.length === 0
      ? ""
      : `<h2>${escapeHtml(t.export.shipments)}</h2>${table(
          shipmentHeader,
          shipmentRows.map((row) => [
            row[2] ?? "",
            row[3] ?? "",
            row[10] ?? "",
            row[11] ?? "",
            row[12] ?? "",
            row[7] ?? "",
            row[8] ?? "",
          ]),
        )}`
  }</body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const pdf = await renderWithGotenberg(deps.gotenbergUrl ?? "", {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(t.export.title(trace.root.code))}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.export.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  return { fileName: t.export.fileName(trace.root.code, "pdf"), contentType: "application/pdf", body: pdf };
}
