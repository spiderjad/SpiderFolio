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
const longDateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });

/** "2026-10-19" → "19 oct". */
export function formatDay(isoDay: string): string {
  return dayFormat.format(new Date(`${isoDay.slice(0, 10)}T00:00:00Z`));
}

/** "2026-10" → "oct". */
export function formatMonth(isoMonth: string): string {
  return monthFormat.format(new Date(`${isoMonth.slice(0, 7)}-01T00:00:00Z`));
}

/** Fecha ISO completa → "19 de octubre de 2026". */
export function formatLongDate(iso: string): string {
  return longDateFormat.format(new Date(iso));
}

const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
const shortDateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

/** Fecha y hora ISO en la zona del navegador: "19 oct 2026, 10:30". */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** Fecha ISO en la zona del navegador: "19 oct 2026". */
export function formatShortDate(iso: string): string {
  return shortDateFormat.format(new Date(iso));
}

const utcDateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

/**
 * A calendar day stored as an instant in UTC (a license that runs until 2027-12-31T23:59:59Z): the
 * day itself, «31 dic 2027», wherever the browser is (in Madrid that instant is already 1 January).
 */
export function formatUtcDate(iso: string): string {
  return utcDateFormat.format(new Date(iso));
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
