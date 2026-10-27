// CSV para exportar tablas. Cada celda se entrecomilla y las que empiezan con = + - @ (o tabulación)
// se prefijan con un apóstrofo: así una hoja de cálculo no las ejecuta como fórmula.
const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/u;

export function csvCell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n;]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Filas a texto CSV con BOM (Excel lo abre en UTF-8) y saltos de línea CRLF. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | boolean | Date | null | undefined)[])[],
): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
