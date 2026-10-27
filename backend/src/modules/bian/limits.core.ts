// Límites mensuales de consultas a Bian por persona (funciones puras).
// Precedencia: persona > departamento > general, siempre dentro del total de la empresa.
// Sin ninguna regla, una persona puede usar lo que quede del total (sin límite propio).

export type LimitMode = "LIMIT" | "UNLIMITED" | "BLOCKED";

export interface LimitRow {
  scope: "GENERAL" | "DEPARTMENT" | "PERSON";
  departmentId: string | null;
  membershipId: string | null;
  mode: LimitMode;
  limit: number | null;
}

export interface PersonalLimit {
  mode: LimitMode;
  /** Solo con LIMIT. */
  limit: number | null;
  /** De dónde sale la regla que vale. */
  source: "person" | "department" | "general" | "none";
}

const rank = (row: Pick<LimitRow, "mode" | "limit">): number =>
  row.mode === "UNLIMITED" ? Number.POSITIVE_INFINITY : (row.limit ?? 0);

/** La regla que le toca a una persona: la suya, si no la de su departamento, si no la general. */
export function pickLimit(
  rows: readonly LimitRow[],
  person: { membershipId: string; departmentIds: ReadonlySet<string> },
): PersonalLimit {
  const own = rows.find((r) => r.scope === "PERSON" && r.membershipId === person.membershipId);
  if (own !== undefined) return { mode: own.mode, limit: own.limit, source: "person" };
  // En varios departamentos con excepción: vale la más generosa.
  const departments = rows.filter(
    (r) =>
      r.scope === "DEPARTMENT" &&
      r.departmentId !== null &&
      person.departmentIds.has(r.departmentId),
  );
  const best = departments.reduce<LimitRow | undefined>(
    (current, row) => (current === undefined || rank(row) > rank(current) ? row : current),
    undefined,
  );
  if (best !== undefined) return { mode: best.mode, limit: best.limit, source: "department" };
  const general = rows.find((r) => r.scope === "GENERAL");
  if (general !== undefined) return { mode: general.mode, limit: general.limit, source: "general" };
  return { mode: "UNLIMITED", limit: null, source: "none" };
}

/** ¿Cuántas consultas le quedan? null: sin tope propio (solo vale el total de la empresa). */
export function personalRemaining(limit: PersonalLimit, used: number): number | null {
  if (limit.mode === "BLOCKED") return 0;
  if (limit.mode === "UNLIMITED" || limit.limit === null) return null;
  return Math.max(limit.limit - used, 0);
}

/**
 * Lo que de verdad puede usar: lo que le queda de su límite y del total de la empresa, el menor.
 * null: sin tope en ninguno.
 */
export function effectiveRemaining(
  personal: PersonalLimit,
  personalUsed: number,
  company: { used: number; total: number | null },
): number | null {
  const mine = personalRemaining(personal, personalUsed);
  const firm = company.total === null ? null : Math.max(company.total - company.used, 0);
  if (mine === null) return firm;
  if (firm === null) return mine;
  return Math.min(mine, firm);
}

/** ¿Un umbral (en %) se cruzó con esta consulta? (de `used - 1` a `used` sobre `total`). */
export function crossedThreshold(used: number, total: number, percent: number): boolean {
  return total > 0 && (used - 1) * 100 < percent * total && percent * total <= used * 100;
}

export const USAGE_THRESHOLDS = [80, 95] as const;
