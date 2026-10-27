import { currentLocale } from "../i18n/locales.ts";
/** Tamaño legible en el idioma activo: "512 MB", "1,4 GB" (base 1024, igual que los límites). */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(
    value,
  );
  return `${text} ${units[unit] ?? "B"}`;
}
