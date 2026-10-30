import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { locale } from "@/i18n";

/** Combina clases de Tailwind resolviendo conflictos (estilo shadcn/ui). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Destino seguro para redirigir después del login (?next=…): solo rutas internas de la app.
 * Mitiga el open redirect de React Router 6 con barras invertidas (GHSA-wrjc-x8rr-h8h6).
 */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (typeof next !== "string" || next === "") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/\p{Cc}/u.test(next)) return fallback;
  try {
    const url = new URL(next, "https://spiderfolio.invalid");
    if (url.origin !== "https://spiderfolio.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Bytes legibles con 1 GB = 1024³ (CLAUDE.md, sección 9A.4). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} ${UNITS[unit] ?? "B"}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : [parts[0]];
  return letters
    .map((part) => part?.[0] ?? "")
    .join("")
    .toUpperCase();
}

// Fechas del servidor en ISO: "YYYY-MM-DD" (días) y "YYYY-MM" (meses). Se leen en UTC para que
// la zona horaria del navegador no corra el día.
const dayFormat = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });

/** "2026-10-19" → "19 oct". */
export function formatDay(isoDay: string): string {
  return dayFormat.format(new Date(`${isoDay.slice(0, 10)}T00:00:00Z`));
}

/** "2026-10" → "oct". */
export function formatMonth(isoMonth: string): string {
  return monthFormat.format(new Date(`${isoMonth.slice(0, 7)}-01T00:00:00Z`));
}

// The company's time zone (Administración › Seguridad): every date and time in the app is shown in it,
// wherever the browser is. A whole day (a deadline, a review) is stored as the end of that day in this
// zone, so shown in it it's always that day.
let zone: string | undefined;
let formats = buildFormats(undefined);

function buildFormats(timeZone: string | undefined) {
  const withZone = timeZone === undefined ? {} : { timeZone };
  return {
    dateTime: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      ...withZone,
    }),
    short: new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...withZone }),
    long: new Intl.DateTimeFormat(locale, { dateStyle: "long", ...withZone }),
    full: new Intl.DateTimeFormat(locale, { dateStyle: "full", ...withZone }),
    parts: new Intl.DateTimeFormat("en-GB", {
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...withZone,
    }),
  };
}

/** Sets the company's zone (the app shell does it with the company being viewed). */
export function setAppTimeZone(timeZone: string | undefined): void {
  if (timeZone === zone) return;
  try {
    formats = buildFormats(timeZone);
    zone = timeZone;
  } catch {
    // An unknown zone (shouldn't come from the server): the browser's.
    formats = buildFormats(undefined);
    zone = undefined;
  }
}

/** The company's zone in use (the browser's if none). */
export function appTimeZone(): string {
  return zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Fecha ISO completa → "19 de octubre de 2026", en la zona de la empresa. */
export function formatLongDate(iso: string): string {
  return formats.long.format(new Date(iso));
}

/** Fecha y hora ISO en la zona de la empresa: "19 oct 2026, 10:30". */
export function formatDateTime(iso: string): string {
  return formats.dateTime.format(new Date(iso));
}

/** Fecha ISO en la zona de la empresa: "19 oct 2026". */
export function formatShortDate(iso: string): string {
  return formats.short.format(new Date(iso));
}

/** Hoy, completo, en la zona de la empresa: "viernes, 30 de octubre de 2026". */
export function formatToday(now: Date = new Date()): string {
  return formats.full.format(now);
}

function partsOf(date: Date) {
  const parts = formats.parts.formatToParts(date);
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

const pad = (n: number) => String(n).padStart(2, "0");

/** «YYYY-MM-DD» of an instant in the company's zone: the value of a date field. */
export function dayInputOf(iso: string): string {
  const { year, month, day } = partsOf(new Date(iso));
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/**
 * The end of a day («YYYY-MM-DD», from a date field) in the company's zone, as ISO: a deadline or an
 * expiry «until that day». The offset is the one at that moment, so the day the clocks change too.
 */
export function endOfDay(value: string): string {
  const [year = 1970, month = 1, day = 1] = value.slice(0, 10).split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, 23, 59, 59);
  const offset = (at: number) => {
    const p = partsOf(new Date(at));
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(at / 1000) * 1000
    );
  };
  let instant = wall - offset(wall);
  instant = wall - offset(instant);
  return new Date(instant).toISOString();
}

const utcDateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
const utcLongFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });

/**
 * A calendar day stored as an instant in UTC (a license that runs until 2027-12-31T23:59:59Z): the
 * day itself, «31 dic 2027», in any zone (in Madrid that instant is already 1 January).
 */
export function formatUtcDate(iso: string): string {
  return utcDateFormat.format(new Date(iso));
}

/** The same, long: «1 de noviembre de 2026» (Bian's monthly quota renews on the 1st, in UTC). */
export function formatUtcLongDate(iso: string): string {
  return utcLongFormat.format(new Date(iso));
}

const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

/** «hace 5 minutos», «ayer», «hace 3 días»: cuánto pasó desde una fecha. */
export function timeAgo(date: Date | string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "hace un momento";
}
