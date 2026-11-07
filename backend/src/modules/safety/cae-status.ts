// Whether a contractor or one of its workers can work at the site (docs/spec/cae.md, «Estado y
// autorización»): computed, never stored, always with readable reasons. The same function serves the
// API, the lists, the gatehouse and the PDF.
//
// Each requirement's state comes from its documents (loadDocuments): the current one is the ACCEPTED one
// not superseded; a newer PENDING or REJECTED one is shown next to it. The list filters
// (`authorizedCompanyWhere`, `authorizedWorkerWhere`) apply the same rules in the database.
import type {
  CaeAppliesTo,
  CaeCompanyKind,
  CaeScope,
  Prisma,
} from "../../generated/prisma/client.ts";
import { caeTexts } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { DEFAULT_NOTICE_DAYS } from "../expiries/expiries.service.ts";
import { expiryState } from "../expiries/expiry-rules.ts";

export type CaeRequirementState =
  "ok" | "due_soon" | "expired" | "pending" | "rejected" | "missing";

/** What a list shows: authorized, incomplete (something missing or out of dates), blocked, archived. */
export type CaeState = "authorized" | "incomplete" | "blocked" | "archived";

export interface CaeRequirementRef {
  id: string;
  name: string;
  scope: CaeScope;
  appliesTo: CaeAppliesTo;
  required: boolean;
  validityMonths: number | null;
}

/** A document as the status shows it. */
export interface CaeDocumentRef {
  id: string;
  nodeId: string;
  /** The file's name; null once it's gone to the trash. */
  fileName: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  validUntil: string | null;
  rejectReason: string | null;
  createdAt: Date;
}

export interface CaeRequirementStatus {
  requirement: { id: string; name: string; required: boolean; validityMonths: number | null };
  state: CaeRequirementState;
  /** «YYYY-MM-DD» of the current document, if it has one. */
  validUntil: string | null;
  /** The current (accepted) document. */
  current: CaeDocumentRef | null;
  /** A newer one, pending or rejected. */
  latest: CaeDocumentRef | null;
}

export interface CaeStatus {
  authorized: boolean;
  state: CaeState;
  reasons: string[];
  requirements: CaeRequirementStatus[];
}

/** A requirement's documents for one company or worker: its state and the documents behind it. */
export interface CurrentDocument {
  state: Exclude<CaeRequirementState, "missing">;
  validUntil: string | null;
  current: CaeDocumentRef | null;
  latest: CaeDocumentRef | null;
}

/** requirementId → its current document, for one company or one worker. */
export type CurrentDocuments = ReadonlyMap<string, CurrentDocument>;

const none: CurrentDocuments = new Map();

/** A subcontractor goes with the contractors. */
export function appliesToKind(appliesTo: CaeAppliesTo, kind: CaeCompanyKind): boolean {
  if (appliesTo === "ALL") return true;
  return appliesTo === "CONCURRENT" ? kind === "CONCURRENT" : kind !== "CONCURRENT";
}

/** «03/11/2026» in the request's language. */
function shortDay(day: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** «YYYY-MM-DD» of a DATE column. */
export const dayOfDate = (date: Date | null): string | null =>
  date === null ? null : date.toISOString().slice(0, 10);

function requirementStatuses(
  requirements: readonly CaeRequirementRef[],
  documents: CurrentDocuments,
): CaeRequirementStatus[] {
  return requirements.map((requirement) => {
    const current = documents.get(requirement.id);
    return {
      requirement: {
        id: requirement.id,
        name: requirement.name,
        required: requirement.required,
        validityMonths: requirement.validityMonths,
      },
      state: current?.state ?? "missing",
      validUntil: current?.validUntil ?? null,
      current: current?.current ?? null,
      latest: current?.latest ?? null,
    };
  });
}

/** Why the required documents don't authorize (ok and due soon do). */
function documentReasons(statuses: readonly CaeRequirementStatus[]): string[] {
  const r = caeTexts.reasons;
  return statuses
    .filter((status) => status.requirement.required)
    .flatMap((status) => {
      const name = status.requirement.name;
      switch (status.state) {
        case "ok":
        case "due_soon":
          return [];
        case "expired":
          return [
            status.validUntil === null
              ? r.missing(name)
              : r.expired(shortDay(status.validUntil), name),
          ];
        case "pending":
          return [r.pending(name)];
        case "rejected":
          return [r.rejected(name)];
        case "missing":
          return [r.missing(name)];
      }
    });
}

export interface CompanyForStatus {
  name: string;
  kind: CaeCompanyKind;
  blockedAt: Date | null;
  blockedReason: string | null;
  archivedAt: Date | null;
  startsOn: Date | null;
  endsOn: Date | null;
}

/**
 * A company is authorized when it isn't blocked nor archived, today is within its dates and every
 * required company document that applies to it is ok or due soon. A subcontractor also needs its
 * contractor authorized.
 */
export function companyStatus(input: {
  company: CompanyForStatus;
  /** The catalog's active requirements (both scopes: only the company ones count here). */
  requirements: readonly CaeRequirementRef[];
  documents?: CurrentDocuments;
  /** The company's day, «YYYY-MM-DD». */
  today: string;
  parent?: { name: string; status: CaeStatus } | null;
}): CaeStatus {
  const { company, today } = input;
  const r = caeTexts.reasons;
  const applicable = input.requirements.filter(
    (requirement) =>
      requirement.scope === "COMPANY" && appliesToKind(requirement.appliesTo, company.kind),
  );
  const requirements = requirementStatuses(applicable, input.documents ?? none);
  const reasons: string[] = [];
  if (company.archivedAt !== null) reasons.push(r.companyArchived);
  if (company.blockedAt !== null) reasons.push(r.companyBlocked(company.blockedReason ?? ""));
  const starts = dayOfDate(company.startsOn);
  const ends = dayOfDate(company.endsOn);
  if (starts !== null && today < starts) reasons.push(r.notStarted(shortDay(starts)));
  if (ends !== null && today > ends) reasons.push(r.ended(shortDay(ends)));
  if (company.kind === "SUBCONTRACTOR" && input.parent != null && !input.parent.status.authorized) {
    reasons.push(r.parentNotAuthorized(input.parent.name));
  }
  reasons.push(...documentReasons(requirements));
  const authorized = reasons.length === 0;
  return {
    authorized,
    state:
      company.archivedAt !== null
        ? "archived"
        : company.blockedAt !== null
          ? "blocked"
          : authorized
            ? "authorized"
            : "incomplete",
    reasons,
    requirements,
  };
}

export interface WorkerForStatus {
  blockedAt: Date | null;
  blockedReason: string | null;
  archivedAt: Date | null;
}

/**
 * A worker is authorized when their company is, they aren't blocked nor archived and every required
 * worker document that applies to their company is ok or due soon.
 */
export function workerStatus(input: {
  worker: WorkerForStatus;
  company: { name: string; kind: CaeCompanyKind; status: CaeStatus };
  requirements: readonly CaeRequirementRef[];
  documents?: CurrentDocuments;
}): CaeStatus {
  const { worker, company } = input;
  const r = caeTexts.reasons;
  const applicable = input.requirements.filter(
    (requirement) =>
      requirement.scope === "WORKER" && appliesToKind(requirement.appliesTo, company.kind),
  );
  const requirements = requirementStatuses(applicable, input.documents ?? none);
  const reasons: string[] = [];
  if (worker.archivedAt !== null) reasons.push(r.workerArchived);
  if (worker.blockedAt !== null) reasons.push(r.workerBlocked(worker.blockedReason ?? ""));
  if (!company.status.authorized) reasons.push(r.companyNotAuthorized(company.name));
  reasons.push(...documentReasons(requirements));
  const authorized = reasons.length === 0;
  return {
    authorized,
    state:
      worker.archivedAt !== null
        ? "archived"
        : worker.blockedAt !== null
          ? "blocked"
          : authorized
            ? "authorized"
            : "incomplete",
    reasons,
    requirements,
  };
}

// ─── Loading ─────────────────────────────────────────────────────────────────────────────

/** The company's day and the catalog's active requirements, in order. */
export async function statusContext(
  ctx: Pick<AdminContext, "db">,
): Promise<{ today: string; requirements: CaeRequirementRef[] }> {
  const [workspace, requirements] = await Promise.all([
    ctx.db.workspace.findFirst({ where: {}, select: { settings: true } }),
    ctx.db.caeRequirement.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        scope: true,
        appliesTo: true,
        required: true,
        validityMonths: true,
      },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
  ]);
  return { today: dayIn(new Date(), zoneOf(workspace?.settings)), requirements };
}

/** The state of one requirement from its documents, newest first. */
export function documentState(
  documents: readonly CaeDocumentRef[],
  today: string,
): CurrentDocument | null {
  if (documents.length === 0) return null;
  const current = documents.find((doc) => doc.status === "ACCEPTED") ?? null;
  const latest =
    documents.find(
      (doc) => doc.status !== "ACCEPTED" && (current === null || doc.createdAt > current.createdAt),
    ) ?? null;
  const validity =
    current === null
      ? null
      : current.validUntil === null
        ? "valid"
        : expiryState(today, current.validUntil, DEFAULT_NOTICE_DAYS);
  const state: CurrentDocument["state"] =
    validity === "valid"
      ? "ok"
      : validity === "due_soon"
        ? "due_soon"
        : latest?.status === "PENDING"
          ? "pending"
          : current !== null
            ? "expired"
            : "rejected";
  return { state, validUntil: current?.validUntil ?? null, current, latest };
}

/**
 * The documents of each company (its own, not its workers') and of each worker, by requirement: the
 * current one and the newest pending or rejected one after it. A document whose file went to the trash
 * still counts until another one replaces it (the file can be restored).
 */
export async function loadDocuments(
  ctx: Pick<AdminContext, "db">,
  today: string,
  subjects: { companyIds: readonly string[]; workerIds: readonly string[] },
): Promise<{ companies: Map<string, CurrentDocuments>; workers: Map<string, CurrentDocuments> }> {
  const or: Prisma.CaeDocumentWhereInput[] = [];
  if (subjects.companyIds.length > 0) {
    or.push({ companyId: { in: [...subjects.companyIds] }, workerId: null });
  }
  if (subjects.workerIds.length > 0) or.push({ workerId: { in: [...subjects.workerIds] } });
  const rows =
    or.length === 0
      ? []
      : await ctx.db.caeDocument.findMany({
          // Superseded ones are history: never the current one nor the latest.
          where: { OR: or, supersededAt: null },
          select: {
            id: true,
            requirementId: true,
            companyId: true,
            workerId: true,
            nodeId: true,
            status: true,
            validUntil: true,
            rejectReason: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
  const nodes =
    rows.length === 0
      ? []
      : await ctx.db.node.findMany({
          where: { id: { in: [...new Set(rows.map((row) => row.nodeId))] }, trashedAt: null },
          select: { id: true, name: true },
        });
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]));
  const grouped = new Map<string, Map<string, CaeDocumentRef[]>>();
  for (const row of rows) {
    const subject = row.workerId === null ? `c:${row.companyId}` : `w:${row.workerId}`;
    const bySubject = grouped.get(subject) ?? new Map<string, CaeDocumentRef[]>();
    grouped.set(subject, bySubject);
    const list = bySubject.get(row.requirementId) ?? [];
    bySubject.set(row.requirementId, list);
    list.push({
      id: row.id,
      nodeId: row.nodeId,
      fileName: nameOf.get(row.nodeId) ?? null,
      status: row.status,
      validUntil: dayOfDate(row.validUntil),
      rejectReason: row.rejectReason,
      createdAt: row.createdAt,
    });
  }
  const statesOf = (subject: string): CurrentDocuments => {
    const result = new Map<string, CurrentDocument>();
    for (const [requirementId, list] of grouped.get(subject) ?? []) {
      const state = documentState(list, today);
      if (state !== null) result.set(requirementId, state);
    }
    return result;
  };
  return {
    companies: new Map(subjects.companyIds.map((id) => [id, statesOf(`c:${id}`)])),
    workers: new Map(subjects.workerIds.map((id) => [id, statesOf(`w:${id}`)])),
  };
}

const statusCompanySelect = {
  id: true,
  name: true,
  kind: true,
  parentId: true,
  blockedAt: true,
  blockedReason: true,
  archivedAt: true,
  startsOn: true,
  endsOn: true,
} as const;

type StatusCompany = CompanyForStatus & { id: string; parentId: string | null };

/** The status of each company (with their contractors when they're subcontractors). */
export async function companyStatuses(
  ctx: Pick<AdminContext, "db">,
  companies: readonly StatusCompany[],
  context?: { today: string; requirements: CaeRequirementRef[] },
): Promise<Map<string, CaeStatus>> {
  const { today, requirements } = context ?? (await statusContext(ctx));
  const known = new Map<string, StatusCompany>(companies.map((company) => [company.id, company]));
  const missingParents = [
    ...new Set(
      companies
        .map((company) => company.parentId)
        .filter((id): id is string => id !== null && !known.has(id)),
    ),
  ];
  if (missingParents.length > 0) {
    const parents = await ctx.db.caeCompany.findMany({
      where: { id: { in: missingParents } },
      select: statusCompanySelect,
    });
    for (const parent of parents) known.set(parent.id, parent);
  }
  const documents = await loadDocuments(ctx, today, {
    companyIds: [...known.keys()],
    workerIds: [],
  });
  const result = new Map<string, CaeStatus>();
  const statusOf = (company: StatusCompany, depth: number): CaeStatus => {
    const cached = result.get(company.id);
    if (cached !== undefined) return cached;
    const parent =
      company.kind === "SUBCONTRACTOR" && company.parentId !== null && depth < 3
        ? known.get(company.parentId)
        : undefined;
    const status = companyStatus({
      company,
      requirements,
      today,
      documents: documents.companies.get(company.id) ?? none,
      parent:
        parent === undefined ? null : { name: parent.name, status: statusOf(parent, depth + 1) },
    });
    result.set(company.id, status);
    return status;
  };
  for (const company of known.values()) statusOf(company, 0);
  return result;
}

/** One company's status. */
export async function companyStatusOf(
  ctx: Pick<AdminContext, "db">,
  company: StatusCompany,
  context?: { today: string; requirements: CaeRequirementRef[] },
): Promise<CaeStatus> {
  const statuses = await companyStatuses(ctx, [company], context);
  const status = statuses.get(company.id);
  if (status === undefined) throw new Error("CAE status not computed");
  return status;
}

type StatusWorker = WorkerForStatus & { id: string; companyId: string };

/** The status of each worker (and of their companies). */
export async function workerStatuses(
  ctx: Pick<AdminContext, "db">,
  workers: readonly StatusWorker[],
): Promise<Map<string, CaeStatus>> {
  const context = await statusContext(ctx);
  const companies = await ctx.db.caeCompany.findMany({
    where: { id: { in: [...new Set(workers.map((worker) => worker.companyId))] } },
    select: statusCompanySelect,
  });
  const byCompany = await companyStatuses(ctx, companies, context);
  const companyOf = new Map(companies.map((company) => [company.id, company]));
  const documents = await loadDocuments(ctx, context.today, {
    companyIds: [],
    workerIds: workers.map((worker) => worker.id),
  });
  const result = new Map<string, CaeStatus>();
  for (const worker of workers) {
    const company = companyOf.get(worker.companyId);
    const status = byCompany.get(worker.companyId);
    if (company === undefined || status === undefined) continue;
    result.set(
      worker.id,
      workerStatus({
        worker,
        company: { name: company.name, kind: company.kind, status },
        requirements: context.requirements,
        documents: documents.workers.get(worker.id) ?? none,
      }),
    );
  }
  return result;
}

// ─── List filters ────────────────────────────────────────────────────────────────────────

const KINDS: readonly CaeCompanyKind[] = ["CONTRACTOR", "SUBCONTRACTOR", "CONCURRENT"];

/** The required active requirements of a scope that apply to each kind of company. */
async function requiredByKind(
  ctx: Pick<AdminContext, "db">,
  scope: CaeScope,
): Promise<Map<CaeCompanyKind, string[]>> {
  const required = await ctx.db.caeRequirement.findMany({
    where: { archivedAt: null, required: true, scope },
    select: { id: true, appliesTo: true },
  });
  return new Map(
    KINDS.map((kind) => [
      kind,
      required.filter((r) => appliesToKind(r.appliesTo, kind)).map((r) => r.id),
    ]),
  );
}

/** A current document of the requirement, valid today (ok or due soon). */
const validDocument = (requirementId: string, day: Date, ownOnly: boolean) => ({
  some: {
    requirementId,
    status: "ACCEPTED" as const,
    supersededAt: null,
    ...(ownOnly ? { workerId: null } : {}),
    OR: [{ validUntil: null }, { validUntil: { gte: day } }],
  },
});

/** Not blocked nor archived, within its dates and with every required company document valid. */
function companyOwnWhere(
  day: Date,
  required: Map<CaeCompanyKind, string[]>,
): Prisma.CaeCompanyWhereInput {
  return {
    blockedAt: null,
    archivedAt: null,
    AND: [
      { OR: [{ startsOn: null }, { startsOn: { lte: day } }] },
      { OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
      {
        OR: KINDS.map((kind) => ({
          kind,
          AND: (required.get(kind) ?? []).map((id) => ({
            documents: validDocument(id, day, true),
          })),
        })),
      },
    ],
  };
}

/** The company's day as the DATE columns store it. */
async function todayDate(ctx: Pick<AdminContext, "db">): Promise<Date> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return new Date(`${dayIn(new Date(), zoneOf(workspace?.settings))}T00:00:00Z`);
}

/** Prisma filter of the companies `companyStatus` authorizes (the same rules). */
export async function authorizedCompanyWhere(
  ctx: Pick<AdminContext, "db">,
): Promise<Prisma.CaeCompanyWhereInput> {
  const day = await todayDate(ctx);
  const required = await requiredByKind(ctx, "COMPANY");
  const own = companyOwnWhere(day, required);
  return {
    AND: [own, { OR: [{ kind: { not: "SUBCONTRACTOR" } }, { parent: { is: own } }] }],
  };
}

/** Prisma filter of the workers `workerStatus` authorizes (the same rules). */
export async function authorizedWorkerWhere(
  ctx: Pick<AdminContext, "db">,
): Promise<Prisma.CaeWorkerWhereInput> {
  const day = await todayDate(ctx);
  const required = await requiredByKind(ctx, "WORKER");
  return {
    archivedAt: null,
    blockedAt: null,
    company: { is: await authorizedCompanyWhere(ctx) },
    OR: KINDS.map((kind) => ({
      company: { is: { kind } },
      AND: (required.get(kind) ?? []).map((id) => ({ documents: validDocument(id, day, false) })),
    })),
  };
}
