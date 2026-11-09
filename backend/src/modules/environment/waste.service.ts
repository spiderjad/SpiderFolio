// Waste and animal by-products (docs/spec/medio-ambiente.md, section 2): the waste catalog, the waste
// managers and carriers, and each collection, which together are the chronological record of Ley 7/2022
// (art. 64) and the SANDACH dispatch register.
import { environmentLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type { EnvSandach, EnvUnit, Prisma } from "../../generated/prisma/client.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { environmentTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { ensureFolder, liveFolder } from "../quality/quality-folders.ts";
import { companyToday } from "../quality/prps.service.ts";
import {
  addMonths,
  canViewEnvironment,
  dateOf,
  environmentManagers,
  requireCatalog,
  requireManage,
  requireRecord,
} from "./environment-access.ts";
import { defaultStorageMonths, moduleSpace } from "./environment.service.ts";

export const CONTRACTOR_EXPIRY = "environment.contractor";
export const STORAGE_EXPIRY = "environment.storage";

const LER = /^\d{6}\*?$/u;

const conflict = (message: string) => new AppError("CONFLICT", { message });
const invalid = (message: string) => new AppError("BAD_REQUEST", { message });

// ─── Contractors ────────────────────────────────────────────────────────────────────────────

export interface ContractorView {
  id: string;
  name: string;
  nif: string | null;
  nima: string | null;
  authorizations: string;
  isManager: boolean;
  isCarrier: boolean;
  authorizationExpiresOn: string | null;
  contact: string;
  folder: { spaceId: string; id: string } | null;
  archived: boolean;
}

export interface ContractorInput {
  name: string;
  nif: string | null;
  nima: string | null;
  authorizations: string;
  isManager: boolean;
  isCarrier: boolean;
  authorizationExpiresOn: string | null;
  contact: string;
}

const contractorSelect = {
  id: true,
  name: true,
  nif: true,
  nima: true,
  authorizations: true,
  isManager: true,
  isCarrier: true,
  authorizationExpiresOn: true,
  contact: true,
  folderId: true,
  archivedAt: true,
} as const;

type ContractorRow = Prisma.EnvContractorGetPayload<{ select: typeof contractorSelect }>;

async function contractorView(ctx: AdminContext, row: ContractorRow): Promise<ContractorView> {
  const folder = await liveFolder(ctx, row.folderId);
  return {
    id: row.id,
    name: row.name,
    nif: row.nif,
    nima: row.nima,
    authorizations: row.authorizations,
    isManager: row.isManager,
    isCarrier: row.isCarrier,
    authorizationExpiresOn:
      row.authorizationExpiresOn === null ? null : dayOf(row.authorizationExpiresOn),
    contact: row.contact,
    folder: folder === null ? null : { spaceId: folder.spaceId, id: folder.id },
    archived: row.archivedAt !== null,
  };
}

async function syncContractorExpiry(db: TenantDb, row: ContractorRow): Promise<void> {
  if (row.archivedAt !== null || row.authorizationExpiresOn === null) {
    await resolveExpiry(db, CONTRACTOR_EXPIRY, row.id);
    return;
  }
  await setExpiry(db, {
    kind: CONTRACTOR_EXPIRY,
    subjectId: row.id,
    dueOn: dayOf(row.authorizationExpiresOn),
    responsibleId: (await environmentManagers(db))[0] ?? null,
    noticeDays: [...environmentLimits.noticeDays],
  });
}

async function contractorFolder(ctx: AdminContext, name: string): Promise<string> {
  const spaceId = await moduleSpace(ctx);
  const parent = await ensureFolder(ctx, spaceId, null, environmentTexts.folders.contractors);
  return await ensureFolder(ctx, spaceId, parent, name);
}

export async function listContractors(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<ContractorView[]> {
  await requireCatalog(ctx);
  const rows = await ctx.db.envContractor.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    select: contractorSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
  return await Promise.all(rows.map((row) => contractorView(ctx, row)));
}

async function assertFreeContractorName(db: TenantDb, name: string, except?: string) {
  const other = await db.envContractor.findFirst({
    where: { nameKey: nameKeyOf(name), ...(except === undefined ? {} : { id: { not: except } }) },
    select: { id: true },
  });
  if (other !== null) throw conflict(environmentTexts.errors.contractorExists);
}

export async function createContractor(
  ctx: AdminContext,
  input: ContractorInput,
): Promise<ContractorView> {
  await requireManage(ctx);
  await assertFreeContractorName(ctx.db, input.name);
  const row = await ctx.db.envContractor.create({
    data: {
      ...input,
      nameKey: nameKeyOf(input.name),
      authorizationExpiresOn:
        input.authorizationExpiresOn === null ? null : dateOf(input.authorizationExpiresOn),
      folderId: await contractorFolder(ctx, input.name),
    },
    select: contractorSelect,
  });
  await syncContractorExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "environment.contractor.create",
    entityType: "EnvContractor",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return await contractorView(ctx, row);
}

export async function updateContractor(
  ctx: AdminContext,
  id: string,
  input: ContractorInput & { archived?: boolean | undefined },
): Promise<ContractorView> {
  await requireManage(ctx);
  const current = await ctx.db.envContractor.findFirst({
    where: { id },
    select: { folderId: true },
  });
  if (current === null) throw notFound();
  await assertFreeContractorName(ctx.db, input.name, id);
  const folder = await liveFolder(ctx, current.folderId);
  const { archived, ...fields } = input;
  const row = await ctx.db.envContractor.update({
    where: { id },
    data: {
      ...fields,
      nameKey: nameKeyOf(input.name),
      authorizationExpiresOn:
        input.authorizationExpiresOn === null ? null : dateOf(input.authorizationExpiresOn),
      ...(folder === null ? { folderId: await contractorFolder(ctx, input.name) } : {}),
      ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
    },
    select: contractorSelect,
  });
  await syncContractorExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: archived === true ? "environment.contractor.archive" : "environment.contractor.update",
    entityType: "EnvContractor",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return await contractorView(ctx, row);
}

// ─── Waste catalog ──────────────────────────────────────────────────────────────────────────

export interface WasteView {
  id: string;
  name: string;
  ler: string;
  hazardous: boolean;
  sandach: EnvSandach | null;
  operation: string;
  manager: { id: string; name: string } | null;
  carrier: { id: string; name: string } | null;
  contractRef: string;
  maxStorageMonths: number;
  storageSince: string | null;
  /** The day it reaches its maximum storage, while it's stored. */
  storageUntil: string | null;
  archived: boolean;
}

export interface WasteInput {
  name: string;
  ler: string;
  sandach: EnvSandach | null;
  operation: string;
  managerId: string | null;
  carrierId: string | null;
  contractRef: string;
  /** null: the law's default for this waste. */
  maxStorageMonths: number | null;
  storageSince: string | null;
}

const wasteSelect = {
  id: true,
  name: true,
  ler: true,
  hazardous: true,
  sandach: true,
  operation: true,
  managerId: true,
  carrierId: true,
  contractRef: true,
  maxStorageMonths: true,
  storageSince: true,
  archivedAt: true,
} as const;

type WasteRow = Prisma.EnvWasteGetPayload<{ select: typeof wasteSelect }>;

async function contractorNames(
  db: TenantDb,
  ids: (string | null)[],
): Promise<Map<string, { name: string; nima: string | null }>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db.envContractor.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, nima: true },
  });
  return new Map(rows.map((row) => [row.id, { name: row.name, nima: row.nima }]));
}

const storageUntilOf = (row: Pick<WasteRow, "storageSince" | "maxStorageMonths">) =>
  row.storageSince === null ? null : addMonths(dayOf(row.storageSince), row.maxStorageMonths);

async function wasteViews(db: TenantDb, rows: WasteRow[]): Promise<WasteView[]> {
  const names = await contractorNames(db, [
    ...rows.map((row) => row.managerId),
    ...rows.map((row) => row.carrierId),
  ]);
  const company = (id: string | null) =>
    id === null ? null : { id, name: names.get(id)?.name ?? "" };
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ler: row.ler,
    hazardous: row.hazardous,
    sandach: row.sandach,
    operation: row.operation,
    manager: company(row.managerId),
    carrier: company(row.carrierId),
    contractRef: row.contractRef,
    maxStorageMonths: row.maxStorageMonths,
    storageSince: row.storageSince === null ? null : dayOf(row.storageSince),
    storageUntil: storageUntilOf(row),
    archived: row.archivedAt !== null,
  }));
}

async function syncStorageExpiry(db: TenantDb, row: WasteRow): Promise<void> {
  const until = storageUntilOf(row);
  if (row.archivedAt !== null || until === null) {
    await resolveExpiry(db, STORAGE_EXPIRY, row.id);
    return;
  }
  await setExpiry(db, {
    kind: STORAGE_EXPIRY,
    subjectId: row.id,
    dueOn: until,
    responsibleId: (await environmentManagers(db))[0] ?? null,
    noticeDays: [...environmentLimits.storageNoticeDays],
  });
}

/** The company must exist, not be archived and have that role. */
async function assertContractor(
  db: TenantDb,
  id: string | null,
  role: "manager" | "carrier",
): Promise<void> {
  if (id === null) return;
  const row = await db.envContractor.findFirst({
    where: { id },
    select: { isManager: true, isCarrier: true, archivedAt: true },
  });
  if (row === null) throw notFound();
  if (row.archivedAt !== null) throw invalid(environmentTexts.errors.archived);
  if (role === "manager" && !row.isManager) throw invalid(environmentTexts.errors.notManager);
  if (role === "carrier" && !row.isCarrier) throw invalid(environmentTexts.errors.notCarrier);
}

function cleanLer(ler: string): string {
  const clean = ler.replace(/[\s.]/gu, "");
  if (!LER.test(clean)) throw invalid(environmentTexts.errors.invalidLer);
  return clean;
}

export async function listWastes(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<WasteView[]> {
  await requireCatalog(ctx);
  const rows = await ctx.db.envWaste.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    select: wasteSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
  return await wasteViews(ctx.db, rows);
}

async function assertFreeWasteName(db: TenantDb, name: string, except?: string) {
  const other = await db.envWaste.findFirst({
    where: { nameKey: nameKeyOf(name), ...(except === undefined ? {} : { id: { not: except } }) },
    select: { id: true },
  });
  if (other !== null) throw conflict(environmentTexts.errors.wasteExists);
}

function wasteData(input: WasteInput) {
  const ler = cleanLer(input.ler);
  const hazardous = ler.endsWith("*");
  return {
    name: input.name,
    nameKey: nameKeyOf(input.name),
    ler,
    hazardous,
    sandach: input.sandach,
    operation: input.operation.toUpperCase(),
    managerId: input.managerId,
    carrierId: input.carrierId,
    contractRef: input.contractRef,
    maxStorageMonths: input.maxStorageMonths ?? defaultStorageMonths(hazardous, input.operation),
    storageSince: input.storageSince === null ? null : dateOf(input.storageSince),
  };
}

export async function createWaste(ctx: AdminContext, input: WasteInput): Promise<WasteView> {
  await requireManage(ctx);
  await assertFreeWasteName(ctx.db, input.name);
  await assertContractor(ctx.db, input.managerId, "manager");
  await assertContractor(ctx.db, input.carrierId, "carrier");
  const row = await ctx.db.envWaste.create({ data: wasteData(input), select: wasteSelect });
  await syncStorageExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: "environment.waste.create",
    entityType: "EnvWaste",
    entityId: row.id,
    metadata: { name: row.name, ler: row.ler },
  });
  return (await wasteViews(ctx.db, [row]))[0] as WasteView;
}

export async function updateWaste(
  ctx: AdminContext,
  id: string,
  input: WasteInput & { archived?: boolean | undefined },
): Promise<WasteView> {
  await requireManage(ctx);
  const exists = await ctx.db.envWaste.findFirst({ where: { id }, select: { id: true } });
  if (exists === null) throw notFound();
  await assertFreeWasteName(ctx.db, input.name, id);
  await assertContractor(ctx.db, input.managerId, "manager");
  await assertContractor(ctx.db, input.carrierId, "carrier");
  const row = await ctx.db.envWaste.update({
    where: { id },
    data: {
      ...wasteData(input),
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
    },
    select: wasteSelect,
  });
  await syncStorageExpiry(ctx.db, row);
  await auditAdmin(ctx, {
    action: input.archived === true ? "environment.waste.archive" : "environment.waste.update",
    entityType: "EnvWaste",
    entityId: row.id,
    metadata: { name: row.name, ler: row.ler },
  });
  return (await wasteViews(ctx.db, [row]))[0] as WasteView;
}

// ─── Collections ────────────────────────────────────────────────────────────────────────────

export interface MovementView {
  id: string;
  date: string;
  waste: { id: string; name: string; ler: string; hazardous: boolean; sandach: EnvSandach | null };
  quantity: number;
  unit: EnvUnit;
  manager: { id: string; name: string; nima: string | null } | null;
  carrier: { id: string; name: string } | null;
  operation: string;
  documentRef: string;
  vehicle: string;
  notes: string;
  recordedBy: string;
  createdAt: Date;
}

export interface MovementInput {
  wasteId: string;
  date: string;
  quantity: number;
  unit: EnvUnit;
  managerId: string | null;
  carrierId: string | null;
  documentRef: string;
  vehicle: string;
  notes: string;
}

export interface MovementsQuery {
  page: number;
  pageSize: number;
  cursor?: string | undefined;
  wasteId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sandach?: boolean | undefined;
}

const movementSelect = {
  id: true,
  date: true,
  quantity: true,
  unit: true,
  managerId: true,
  carrierId: true,
  documentRef: true,
  vehicle: true,
  notes: true,
  recordedById: true,
  createdAt: true,
  waste: {
    select: { id: true, name: true, ler: true, hazardous: true, sandach: true, operation: true },
  },
} as const;

type MovementRow = Prisma.EnvWasteMovementGetPayload<{ select: typeof movementSelect }>;

async function movementViews(db: TenantDb, rows: MovementRow[]): Promise<MovementView[]> {
  const companies = await contractorNames(db, [
    ...rows.map((row) => row.managerId),
    ...rows.map((row) => row.carrierId),
  ]);
  const recorders = await db.membership.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.recordedById))] } },
    select: { id: true, user: { select: { name: true } } },
  });
  const who = new Map(recorders.map((row) => [row.id, row.user.name]));
  return rows.map((row) => ({
    id: row.id,
    date: dayOf(row.date),
    waste: {
      id: row.waste.id,
      name: row.waste.name,
      ler: row.waste.ler,
      hazardous: row.waste.hazardous,
      sandach: row.waste.sandach,
    },
    quantity: row.quantity.toNumber(),
    unit: row.unit,
    manager:
      row.managerId === null
        ? null
        : {
            id: row.managerId,
            name: companies.get(row.managerId)?.name ?? "",
            nima: companies.get(row.managerId)?.nima ?? null,
          },
    carrier:
      row.carrierId === null
        ? null
        : { id: row.carrierId, name: companies.get(row.carrierId)?.name ?? "" },
    operation: row.waste.operation,
    documentRef: row.documentRef,
    vehicle: row.vehicle,
    notes: row.notes,
    recordedBy: who.get(row.recordedById) ?? "",
    createdAt: row.createdAt,
  }));
}

function movementsWhere(ctx: AdminContext, query: Omit<MovementsQuery, "page" | "pageSize">) {
  return {
    AND: [
      // environment.record alone sees the collections it recorded.
      canViewEnvironment(ctx) ? {} : { recordedById: ctx.tenant.membershipId },
      query.wasteId === undefined ? {} : { wasteId: query.wasteId },
      query.from === undefined ? {} : { date: { gte: dateOf(query.from) } },
      query.to === undefined ? {} : { date: { lte: dateOf(query.to) } },
      query.sandach === true ? { waste: { sandach: { not: null } } } : {},
    ],
  } satisfies Prisma.EnvWasteMovementWhereInput;
}

export async function listMovements(
  ctx: AdminContext,
  query: MovementsQuery,
): Promise<Page<MovementView>> {
  await requireCatalog(ctx);
  const where = movementsWhere(ctx, query);
  const [rows, total] = await Promise.all([
    ctx.db.envWasteMovement.findMany({
      where,
      select: movementSelect,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      ...offsetArgs(query),
    }),
    ctx.db.envWasteMovement.count({ where }),
  ]);
  return pageOf(await movementViews(ctx.db, rows), total, query);
}

/**
 * A collection. The manager and carrier default to the waste's; the waste's storage starts again from
 * that day (if it's the latest).
 */
export async function createMovement(
  ctx: AdminContext,
  input: MovementInput,
): Promise<MovementView> {
  await requireRecord(ctx);
  const waste = await ctx.db.envWaste.findFirst({
    where: { id: input.wasteId },
    select: { ...wasteSelect },
  });
  if (waste === null) throw notFound();
  if (waste.archivedAt !== null) throw invalid(environmentTexts.errors.archived);
  const managerId = input.managerId ?? waste.managerId;
  const carrierId = input.carrierId ?? waste.carrierId;
  await assertContractor(ctx.db, managerId, "manager");
  await assertContractor(ctx.db, carrierId, "carrier");
  const today = await companyToday(ctx.db);
  const date = input.date > today ? today : input.date;
  const row = await ctx.db.envWasteMovement.create({
    data: {
      wasteId: waste.id,
      date: dateOf(date),
      quantity: input.quantity,
      unit: input.unit,
      managerId,
      carrierId,
      documentRef: input.documentRef,
      vehicle: input.vehicle,
      notes: input.notes,
      recordedById: ctx.tenant.membershipId,
    },
    select: movementSelect,
  });
  if (waste.storageSince === null || dayOf(waste.storageSince) < date) {
    const updated = await ctx.db.envWaste.update({
      where: { id: waste.id },
      data: { storageSince: dateOf(date) },
      select: wasteSelect,
    });
    await syncStorageExpiry(ctx.db, updated);
  }
  await auditAdmin(ctx, {
    action: "environment.waste.collect",
    entityType: "EnvWasteMovement",
    entityId: row.id,
    metadata: { waste: waste.name, date, quantity: input.quantity, unit: input.unit },
  });
  return (await movementViews(ctx.db, [row]))[0] as MovementView;
}

/** Correcting a mistake: only environment.manage, and it stays in the audit log. */
export async function deleteMovement(ctx: AdminContext, id: string): Promise<void> {
  await requireManage(ctx);
  const row = await ctx.db.envWasteMovement.findFirst({ where: { id }, select: movementSelect });
  if (row === null) throw notFound();
  await ctx.db.envWasteMovement.delete({ where: { id }, select: { id: true } });
  await auditAdmin(ctx, {
    action: "environment.waste.collect.delete",
    entityType: "EnvWasteMovement",
    entityId: id,
    metadata: {
      waste: row.waste.name,
      date: dayOf(row.date),
      quantity: row.quantity.toNumber(),
      unit: row.unit,
      documentRef: row.documentRef,
    },
  });
}

/** Every collection in a period, for the exports (oldest first, as a chronological record is read). */
export async function movementsForExport(
  ctx: AdminContext,
  query: { from: string; to: string; sandach: boolean },
): Promise<MovementView[]> {
  const where = movementsWhere(ctx, query);
  const total = await ctx.db.envWasteMovement.count({ where });
  if (total > environmentLimits.exportMaxRows) {
    throw invalid(environmentTexts.errors.tooMany);
  }
  const rows = await ctx.db.envWasteMovement.findMany({
    where,
    select: movementSelect,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return await movementViews(ctx.db, rows);
}
