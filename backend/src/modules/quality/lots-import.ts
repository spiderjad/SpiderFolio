// Traceability CSV import (docs/spec/calidad.md, «Fase 7»): lots, links and shipments, for companies
// without a connector to their ERP. Checked row by row first (dryRun), then written: a lot of the same
// type and code is updated, a link already there is updated, a shipment of the same lot, customer,
// delivery note and day is updated. What an external system loaded is never touched. quality.manage.
import { qualityLimits } from "@spiderfolio/limits";
import { qualityTexts } from "../../i18n/index.ts";
import { toCsv } from "../../lib/csv.ts";
import { AppError, forbidden } from "../../lib/errors.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { parseCsv } from "../members/members.csv.ts";
import { canManageQuality } from "./quality-access.ts";
import { isUpstream, requireTrace } from "./lots.service.ts";
import type { ImportInput, ImportKind, LotKind } from "./lots.schemas.ts";

/** Header names read, in both languages (lowercase, no accents, spaces as underscores). */
const columns = {
  lots: {
    kind: ["tipo", "type"],
    code: ["lote", "lot"],
    product: ["producto", "product"],
    material: ["materia", "material", "materia_prima", "raw_material"],
    supplier: ["proveedor", "supplier"],
    supplierLot: ["lote_proveedor", "supplier_lot"],
    origin: ["origen", "origin"],
    quantity: ["cantidad", "quantity"],
    unit: ["unidad", "unit"],
    date: ["fecha", "date"],
    expiresOn: ["caducidad", "expires", "expires_on", "expiry"],
  },
  links: {
    inputKind: ["tipo_entrada", "input_type"],
    inputCode: ["lote_entrada", "input_lot"],
    outputKind: ["tipo_salida", "output_type"],
    outputCode: ["lote_salida", "output_lot"],
    quantity: ["cantidad", "quantity"],
    unit: ["unidad", "unit"],
  },
  shipments: {
    kind: ["tipo", "type"],
    code: ["lote", "lot"],
    customer: ["cliente", "customer"],
    document: ["albaran", "delivery_note", "document"],
    shippedOn: ["fecha", "date", "shipped_on"],
    quantity: ["cantidad", "quantity"],
    unit: ["unidad", "unit"],
  },
} as const;

const required = {
  lots: ["kind", "code", "date"],
  links: ["inputKind", "inputCode", "outputKind", "outputCode"],
  shipments: ["kind", "code", "customer", "shippedOn"],
} as const;

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s-]+/gu, "_");

const kindNames: Record<string, LotKind> = {
  raw: "RAW",
  raw_material: "RAW",
  materia_prima: "RAW",
  mp: "RAW",
  intermediate: "INTERMEDIATE",
  intermedio: "INTERMEDIATE",
  finished: "FINISHED",
  finished_product: "FINISHED",
  terminado: "FINISHED",
  producto_terminado: "FINISHED",
  pt: "FINISHED",
};

/** «780», «780.5», «780,5» or «1.234,5». */
function quantityOf(value: string): number | null | undefined {
  const text = value.trim().replace(/\s/gu, "");
  if (text === "") return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const decimal = lastComma > lastDot ? "," : ".";
  const thousands = decimal === "," ? "." : ",";
  const plain = text.replaceAll(thousands, "").replace(decimal, ".");
  const parsed = Number(plain);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000_000_000 ? parsed : undefined;
}

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  /** The first rows with errors (the line of the file, the header is 1). */
  errors: { line: number; message: string }[];
  errorCount: number;
}

const ERRORS_SHOWN = 100;

type Cells<K extends ImportKind> = Record<keyof (typeof columns)[K], string>;

function readTable<K extends ImportKind>(kind: K, csv: string): { line: number; cells: Cells<K> }[] {
  const e = qualityTexts.trace.import.errors;
  const table = parseCsv(csv);
  const [header, ...body] = table;
  if (header === undefined || body.length === 0) {
    throw new AppError("BAD_REQUEST", { message: e.empty });
  }
  if (body.length > qualityLimits.traceImportRows) {
    throw new AppError("BAD_REQUEST", { message: e.tooMany(qualityLimits.traceImportRows) });
  }
  const names = header.map(normalized);
  const spec = columns[kind] as Record<string, readonly string[]>;
  const indexOf: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(spec)) {
    indexOf[key] = names.findIndex((name) => aliases.includes(name));
  }
  const headers = qualityTexts.trace.import.headers[kind];
  const keys = Object.keys(spec);
  for (const key of required[kind] as readonly string[]) {
    if (indexOf[key] === -1) {
      const label = headers[keys.indexOf(key)] ?? key;
      throw new AppError("BAD_REQUEST", { message: e.missingColumn(label) });
    }
  }
  return body.map((row, index) => ({
    line: index + 2,
    cells: Object.fromEntries(
      keys.map((key) => {
        const at = indexOf[key] ?? -1;
        return [key, at === -1 ? "" : (row[at] ?? "").trim()];
      }),
    ) as Cells<K>,
  }));
}

/** The template to fill: the header in the company's language and two example rows. */
export async function importTemplate(
  ctx: AdminContext,
  kind: ImportKind,
): Promise<{ fileName: string; body: string }> {
  await requireTrace(ctx);
  const t = qualityTexts.trace.import;
  return { fileName: t.fileName(kind), body: toCsv(t.headers[kind], t.sample[kind]) };
}

async function lotIndex(db: TenantDb, codes: string[]) {
  const unique = [...new Set(codes.filter((code) => code !== ""))];
  const rows: { id: string; kind: LotKind; code: string; source: string }[] = [];
  for (let start = 0; start < unique.length; start += 1000) {
    rows.push(
      ...(await db.qualityLot.findMany({
        where: { code: { in: unique.slice(start, start + 1000) } },
        select: { id: true, kind: true, code: true, source: true },
      })),
    );
  }
  return new Map(rows.map((row) => [`${row.kind}:${row.code}`, row]));
}

export async function importTrace(ctx: AdminContext, input: ImportInput): Promise<ImportResult> {
  await requireTrace(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  const result: ImportResult = {
    kind: input.kind,
    dryRun: input.dryRun,
    total: 0,
    created: 0,
    updated: 0,
    errors: [],
    errorCount: 0,
  };
  const fail = (line: number, message: string) => {
    result.errorCount += 1;
    if (result.errors.length < ERRORS_SHOWN) result.errors.push({ line, message });
  };
  if (input.kind === "lots") await importLots(ctx, input, result, fail);
  else if (input.kind === "links") await importLinks(ctx, input, result, fail);
  else await importShipments(ctx, input, result, fail);
  if (!input.dryRun) {
    await auditAdmin(ctx, {
      action: "quality.trace.import",
      entityType: "QualityLot",
      entityId: input.kind,
      metadata: {
        kind: input.kind,
        total: result.total,
        created: result.created,
        updated: result.updated,
        errors: result.errorCount,
      },
    });
  }
  return result;
}

type Fail = (line: number, message: string) => void;

function kindOf(value: string, line: number, fail: Fail): LotKind | null {
  const kind = kindNames[normalized(value)];
  if (kind === undefined) {
    fail(line, qualityTexts.trace.import.errors.kind(value));
    return null;
  }
  return kind;
}

function longer(value: string, max: number, name: string, line: number, fail: Fail): boolean {
  if (value.length <= max) return false;
  fail(line, qualityTexts.trace.import.errors.tooLong(name));
  return true;
}

async function importLots(ctx: AdminContext, input: ImportInput, result: ImportResult, fail: Fail) {
  const e = qualityTexts.trace.import.errors;
  const headers = qualityTexts.trace.import.headers.lots;
  const rows = readTable("lots", input.csv);
  result.total = rows.length;
  const [existing, products, suppliers] = await Promise.all([
    lotIndex(
      ctx.db,
      rows.map((row) => row.cells.code),
    ),
    ctx.db.qualityProduct.findMany({ select: { id: true, code: true, name: true }, take: 5000 }),
    ctx.db.qualitySupplier.findMany({ select: { id: true, name: true }, take: 5000 }),
  ]);
  const productOf = new Map<string, string>();
  for (const product of products) {
    productOf.set(normalized(product.name), product.id);
    if (product.code !== null) productOf.set(normalized(product.code), product.id);
  }
  const supplierOf = new Map(suppliers.map((supplier) => [normalized(supplier.name), supplier.id]));
  for (const { line, cells } of rows) {
    const kind = kindOf(cells.kind, line, fail);
    if (kind === null) continue;
    if (cells.code === "") {
      fail(line, e.required(headers[1] ?? "lote"));
      continue;
    }
    if (!isDay(cells.date)) {
      fail(line, e.date(cells.date));
      continue;
    }
    if (cells.expiresOn !== "" && !isDay(cells.expiresOn)) {
      fail(line, e.date(cells.expiresOn));
      continue;
    }
    const quantity = quantityOf(cells.quantity);
    if (quantity === undefined) {
      fail(line, e.number(cells.quantity));
      continue;
    }
    const productId = cells.product === "" ? null : productOf.get(normalized(cells.product));
    if (productId === undefined) {
      fail(line, e.product(cells.product));
      continue;
    }
    const supplierId = cells.supplier === "" ? null : supplierOf.get(normalized(cells.supplier));
    if (supplierId === undefined) {
      fail(line, e.supplier(cells.supplier));
      continue;
    }
    if (
      longer(cells.code, 80, headers[1] ?? "", line, fail) ||
      longer(cells.material, 160, headers[3] ?? "", line, fail) ||
      longer(cells.supplierLot, 80, headers[5] ?? "", line, fail) ||
      longer(cells.origin, 200, headers[6] ?? "", line, fail) ||
      longer(cells.unit, 20, headers[8] ?? "", line, fail)
    ) {
      continue;
    }
    const data = {
      productId,
      material: cells.material === "" ? null : cells.material,
      supplierId,
      supplierLot: cells.supplierLot === "" ? null : cells.supplierLot,
      origin: cells.origin === "" ? null : cells.origin,
      quantity,
      unit: cells.unit === "" ? null : cells.unit,
      date: dateOf(cells.date),
      expiresOn: cells.expiresOn === "" ? null : dateOf(cells.expiresOn),
    };
    const key = `${kind}:${cells.code}`;
    const found = existing.get(key);
    if (found?.source === "PLUGIN") {
      fail(line, e.fromPlugin);
      continue;
    }
    if (found === undefined) {
      result.created += 1;
      if (!input.dryRun) {
        const created = await ctx.db.qualityLot.create({
          data: { ...data, kind, code: cells.code, source: "CSV" },
          select: { id: true, kind: true, code: true, source: true },
        });
        existing.set(key, created);
      } else {
        existing.set(key, { id: "", kind, code: cells.code, source: "CSV" });
      }
    } else {
      result.updated += 1;
      if (!input.dryRun && found.id !== "") {
        // An empty cell leaves what the lot already has: the file only adds or corrects.
        const changes = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== null),
        );
        await ctx.db.qualityLot.update({
          where: { id: found.id },
          data: changes,
          select: { id: true },
        });
      }
    }
  }
}

async function importLinks(
  ctx: AdminContext,
  input: ImportInput,
  result: ImportResult,
  fail: Fail,
) {
  const e = qualityTexts.trace.import.errors;
  const rows = readTable("links", input.csv);
  result.total = rows.length;
  const existing = await lotIndex(
    ctx.db,
    rows.flatMap((row) => [row.cells.inputCode, row.cells.outputCode]),
  );
  for (const { line, cells } of rows) {
    const inputKind = kindOf(cells.inputKind, line, fail);
    const outputKind = inputKind === null ? null : kindOf(cells.outputKind, line, fail);
    if (inputKind === null || outputKind === null) continue;
    const from = existing.get(`${inputKind}:${cells.inputCode}`);
    const to = existing.get(`${outputKind}:${cells.outputCode}`);
    if (from === undefined) {
      fail(line, e.lot(cells.inputCode));
      continue;
    }
    if (to === undefined) {
      fail(line, e.lot(cells.outputCode));
      continue;
    }
    const quantity = quantityOf(cells.quantity);
    if (quantity === undefined) {
      fail(line, e.number(cells.quantity));
      continue;
    }
    if (longer(cells.unit, 20, "unit", line, fail)) continue;
    if (from.id === to.id || (await isUpstream(ctx.db, from.id, to.id))) {
      fail(line, e.cycle);
      continue;
    }
    const link = await ctx.db.qualityLotLink.findFirst({
      where: { inputId: from.id, outputId: to.id },
      select: { id: true, source: true },
    });
    if (link?.source === "PLUGIN") {
      fail(line, e.fromPlugin);
      continue;
    }
    const data = { quantity, unit: cells.unit === "" ? null : cells.unit };
    const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null));
    if (link === null) {
      result.created += 1;
      if (!input.dryRun) {
        await ctx.db.qualityLotLink.create({
          data: { ...data, inputId: from.id, outputId: to.id, source: "CSV" },
          select: { id: true },
        });
      }
    } else {
      result.updated += 1;
      if (!input.dryRun) {
        await ctx.db.qualityLotLink.update({
          where: { id: link.id },
          data: changes,
          select: { id: true },
        });
      }
    }
  }
}

async function importShipments(
  ctx: AdminContext,
  input: ImportInput,
  result: ImportResult,
  fail: Fail,
) {
  const e = qualityTexts.trace.import.errors;
  const headers = qualityTexts.trace.import.headers.shipments;
  const rows = readTable("shipments", input.csv);
  result.total = rows.length;
  const existing = await lotIndex(
    ctx.db,
    rows.map((row) => row.cells.code),
  );
  for (const { line, cells } of rows) {
    const kind = kindOf(cells.kind, line, fail);
    if (kind === null) continue;
    const lot = existing.get(`${kind}:${cells.code}`);
    if (lot === undefined) {
      fail(line, e.lot(cells.code));
      continue;
    }
    if (cells.customer === "") {
      fail(line, e.required(headers[2] ?? "cliente"));
      continue;
    }
    if (!isDay(cells.shippedOn)) {
      fail(line, e.date(cells.shippedOn));
      continue;
    }
    const quantity = quantityOf(cells.quantity);
    if (quantity === undefined) {
      fail(line, e.number(cells.quantity));
      continue;
    }
    if (
      longer(cells.customer, 160, headers[2] ?? "", line, fail) ||
      longer(cells.document, 80, headers[3] ?? "", line, fail) ||
      longer(cells.unit, 20, headers[6] ?? "", line, fail)
    ) {
      continue;
    }
    const document = cells.document === "" ? null : cells.document;
    const shippedOn = dateOf(cells.shippedOn);
    const found = await ctx.db.qualityShipment.findFirst({
      where: { lotId: lot.id, customer: cells.customer, document, shippedOn },
      select: { id: true, source: true },
    });
    if (found?.source === "PLUGIN") {
      fail(line, e.fromPlugin);
      continue;
    }
    const data = { quantity, unit: cells.unit === "" ? null : cells.unit };
    const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null));
    if (found === null) {
      result.created += 1;
      if (!input.dryRun) {
        await ctx.db.qualityShipment.create({
          data: { ...data, lotId: lot.id, customer: cells.customer, document, shippedOn, source: "CSV" },
          select: { id: true },
        });
      }
    } else {
      result.updated += 1;
      if (!input.dryRun) {
        await ctx.db.qualityShipment.update({
          where: { id: found.id },
          data: changes,
          select: { id: true },
        });
      }
    }
  }
}
