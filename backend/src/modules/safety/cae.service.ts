// CAE companies and their workers (docs/spec/cae.md): new ones, changes, block and archive (never
// deleted), each company's folder inside «Contratas» and the computed authorization of each.
//
// Who sees what: `cae.manage` everything; the internal responsible person their companies whole;
// `cae.check` only names, company, state and reasons (no contact details, no documents, the identity
// document cut to its last 3 characters). Only `cae.manage` changes anything. Another tenant's
// resource, or one the person can't see, answers 404.
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { caeTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { syncCompanyFolder } from "./cae-folders.ts";
import {
  authorizedCompanyWhere,
  companyStatusOf,
  companyStatuses,
  dayOfDate,
  workerStatuses,
  type CaeState,
  type CaeStatus,
} from "./cae-status.ts";
import type {
  CreateCompanyInput,
  CreateWorkerInput,
  ListCompaniesQuery,
  ListWorkersQuery,
  UpdateCompanyInput,
  UpdateWorkerInput,
} from "./cae.schemas.ts";
import { canCheckCae, canManageCae, requireCae } from "./safety-access.ts";

type Kind = "CONTRACTOR" | "SUBCONTRACTOR" | "CONCURRENT";

/** What the status says, without the per-requirement detail (lists, cae.check). */
export interface StatusSummary {
  authorized: boolean;
  state: CaeState;
  reasons: string[];
}

const summaryOf = (status: CaeStatus): StatusSummary => ({
  authorized: status.authorized,
  state: status.state,
  reasons: status.reasons,
});

export interface CompanyRow {
  id: string;
  name: string;
  kind: Kind;
  parent: { id: string; name: string } | null;
  /** null for whoever only checks (cae.check). */
  responsible: { id: string; name: string } | null;
  activity: string | null;
  workers: number | null;
  status: StatusSummary;
}

export interface CompanyDetail extends CompanyRow {
  /** false: only what cae.check sees (the rest comes null). */
  full: boolean;
  canManage: boolean;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  startsOn: string | null;
  endsOn: string | null;
  blocked: { at: Date; reason: string } | null;
  archivedAt: Date | null;
  folder: { id: string; spaceId: string; name: string } | null;
  requirements: CaeStatus["requirements"];
}

const companySelect = {
  id: true,
  name: true,
  taxId: true,
  kind: true,
  parentId: true,
  activity: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  responsibleId: true,
  startsOn: true,
  endsOn: true,
  blockedAt: true,
  blockedReason: true,
  archivedAt: true,
  folderId: true,
} as const;

type CompanyRecord = Prisma.CaeCompanyGetPayload<{ select: typeof companySelect }>;

// ─── Access ──────────────────────────────────────────────────────────────────────────────

/** How much the person sees of CAE: everything, their companies, or only the authorization. */
interface CaeAccess {
  manage: boolean;
  check: boolean;
  /** Companies where they're the internal responsible person. */
  responsibleOf: (company: { responsibleId: string }) => boolean;
}

async function accessOf(ctx: AdminContext): Promise<CaeAccess> {
  await requireCae(ctx);
  const me = ctx.tenant.membershipId;
  return {
    manage: canManageCae(ctx),
    check: canCheckCae(ctx),
    responsibleOf: (company) => company.responsibleId === me,
  };
}

const seesWhole = (access: CaeAccess, company: { responsibleId: string }) =>
  access.manage || access.responsibleOf(company);

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canManageCae(ctx)) throw forbidden();
}

/** The companies the person sees in lists: all with manage or check; otherwise only theirs. */
async function visibleCompanies(
  ctx: AdminContext,
  access: CaeAccess,
): Promise<Prisma.CaeCompanyWhereInput> {
  if (access.manage || access.check) return {};
  const mine = await ctx.db.caeCompany.count({
    where: { responsibleId: ctx.tenant.membershipId },
  });
  if (mine === 0) throw forbidden();
  return { responsibleId: ctx.tenant.membershipId };
}

/** A company the person sees (otherwise 404). */
async function loadCompany(
  ctx: AdminContext,
  access: CaeAccess,
  id: string,
): Promise<CompanyRecord> {
  const row = await ctx.db.caeCompany.findFirst({ where: { id }, select: companySelect });
  if (row === null) throw notFound();
  if (!access.manage && !access.check && !access.responsibleOf(row)) throw notFound();
  return row;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────

async function namesOf(ctx: AdminContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

const dateOf = (day: string | null | undefined): Date | null | undefined =>
  day === undefined ? undefined : day === null ? null : new Date(`${day}T00:00:00Z`);

async function assertNameFree(ctx: AdminContext, name: string, exceptId?: string) {
  const taken = await ctx.db.caeCompany.findFirst({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.companyNameTaken });
  }
}

async function assertResponsible(ctx: AdminContext, membershipId: string): Promise<void> {
  const found = await ctx.db.membership.count({
    where: { id: membershipId, status: "ACTIVE", role: { base: { not: "GUEST" } } },
  });
  if (found === 0) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.responsibleInvalid });
  }
}

/** A subcontractor depends on an active contractor; nobody else depends on anyone. */
async function assertParent(
  ctx: AdminContext,
  kind: Kind,
  parentId: string | null,
  selfId?: string,
): Promise<void> {
  const m = caeTexts.messages;
  if (kind !== "SUBCONTRACTOR") {
    if (parentId !== null)
      throw new AppError("BAD_REQUEST", { message: m.parentOnlySubcontractor });
    return;
  }
  if (parentId === null) throw new AppError("BAD_REQUEST", { message: m.parentRequired });
  if (parentId === selfId) throw new AppError("BAD_REQUEST", { message: m.parentInvalid });
  const parent = await ctx.db.caeCompany.count({
    where: { id: parentId, kind: "CONTRACTOR", archivedAt: null },
  });
  if (parent === 0) throw new AppError("BAD_REQUEST", { message: m.parentInvalid });
}

function assertDates(startsOn: Date | null, endsOn: Date | null): void {
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.datesInverted });
  }
}

function assertNotArchived(row: { archivedAt: Date | null }): void {
  if (row.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.archived });
  }
}

/** The Prisma filter of a list state (authorized and incomplete computed as caeStatus does). */
async function companyStateWhere(
  ctx: AdminContext,
  state: CaeState | undefined,
): Promise<Prisma.CaeCompanyWhereInput> {
  switch (state) {
    case undefined:
      return { archivedAt: null };
    case "archived":
      return { archivedAt: { not: null } };
    case "blocked":
      return { archivedAt: null, blockedAt: { not: null } };
    case "authorized":
      return await authorizedCompanyWhere(ctx);
    case "incomplete":
      return {
        archivedAt: null,
        blockedAt: null,
        NOT: await authorizedCompanyWhere(ctx),
      };
  }
}

// ─── Companies ───────────────────────────────────────────────────────────────────────────

export async function listCompanies(
  ctx: AdminContext,
  query: ListCompaniesQuery,
): Promise<Page<CompanyRow>> {
  const access = await accessOf(ctx);
  const where: Prisma.CaeCompanyWhereInput = {
    AND: [
      await visibleCompanies(ctx, access),
      await companyStateWhere(ctx, query.status),
      query.ids === undefined ? {} : { id: { in: query.ids } },
      query.kind === undefined ? {} : { kind: query.kind },
      query.q === undefined || query.q === ""
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              ...(access.manage
                ? [{ taxId: { contains: query.q, mode: "insensitive" as const } }]
                : []),
            ],
          },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.caeCompany.findMany({
      where,
      select: companySelect,
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.caeCompany.count({ where }),
  ]);
  return pageOf(await companyRows(ctx, access, rows), total, query);
}

async function companyRows(
  ctx: AdminContext,
  access: CaeAccess,
  rows: CompanyRecord[],
): Promise<CompanyRow[]> {
  const ids = rows.map((row) => row.id);
  const parentIds = rows.map((row) => row.parentId).filter((id): id is string => id !== null);
  const [statuses, names, parents, workers] = await Promise.all([
    companyStatuses(ctx, rows),
    namesOf(
      ctx,
      rows.filter((row) => seesWhole(access, row)).map((row) => row.responsibleId),
    ),
    parentIds.length === 0
      ? Promise.resolve([])
      : ctx.db.caeCompany.findMany({
          where: { id: { in: [...new Set(parentIds)] } },
          select: { id: true, name: true },
        }),
    ctx.db.caeWorker.groupBy({
      by: ["companyId"],
      where: { companyId: { in: ids }, archivedAt: null },
      _count: { _all: true },
    }),
  ]);
  const parentName = new Map(parents.map((parent) => [parent.id, parent.name]));
  const workerCount = new Map(workers.map((row) => [row.companyId, row._count._all]));
  return rows.map((row) => {
    const whole = seesWhole(access, row);
    const status = statuses.get(row.id);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      parent:
        row.parentId === null
          ? null
          : { id: row.parentId, name: parentName.get(row.parentId) ?? "" },
      responsible: whole
        ? { id: row.responsibleId, name: names.get(row.responsibleId) ?? "" }
        : null,
      activity: whole ? row.activity : null,
      workers: workerCount.get(row.id) ?? 0,
      status:
        status === undefined
          ? { authorized: false, state: "incomplete", reasons: [] }
          : summaryOf(status),
    };
  });
}

async function companyDetail(
  ctx: AdminContext,
  access: CaeAccess,
  row: CompanyRecord,
): Promise<CompanyDetail> {
  const whole = seesWhole(access, row);
  const [[base], status, folder] = await Promise.all([
    companyRows(ctx, access, [row]),
    companyStatusOf(ctx, row),
    whole && row.folderId !== null
      ? ctx.db.node.findFirst({
          where: { id: row.folderId, trashedAt: null },
          select: { id: true, spaceId: true, name: true },
        })
      : Promise.resolve(null),
  ]);
  if (base === undefined) throw notFound();
  return {
    ...base,
    full: whole,
    canManage: access.manage,
    taxId: whole ? row.taxId : null,
    contactName: whole ? row.contactName : null,
    contactEmail: whole ? row.contactEmail : null,
    contactPhone: whole ? row.contactPhone : null,
    startsOn: dayOfDate(row.startsOn),
    endsOn: dayOfDate(row.endsOn),
    blocked: row.blockedAt === null ? null : { at: row.blockedAt, reason: row.blockedReason ?? "" },
    archivedAt: row.archivedAt,
    folder,
    requirements: whole ? status.requirements : [],
  };
}

export async function getCompany(ctx: AdminContext, id: string): Promise<CompanyDetail> {
  const access = await accessOf(ctx);
  return await companyDetail(ctx, access, await loadCompany(ctx, access, id));
}

export async function createCompany(
  ctx: AdminContext,
  input: CreateCompanyInput,
): Promise<CompanyDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const name = cleanName(input.name);
  await assertNameFree(ctx, name);
  await assertResponsible(ctx, input.responsibleId);
  await assertParent(ctx, input.kind, input.parentId ?? null);
  const startsOn = dateOf(input.startsOn) ?? null;
  const endsOn = dateOf(input.endsOn) ?? null;
  assertDates(startsOn, endsOn);
  const created = await ctx.db.caeCompany.create({
    data: {
      name,
      nameKey: nameKeyOf(name),
      taxId: input.taxId ?? null,
      kind: input.kind,
      parentId: input.parentId ?? null,
      activity: input.activity,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      responsibleId: input.responsibleId,
      startsOn,
      endsOn,
    },
    select: companySelect,
  });
  const folderId = await syncCompanyFolder(ctx, { name, folderId: null });
  const row =
    folderId === null
      ? created
      : await ctx.db.caeCompany.update({
          where: { id: created.id },
          data: { folderId },
          select: companySelect,
        });
  await auditAdmin(ctx, {
    action: "cae.company.create",
    entityType: "CaeCompany",
    entityId: row.id,
    metadata: { name: row.name, kind: row.kind },
  });
  return await companyDetail(ctx, access, row);
}

export async function updateCompany(
  ctx: AdminContext,
  id: string,
  input: UpdateCompanyInput,
): Promise<CompanyDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadCompany(ctx, access, id);
  assertNotArchived(current);
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) await assertNameFree(ctx, name, id);
  if (input.responsibleId !== undefined) await assertResponsible(ctx, input.responsibleId);
  const kind = input.kind ?? current.kind;
  const parentId =
    input.parentId !== undefined
      ? input.parentId
      : kind === "SUBCONTRACTOR"
        ? current.parentId
        : null;
  if (input.kind !== undefined || input.parentId !== undefined) {
    await assertParent(ctx, kind, parentId, id);
    // A contractor with subcontractors stays a contractor.
    if (current.kind === "CONTRACTOR" && kind !== "CONTRACTOR") {
      const children = await ctx.db.caeCompany.count({ where: { parentId: id, archivedAt: null } });
      if (children > 0) {
        throw new AppError("CONFLICT", { message: caeTexts.messages.hasSubcontractors });
      }
    }
  }
  const startsOn = dateOf(input.startsOn);
  const endsOn = dateOf(input.endsOn);
  assertDates(
    startsOn === undefined ? current.startsOn : startsOn,
    endsOn === undefined ? current.endsOn : endsOn,
  );
  let row = await ctx.db.caeCompany.update({
    where: { id },
    data: {
      ...(name === undefined ? {} : { name, nameKey: nameKeyOf(name) }),
      ...(input.taxId === undefined ? {} : { taxId: input.taxId }),
      kind,
      parentId,
      ...(input.activity === undefined ? {} : { activity: input.activity }),
      ...(input.contactName === undefined ? {} : { contactName: input.contactName }),
      ...(input.contactEmail === undefined ? {} : { contactEmail: input.contactEmail }),
      ...(input.contactPhone === undefined ? {} : { contactPhone: input.contactPhone }),
      ...(input.responsibleId === undefined ? {} : { responsibleId: input.responsibleId }),
      ...(startsOn === undefined ? {} : { startsOn }),
      ...(endsOn === undefined ? {} : { endsOn }),
    },
    select: companySelect,
  });
  // Renaming the company renames its folder (or recreates it if it went to the trash).
  if (name !== undefined && name !== current.name) {
    const folderId = await syncCompanyFolder(ctx, { name, folderId: current.folderId });
    if (folderId !== current.folderId) {
      row = await ctx.db.caeCompany.update({
        where: { id },
        data: { folderId },
        select: companySelect,
      });
    }
  }
  await auditAdmin(ctx, {
    action: "cae.company.update",
    entityType: "CaeCompany",
    entityId: id,
    metadata: {
      name: row.name,
      changed: Object.keys(input),
      ...(name !== undefined && name !== current.name ? { renamedFrom: current.name } : {}),
    },
  });
  return await companyDetail(ctx, access, row);
}

export async function blockCompany(
  ctx: AdminContext,
  id: string,
  reason: string,
): Promise<CompanyDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadCompany(ctx, access, id);
  assertNotArchived(current);
  if (current.blockedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.alreadyBlocked });
  }
  const row = await ctx.db.caeCompany.update({
    where: { id },
    data: { blockedAt: new Date(), blockedReason: reason },
    select: companySelect,
  });
  await auditAdmin(ctx, {
    action: "cae.company.block",
    entityType: "CaeCompany",
    entityId: id,
    metadata: { name: row.name, reason },
  });
  return await companyDetail(ctx, access, row);
}

export async function unblockCompany(ctx: AdminContext, id: string): Promise<CompanyDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadCompany(ctx, access, id);
  assertNotArchived(current);
  if (current.blockedAt === null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.notBlocked });
  }
  const row = await ctx.db.caeCompany.update({
    where: { id },
    data: { blockedAt: null, blockedReason: null },
    select: companySelect,
  });
  await auditAdmin(ctx, {
    action: "cae.company.unblock",
    entityType: "CaeCompany",
    entityId: id,
    metadata: { name: row.name, reason: current.blockedReason ?? "" },
  });
  return await companyDetail(ctx, access, row);
}

/** Archived instead of deleted: it keeps its workers, documents and folder, and isn't authorized. */
export async function archiveCompany(ctx: AdminContext, id: string): Promise<CompanyDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadCompany(ctx, access, id);
  if (current.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.alreadyArchived });
  }
  if (current.kind === "CONTRACTOR") {
    const children = await ctx.db.caeCompany.count({ where: { parentId: id, archivedAt: null } });
    if (children > 0) {
      throw new AppError("CONFLICT", { message: caeTexts.messages.hasSubcontractors });
    }
  }
  const row = await ctx.db.caeCompany.update({
    where: { id },
    data: { archivedAt: new Date() },
    select: companySelect,
  });
  await auditAdmin(ctx, {
    action: "cae.company.archive",
    entityType: "CaeCompany",
    entityId: id,
    metadata: { name: row.name },
  });
  return await companyDetail(ctx, access, row);
}

// ─── Workers ─────────────────────────────────────────────────────────────────────────────

export interface WorkerRow {
  id: string;
  name: string;
  /** Whole for cae.manage and the responsible person; the last 3 characters for cae.check. */
  idNumber: string | null;
  task: string | null;
  company: { id: string; name: string; kind: Kind };
  status: StatusSummary;
}

export interface WorkerDetail extends WorkerRow {
  full: boolean;
  canManage: boolean;
  blocked: { at: Date; reason: string } | null;
  archivedAt: Date | null;
  requirements: CaeStatus["requirements"];
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
  company: { select: { id: true, name: true, kind: true, responsibleId: true } },
} as const;

type WorkerRecord = Prisma.CaeWorkerGetPayload<{ select: typeof workerSelect }>;

/** «•••123»: enough to tell two people apart at the gate. */
const maskedId = (value: string): string => `•••${value.slice(-3)}`;

async function workerRows(
  ctx: AdminContext,
  access: CaeAccess,
  rows: WorkerRecord[],
): Promise<{ rows: WorkerRow[]; statuses: Map<string, CaeStatus> }> {
  const statuses = await workerStatuses(ctx, rows);
  return {
    statuses,
    rows: rows.map((row) => {
      const whole = seesWhole(access, row.company);
      const status = statuses.get(row.id);
      return {
        id: row.id,
        name: row.name,
        idNumber: row.idNumber === null ? null : whole ? row.idNumber : maskedId(row.idNumber),
        task: row.task,
        company: { id: row.company.id, name: row.company.name, kind: row.company.kind },
        status:
          status === undefined
            ? { authorized: false, state: "incomplete", reasons: [] }
            : summaryOf(status),
      };
    }),
  };
}

async function workerDetail(
  ctx: AdminContext,
  access: CaeAccess,
  row: WorkerRecord,
): Promise<WorkerDetail> {
  const whole = seesWhole(access, row.company);
  const { rows, statuses } = await workerRows(ctx, access, [row]);
  const [base] = rows;
  if (base === undefined) throw notFound();
  return {
    ...base,
    full: whole,
    canManage: access.manage,
    blocked: row.blockedAt === null ? null : { at: row.blockedAt, reason: row.blockedReason ?? "" },
    archivedAt: row.archivedAt,
    requirements: whole ? (statuses.get(row.id)?.requirements ?? []) : [],
  };
}

async function workerStateWhere(
  ctx: AdminContext,
  state: CaeState | undefined,
): Promise<Prisma.CaeWorkerWhereInput> {
  switch (state) {
    case undefined:
      return { archivedAt: null };
    case "archived":
      return { archivedAt: { not: null } };
    case "blocked":
      return { archivedAt: null, blockedAt: { not: null } };
    case "authorized":
      return {
        archivedAt: null,
        blockedAt: null,
        company: { is: await authorizedCompanyWhere(ctx, ["COMPANY", "WORKER"]) },
      };
    case "incomplete":
      return {
        archivedAt: null,
        blockedAt: null,
        NOT: { company: { is: await authorizedCompanyWhere(ctx, ["COMPANY", "WORKER"]) } },
      };
  }
}

async function listWorkersWhere(
  ctx: AdminContext,
  access: CaeAccess,
  base: Prisma.CaeWorkerWhereInput,
  query: ListWorkersQuery,
): Promise<Page<WorkerRow>> {
  const where: Prisma.CaeWorkerWhereInput = {
    AND: [
      base,
      await workerStateWhere(ctx, query.status),
      query.q === undefined || query.q === ""
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { idNumber: { contains: query.q, mode: "insensitive" } },
            ],
          },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.caeWorker.findMany({
      where,
      select: workerSelect,
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.caeWorker.count({ where }),
  ]);
  return pageOf((await workerRows(ctx, access, rows)).rows, total, query);
}

/** A company's workers. */
export async function listCompanyWorkers(
  ctx: AdminContext,
  companyId: string,
  query: ListWorkersQuery,
): Promise<Page<WorkerRow>> {
  const access = await accessOf(ctx);
  await loadCompany(ctx, access, companyId);
  return await listWorkersWhere(ctx, access, { companyId }, query);
}

/** Every worker the person sees (the gatehouse, phase 3). */
export async function listWorkers(
  ctx: AdminContext,
  query: ListWorkersQuery,
): Promise<Page<WorkerRow>> {
  const access = await accessOf(ctx);
  const companies = await visibleCompanies(ctx, access);
  return await listWorkersWhere(
    ctx,
    access,
    Object.keys(companies).length === 0 ? {} : { company: { is: companies } },
    query,
  );
}

async function loadWorker(ctx: AdminContext, access: CaeAccess, id: string): Promise<WorkerRecord> {
  const row = await ctx.db.caeWorker.findFirst({ where: { id }, select: workerSelect });
  if (row === null) throw notFound();
  if (!access.manage && !access.check && !access.responsibleOf(row.company)) throw notFound();
  return row;
}

export async function getWorker(ctx: AdminContext, id: string): Promise<WorkerDetail> {
  const access = await accessOf(ctx);
  return await workerDetail(ctx, access, await loadWorker(ctx, access, id));
}

export async function createWorker(
  ctx: AdminContext,
  companyId: string,
  input: CreateWorkerInput,
): Promise<WorkerDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const company = await loadCompany(ctx, access, companyId);
  assertNotArchived(company);
  const created = await ctx.db.caeWorker.create({
    data: {
      companyId,
      name: cleanName(input.name),
      idNumber: input.idNumber ?? null,
      task: input.task ?? null,
    },
    select: { id: true },
  });
  const row = await loadWorker(ctx, access, created.id);
  // Personal data stays out of the log: the name and the company.
  await auditAdmin(ctx, {
    action: "cae.worker.create",
    entityType: "CaeWorker",
    entityId: row.id,
    metadata: { name: row.name, companyId, company: company.name },
  });
  return await workerDetail(ctx, access, row);
}

function assertWorkerNotArchived(row: { archivedAt: Date | null }): void {
  if (row.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.workerArchived });
  }
}

export async function updateWorker(
  ctx: AdminContext,
  id: string,
  input: UpdateWorkerInput,
): Promise<WorkerDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadWorker(ctx, access, id);
  assertWorkerNotArchived(current);
  await ctx.db.caeWorker.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: cleanName(input.name) }),
      ...(input.idNumber === undefined ? {} : { idNumber: input.idNumber }),
      ...(input.task === undefined ? {} : { task: input.task }),
    },
    select: { id: true },
  });
  const row = await loadWorker(ctx, access, id);
  await auditAdmin(ctx, {
    action: "cae.worker.update",
    entityType: "CaeWorker",
    entityId: id,
    metadata: { name: row.name, companyId: row.companyId, changed: Object.keys(input) },
  });
  return await workerDetail(ctx, access, row);
}

export async function blockWorker(
  ctx: AdminContext,
  id: string,
  reason: string,
): Promise<WorkerDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadWorker(ctx, access, id);
  assertWorkerNotArchived(current);
  if (current.blockedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.alreadyBlocked });
  }
  await ctx.db.caeWorker.update({
    where: { id },
    data: { blockedAt: new Date(), blockedReason: reason },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.worker.block",
    entityType: "CaeWorker",
    entityId: id,
    metadata: { name: current.name, companyId: current.companyId, reason },
  });
  return await workerDetail(ctx, access, await loadWorker(ctx, access, id));
}

export async function unblockWorker(ctx: AdminContext, id: string): Promise<WorkerDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadWorker(ctx, access, id);
  assertWorkerNotArchived(current);
  if (current.blockedAt === null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.notBlocked });
  }
  await ctx.db.caeWorker.update({
    where: { id },
    data: { blockedAt: null, blockedReason: null },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.worker.unblock",
    entityType: "CaeWorker",
    entityId: id,
    metadata: { name: current.name, companyId: current.companyId },
  });
  return await workerDetail(ctx, access, await loadWorker(ctx, access, id));
}

export async function archiveWorker(ctx: AdminContext, id: string): Promise<WorkerDetail> {
  await requireManager(ctx);
  const access = await accessOf(ctx);
  const current = await loadWorker(ctx, access, id);
  if (current.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.alreadyArchived });
  }
  await ctx.db.caeWorker.update({
    where: { id },
    data: { archivedAt: new Date() },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "cae.worker.archive",
    entityType: "CaeWorker",
    entityId: id,
    metadata: { name: current.name, companyId: current.companyId },
  });
  return await workerDetail(ctx, access, await loadWorker(ctx, access, id));
}
