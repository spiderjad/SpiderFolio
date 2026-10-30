// The company's time zone (Workspace.settings.timezone, an IANA name such as Europe/Madrid): dates and
// times in emails, PDFs and Bian are written in it, and the daily notices go out at 8:00 in it. All
// with Intl, so daylight saving time is the zone's own and the server's zone never matters.
//
// Two kinds of dates:
//   - an instant (a login, a save): shown in the company's zone.
//   - a whole day (a review date, a deadline, a share that lasts «until the 31st»): stored as the last
//     moment of that day in the company's zone (endOfDayIn), so shown in that zone it's always that
//     day. A license's expiry, issued as a day in UTC, is shown in UTC (formatUtcDay).

/** The zone in the settings, if valid; UTC otherwise. */
export function zoneOf(settings: unknown): string {
  const raw = (settings as { timezone?: unknown } | null | undefined)?.timezone;
  return typeof raw === "string" && raw !== "" && isTimeZone(raw) ? raw : "UTC";
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar parts of an instant in a zone. */
function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The hour (0-23) of an instant in a zone: the daily notices go out when it's 8. */
export function localHour(now: Date, timeZone: string): number {
  return partsIn(now, timeZone).hour;
}

/** «YYYY-MM-DD»: the day an instant falls on in a zone. */
export function dayIn(date: Date, timeZone: string): string {
  const { year, month, day } = partsIn(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/** Minutes the zone is ahead of UTC at that instant (Madrid in summer: 120). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The last second of a day («YYYY-MM-DD») in a zone, as an instant: a deadline or a review date on
 * that day. The offset is taken at that moment, so a day when the clocks change is right too.
 */
export function endOfDayIn(day: string, timeZone: string): Date {
  const [year = 1970, month = 1, date = 1] = day.slice(0, 10).split("-").map(Number);
  const wall = Date.UTC(year, month - 1, date, 23, 59, 59);
  let instant = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  // Once more with the offset at the instant found: it differs only around a clock change.
  instant = wall - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** The first instant of a day («YYYY-MM-DD») in a zone: a «from» filter covers that whole day. */
export function startOfDayIn(day: string, timeZone: string): Date {
  const [year = 1970, month = 1, date = 1] = day.slice(0, 10).split("-").map(Number);
  const before = new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
  return new Date(endOfDayIn(before, timeZone).getTime() + 1000);
}

/** The company's zone, read from its settings (for the services that work inside one company). */
export async function companyZone(db: {
  workspace: {
    findFirst(args: {
      where: object;
      select: { settings: true };
    }): Promise<{ settings: unknown } | null>;
  };
}): Promise<string> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return zoneOf(workspace?.settings);
}

/** Months later, as a whole day in the zone (a document's next review). */
export function dayMonthsLater(from: Date, months: number, timeZone: string): Date {
  const [year = 1970, month = 1, day = 1] = dayIn(from, timeZone).split("-").map(Number);
  // Day 31 plus one month is the last day of the next month, not the 1st after it.
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return endOfDayIn(target.toISOString().slice(0, 10), timeZone);
}

/** «30 de octubre de 2026, 9:05» in the zone. */
export function formatDateTimeIn(date: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

/** «30 de octubre de 2026» in the zone. */
export function formatDayIn(date: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(date);
}

/** A day issued in UTC (a license until 2027-12-31T23:59:59Z): that day, in any zone. */
export function formatUtcDay(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}
