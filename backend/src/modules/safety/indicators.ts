// Accident rates (docs/spec/seguridad-salud.md, «Indicadores de siniestralidad»), without the database:
// the INSST definitions (Spain). Each country may define them differently; the app says so in latam.
//
//   Frequency index  = accidents with leave × 1 000 000 / hours worked
//   Severity index   = days of leave × 1 000 / hours worked
//   Incidence index  = accidents with leave × 100 000 / average headcount
//
// Without the denominator (no hours or no headcount entered, or zero) the index is null: unknown, not 0.

export interface PeriodTotals {
  /** Hours worked in the period; null if no month of it has them. */
  hours: number | null;
  /** Average headcount in the period (the mean of its months'); null if none. */
  headcount: number | null;
  /** Accidents with sick leave in the period. */
  accidents: number;
  /** Days of leave of those accidents. */
  lostDays: number;
}

export interface Indices {
  frequency: number | null;
  severity: number | null;
  incidence: number | null;
}

/** Two decimals, as the indices are read. */
export const roundIndex = (value: number): number => Math.round(value * 100) / 100;

export function frequencyIndex(accidents: number, hours: number | null): number | null {
  return hours === null || hours <= 0 ? null : roundIndex((accidents * 1_000_000) / hours);
}

export function severityIndex(lostDays: number, hours: number | null): number | null {
  return hours === null || hours <= 0 ? null : roundIndex((lostDays * 1_000) / hours);
}

export function incidenceIndex(accidents: number, headcount: number | null): number | null {
  return headcount === null || headcount <= 0
    ? null
    : roundIndex((accidents * 100_000) / headcount);
}

export function indicesOf(totals: PeriodTotals): Indices {
  return {
    frequency: frequencyIndex(totals.accidents, totals.hours),
    severity: severityIndex(totals.lostDays, totals.hours),
    incidence: incidenceIndex(totals.accidents, totals.headcount),
  };
}

/** A month's figures, as they're added up into a period. */
export interface MonthFigures {
  hours: number | null;
  headcount: number | null;
  accidents: number;
  lostDays: number;
}

/**
 * Adds months up: hours and accidents add; the headcount is the mean of the months that have it. A
 * period with some months without hours counts only the hours there are (the screen warns of the gaps).
 */
export function totalsOf(months: readonly MonthFigures[]): PeriodTotals {
  const withHours = months.filter((month) => month.hours !== null);
  const withHeadcount = months.filter((month) => month.headcount !== null);
  return {
    hours:
      withHours.length === 0 ? null : withHours.reduce((sum, month) => sum + (month.hours ?? 0), 0),
    headcount:
      withHeadcount.length === 0
        ? null
        : roundIndex(
            withHeadcount.reduce((sum, month) => sum + (month.headcount ?? 0), 0) /
              withHeadcount.length,
          ),
    accidents: months.reduce((sum, month) => sum + month.accidents, 0),
    lostDays: months.reduce((sum, month) => sum + month.lostDays, 0),
  };
}

/** «YYYY-MM-01» of the month `offset` months after the one of `month` («YYYY-MM-01»). */
export function addMonths(month: string, offset: number): string {
  const [year = 1970, number = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 10);
}
