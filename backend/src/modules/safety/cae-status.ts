// Whether a contractor or one of its workers can work at the site (docs/spec/cae.md, «Estado y
// autorización»): computed, never stored, always with readable reasons. The same function serves the
// API, the lists, the gatehouse and the PDF.
//
// Phase 1 has no documents yet: every requirement is «missing», so anything with a required document
// that applies to it isn't authorized. Phase 2 only has to fill `CurrentDocuments` (loadDocuments) and
// the list filter (`authorizedCompanyWhere`) with the accepted documents.
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

export interface CaeRequirementStatus {
  requirement: { id: string; name: string; required: boolean; validityMonths: number | null };
  state: CaeRequirementState;
  /** «YYYY-MM-DD» of the current document, if it has one. */
  validUntil: string | null;
}

export interface CaeStatus {
  authorized: boolean;
  state: CaeState;
  reasons: string[];
  requirements: CaeRequirementStatus[];
}

/** The current document of a requirement (phase 2): its state and until when it's valid. */
export interface CurrentDocument {
  state: Exclude<CaeRequirementState, "missing">;
  validUntil: string | null;
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

/**
 * The current documents of each company and worker. Phase 1 has none (every requirement is
 * «missing»); phase 2 takes the tenant db here and reads the latest CaeDocument of each requirement.
 */
export function loadDocuments(subjects: {
  companyIds: readonly string[];
  workerIds: readonly string[];
}): Promise<{ companies: Map<string, CurrentDocuments>; workers: Map<string, CurrentDocuments> }> {
  return Promise.resolve({
    companies: new Map(subjects.companyIds.map((id) => [id, none])),
    workers: new Map(subjects.workerIds.map((id) => [id, none])),
  });
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
  const documents = await loadDocuments({ companyIds: [...known.keys()], workerIds: [] });
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
  const documents = await loadDocuments({
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

/**
 * Phase 1: with no documents, a company can only be authorized while no required document applies
 * to it. `scopes` = which requirements count (a worker also needs the worker ones).
 */
async function kindsWithoutRequirements(
  ctx: Pick<AdminContext, "db">,
  scopes: readonly CaeScope[],
): Promise<CaeCompanyKind[]> {
  const required = await ctx.db.caeRequirement.findMany({
    where: { archivedAt: null, required: true, scope: { in: [...scopes] } },
    select: { appliesTo: true },
  });
  return KINDS.filter((kind) => !required.some((r) => appliesToKind(r.appliesTo, kind)));
}

function ownAuthorized(today: Date, kinds: readonly CaeCompanyKind[]): Prisma.CaeCompanyWhereInput {
  return {
    blockedAt: null,
    archivedAt: null,
    kind: { in: [...kinds] },
    AND: [
      { OR: [{ startsOn: null }, { startsOn: { lte: today } }] },
      { OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
    ],
  };
}

/** Prisma filter of the companies `caeStatus` would authorize (same rules, phase 1). */
export async function authorizedCompanyWhere(
  ctx: Pick<AdminContext, "db">,
  scopes: readonly CaeScope[] = ["COMPANY"],
): Promise<Prisma.CaeCompanyWhereInput> {
  const { today } = await statusContext(ctx);
  const day = new Date(`${today}T00:00:00Z`);
  const companyKinds = await kindsWithoutRequirements(ctx, ["COMPANY"]);
  const kinds = await kindsWithoutRequirements(ctx, scopes);
  return {
    AND: [
      ownAuthorized(day, kinds),
      {
        OR: [
          { kind: { not: "SUBCONTRACTOR" } },
          { parent: { is: ownAuthorized(day, companyKinds) } },
        ],
      },
    ],
  };
}
