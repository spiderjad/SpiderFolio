// Periods of a periodic form (docs/spec/formularios.md, phase 3), as days in the company's zone. Pure:
// it works with «YYYY-MM-DD» days (lib/time-zone.ts turns an instant into one).
//   daily    one period per due day (the weekdays chosen); its key is the day.
//   weekly   one period per week, Monday to Sunday; its key is the Monday.
//   monthly  one period per month; its key is «YYYY-MM».
// One record in a period, from any of the people assigned, completes it.

export type Frequency = "none" | "daily" | "weekly" | "monthly";
export interface Schedule {
  frequency: Frequency;
  /** daily: ISO weekdays it's due on (1 = Monday … 7 = Sunday). */
  weekdays: readonly number[];
}

const dateOf = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) =>
  dayOf(new Date(dateOf(day).getTime() + days * 86_400_000));

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = dateOf(day).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Whether a period is open on that day (daily forms are only due on their weekdays). */
export function isDue(schedule: Schedule, day: string): boolean {
  switch (schedule.frequency) {
    case "none":
      return false;
    case "daily":
      return schedule.weekdays.includes(isoWeekday(day));
    case "weekly":
    case "monthly":
      return true;
  }
}

/** The key of the period a day belongs to; null when nothing is due that day. */
export function periodOf(schedule: Schedule, day: string): string | null {
  if (!isDue(schedule, day)) return null;
  switch (schedule.frequency) {
    case "daily":
      return day.slice(0, 10);
    case "weekly":
      return addDays(day, 1 - isoWeekday(day));
    case "monthly":
      return day.slice(0, 7);
    case "none":
      return null;
  }
}

/** The day a period starts (its people are told that morning). */
export function startsOn(schedule: Schedule, day: string): boolean {
  switch (schedule.frequency) {
    case "daily":
      return isDue(schedule, day);
    case "weekly":
      return isoWeekday(day) === 1;
    case "monthly":
      return day.slice(8, 10) === "01";
    case "none":
      return false;
  }
}

/** The first day of a period, from its key. */
export function periodStart(schedule: Schedule, key: string): string {
  return schedule.frequency === "monthly" ? `${key}-01` : key;
}

/**
 * The period before the one a day belongs to (the last one that was due), or null if none in the last
 * two weeks (a daily form with no weekdays, or a schedule that isn't periodic).
 */
export function previousPeriod(schedule: Schedule, day: string): string | null {
  switch (schedule.frequency) {
    case "none":
      return null;
    case "daily": {
      for (let back = 1; back <= 14; back += 1) {
        const candidate = addDays(day, -back);
        if (isDue(schedule, candidate)) return candidate;
      }
      return null;
    }
    case "weekly":
      return addDays(day, 1 - isoWeekday(day) - 7);
    case "monthly": {
      const [year = 1970, month = 1] = day.slice(0, 7).split("-").map(Number);
      const previous = new Date(Date.UTC(year, month - 2, 1));
      return previous.toISOString().slice(0, 7);
    }
  }
}
