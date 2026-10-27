// Administración › Bian: interruptores, total del mes con su renovación, límites por persona (general,
// por departamento y por persona) y la tabla de uso. Solo cantidades: nunca contenido de preguntas,
// respuestas ni documentos. Todo pasa por forTenant: de otra empresa nunca llega nada.
import { AppError, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page, type PageQuery } from "../../lib/pagination.ts";
import { toCsv } from "../../lib/csv.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { getSecuritySettings, updateSecuritySettings } from "../security/security.service.ts";
import { pickLimit, type LimitMode, type LimitRow, type PersonalLimit } from "./limits.core.ts";
import { updateLimits } from "../limits/limits.service.ts";
import { companyTotal, usagePeriod } from "./usage.service.ts";
import { bianAdminTexts } from "../../i18n/index.ts";

// ─── Resumen ─────────────────────────────────────────────────────────────────────────────

export interface LimitView {
  id: string;
  mode: LimitMode;
  limit: number | null;
}

export interface BianOverview {
  settings: { enabled: boolean; guests: boolean };
  usage: {
    used: number;
    /** Total mensual que fija la empresa; null: sin límite. */
    total: number | null;
    periodStart: Date;
    /** Cuándo se renueva (empieza el próximo período). */
    renewsAt: Date;
  };
  limits: {
    general: LimitView | null;
    departments: (LimitView & { department: { id: string; name: string } })[];
    people: (LimitView & { person: { id: string; name: string } })[];
  };
}

export async function bianOverview(ctx: AdminContext, now: Date = new Date()): Promise<BianOverview> {
  const period = usagePeriod(now);
  const [settings, total, counter, rows, departments, people] = await Promise.all([
    getSecuritySettings(ctx),
    companyTotal(ctx.db),
    ctx.db.usageCounter.findFirst({
      where: { periodStart: period.start },
      select: { aiQueries: true },
    }),
    ctx.db.bianLimit.findMany({ orderBy: [{ scope: "asc" }, { id: "asc" }] }),
    ctx.db.department.findMany({ select: { id: true, name: true } }),
    ctx.db.membership.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const personName = new Map(people.map((m) => [m.id, m.user.name]));
  const view = (row: (typeof rows)[number]): LimitView => ({
    id: row.id,
    mode: row.mode,
    limit: row.limit,
  });
  return {
    settings: { enabled: settings.bianEnabled, guests: settings.bianGuests },
    usage: {
      used: counter?.aiQueries ?? 0,
      total,
      periodStart: period.start,
      renewsAt: period.end,
    },
    limits: {
      general: rows.filter((row) => row.scope === "GENERAL").map(view)[0] ?? null,
      departments: rows.flatMap((row) =>
        row.scope === "DEPARTMENT" && row.departmentId !== null
          ? [
              {
                ...view(row),
                department: {
                  id: row.departmentId,
                  name: departmentName.get(row.departmentId) ?? "",
                },
              },
            ]
          : [],
      ),
      people: rows.flatMap((row) =>
        row.scope === "PERSON" && row.membershipId !== null && personName.has(row.membershipId)
          ? [
              {
                ...view(row),
                person: { id: row.membershipId, name: personName.get(row.membershipId) ?? "" },
              },
            ]
          : [],
      ),
    },
  };
}

/** El interruptor de Bian y «Permitir a invitados» (antes en Seguridad). */
export async function updateBianSettings(
  ctx: AdminContext,
  changes: { enabled?: boolean | undefined; guests?: boolean | undefined },
): Promise<BianOverview["settings"]> {
  const after = await updateSecuritySettings(ctx, {
    bianEnabled: changes.enabled,
    bianGuests: changes.guests,
  });
  return { enabled: after.bianEnabled, guests: after.bianGuests };
}

// ─── Límites ─────────────────────────────────────────────────────────────────────────────

export interface SetLimitInput {
  scope: "GENERAL" | "DEPARTMENT" | "PERSON";
  /** El departamento o la persona; sin él en el límite general. */
  subjectId?: string | undefined;
  mode: LimitMode;
  limit?: number | undefined;
}

/** Crea o cambia un límite. */
export async function setLimit(ctx: AdminContext, input: SetLimitInput): Promise<LimitView> {
  if (input.mode === "LIMIT" ? input.limit === undefined : input.limit !== undefined) {
    throw new AppError("BAD_REQUEST", {
      message: bianAdminTexts.limitOnlyForLimitMode,
    });
  }
  // «Sin acceso» solo vale para una persona.
  if (input.mode === "BLOCKED" && input.scope !== "PERSON") {
    throw new AppError("BAD_REQUEST", { message: bianAdminTexts.blockedOnlyPerson });
  }
  if (input.scope === "GENERAL" ? input.subjectId !== undefined : input.subjectId === undefined) {
    throw new AppError("BAD_REQUEST", { message: bianAdminTexts.subjectMissing });
  }
  const subjectId = input.subjectId ?? "";
  if (input.scope === "DEPARTMENT") {
    if ((await ctx.db.department.count({ where: { id: subjectId } })) === 0) throw notFound();
  } else if (input.scope === "PERSON") {
    if ((await ctx.db.membership.count({ where: { id: subjectId, status: "ACTIVE" } })) === 0)
      throw notFound();
  }
  const subject = {
    scope: input.scope,
    departmentId: input.scope === "DEPARTMENT" ? (input.subjectId ?? null) : null,
    membershipId: input.scope === "PERSON" ? (input.subjectId ?? null) : null,
  };
  const existing = await ctx.db.bianLimit.findFirst({
    where: subject,
    select: { id: true },
  });
  const data = { mode: input.mode, limit: input.mode === "LIMIT" ? (input.limit ?? null) : null };
  const row =
    existing === null
      ? await ctx.db.bianLimit.create({ data: { ...subject, ...data } })
      : await ctx.db.bianLimit.update({ where: { id: existing.id }, data });
  await auditAdmin(ctx, {
    action: "bian.limit.set",
    entityType: "BianLimit",
    entityId: row.id,
    metadata: { scope: input.scope, mode: row.mode, limit: row.limit },
  });
  return { id: row.id, mode: row.mode, limit: row.limit };
}

export async function removeLimit(ctx: AdminContext, id: string): Promise<void> {
  const { count } = await ctx.db.bianLimit.deleteMany({ where: { id } });
  if (count === 0) throw notFound();
  await auditAdmin(ctx, {
    action: "bian.limit.remove",
    entityType: "BianLimit",
    entityId: id,
  });
}

// ─── Tabla de uso ────────────────────────────────────────────────────────────────────────

export type UsageView = "people" | "departments";
export type UsageSort = "name" | "used" | "limit";

export interface UsageQuery extends PageQuery {
  view: UsageView;
  q?: string | undefined;
  sort: UsageSort;
  dir: "asc" | "desc";
}

export interface PersonUsageRow {
  membershipId: string;
  name: string;
  departments: string[];
  used: number;
  /** Su límite efectivo: número, «unlimited» o «blocked». */
  mode: LimitMode;
  limit: number | null;
  source: PersonalLimit["source"];
}

export interface DepartmentUsageRow {
  departmentId: string;
  name: string;
  people: number;
  /** Consultas de las personas de ese departamento (quien está en dos cuenta en las dos). */
  used: number;
  /** Límite por persona de ese departamento (su excepción o, si no, el general). */
  mode: LimitMode;
  limit: number | null;
  source: PersonalLimit["source"];
}

async function usageData(ctx: AdminContext, now: Date) {
  const period = usagePeriod(now);
  const [members, memberships, departments, counters, limits] = await Promise.all([
    ctx.db.departmentMember.findMany({ select: { membershipId: true, departmentId: true } }),
    ctx.db.membership.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, user: { select: { name: true } } },
    }),
    ctx.db.department.findMany({ select: { id: true, name: true } }),
    ctx.db.usageCounterMember.findMany({
      where: { periodStart: period.start },
      select: { membershipId: true, aiQueries: true },
    }),
    ctx.db.bianLimit.findMany({
      select: { scope: true, departmentId: true, membershipId: true, mode: true, limit: true },
    }),
  ]);
  const usedBy = new Map(counters.map((row) => [row.membershipId, row.aiQueries]));
  const departmentsOf = new Map<string, Set<string>>();
  for (const member of members) {
    const set = departmentsOf.get(member.membershipId) ?? new Set<string>();
    set.add(member.departmentId);
    departmentsOf.set(member.membershipId, set);
  }
  return { memberships, departments, usedBy, departmentsOf, limits: limits as LimitRow[] };
}

const cmp = (a: string, b: string) => a.localeCompare(b, "es");

/** Uso del período por persona o por departamento, con búsqueda, orden y cursor. */
export async function bianUsage(
  ctx: AdminContext,
  query: UsageQuery,
  now: Date = new Date(),
): Promise<Page<PersonUsageRow | DepartmentUsageRow>> {
  const rows = await usageRows(ctx, query, now);
  const { skip, take } = offsetArgs(query);
  return pageOf(rows.slice(skip, skip + take), rows.length, query);
}

async function usageRows(
  ctx: AdminContext,
  query: Pick<UsageQuery, "view" | "q" | "sort" | "dir">,
  now: Date,
): Promise<(PersonUsageRow | DepartmentUsageRow)[]> {
  const data = await usageData(ctx, now);
  const needle = (query.q ?? "").trim().toLowerCase();
  const factor = query.dir === "asc" ? 1 : -1;
  const order = <T extends { name: string; used: number; mode: LimitMode; limit: number | null }>(
    list: T[],
  ): T[] =>
    list.sort((a, b) => {
      // Sin límite al final del orden por límite ascendente.
      const limitOf = (row: T) =>
        row.mode === "UNLIMITED"
          ? Number.POSITIVE_INFINITY
          : row.mode === "BLOCKED"
            ? -1
            : (row.limit ?? 0);
      const primary =
        query.sort === "used"
          ? a.used - b.used
          : query.sort === "limit"
            ? limitOf(a) === limitOf(b)
              ? 0
              : limitOf(a) < limitOf(b)
                ? -1
                : 1
            : cmp(a.name, b.name);
      return factor * primary || cmp(a.name, b.name);
    });
  if (query.view === "people") {
    const names = new Map(data.departments.map((d) => [d.id, d.name]));
    const list = data.memberships
      .filter((m) => needle === "" || m.user.name.toLowerCase().includes(needle))
      .map((m): PersonUsageRow => {
        const own = data.departmentsOf.get(m.id) ?? new Set<string>();
        const effective = pickLimit(data.limits, { membershipId: m.id, departmentIds: own });
        return {
          membershipId: m.id,
          name: m.user.name,
          departments: [...own]
            .flatMap((id) => (names.has(id) ? [names.get(id) ?? ""] : []))
            .sort(cmp),
          used: data.usedBy.get(m.id) ?? 0,
          mode: effective.mode,
          limit: effective.limit,
          source: effective.source,
        };
      });
    return order(list);
  }
  const list = data.departments
    .filter((d) => needle === "" || d.name.toLowerCase().includes(needle))
    .map((d): DepartmentUsageRow => {
      const people = data.memberships.filter(
        (m) => data.departmentsOf.get(m.id)?.has(d.id) === true,
      );
      // El límite del departamento: su excepción o, si no, el general (nada de reglas por persona).
      const effective = pickLimit(
        data.limits.filter((row) => row.scope !== "PERSON"),
        { membershipId: "", departmentIds: new Set([d.id]) },
      );
      return {
        departmentId: d.id,
        name: d.name,
        people: people.length,
        used: people.reduce((sum, m) => sum + (data.usedBy.get(m.id) ?? 0), 0),
        mode: effective.mode,
        limit: effective.limit,
        source: effective.source,
      };
    });
  return order(list);
}

/** La tabla de uso como CSV (solo cantidades); queda en la auditoría. */
export async function bianUsageCsv(
  ctx: AdminContext,
  query: Pick<UsageQuery, "view" | "q" | "sort" | "dir">,
  now: Date = new Date(),
): Promise<{ fileName: string; csv: string }> {
  const rows = await usageRows(ctx, query, now);
  const period = usagePeriod(now);
  const limitText = (row: { mode: LimitMode; limit: number | null }) =>
    row.mode === "LIMIT"
      ? (row.limit ?? "")
      : row.mode === "UNLIMITED"
        ? bianAdminTexts.unlimited
        : bianAdminTexts.blocked;
  await auditAdmin(ctx, {
    action: "bian.usage.export",
    entityType: "Workspace",
    entityId: ctx.tenant.workspaceId,
    metadata: { view: query.view, rows: rows.length },
  });
  const month = period.start.toISOString().slice(0, 7);
  if (query.view === "people") {
    return {
      fileName: bianAdminTexts.peopleFileName(month),
      csv: toCsv(
        bianAdminTexts.peopleHeaders,
        (rows as PersonUsageRow[]).map((row) => [
          row.name,
          row.departments.join(" · "),
          row.used,
          limitText(row),
        ]),
      ),
    };
  }
  return {
    fileName: bianAdminTexts.departmentsFileName(month),
    csv: toCsv(
      bianAdminTexts.departmentHeaders,
      (rows as DepartmentUsageRow[]).map((row) => [row.name, row.people, row.used, limitText(row)]),
    ),
  };
}

// ─── Total mensual de la empresa ─────────────────────────────────────────────────────────

/** Fija el total de consultas por mes de toda la empresa (null: sin límite). */
export async function setMonthlyTotal(ctx: AdminContext, total: number | null): Promise<void> {
  await updateLimits(ctx, { aiQueriesPerMonth: total });
}
