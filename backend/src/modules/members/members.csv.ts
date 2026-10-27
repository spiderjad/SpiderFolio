// CSV de importación de miembros (CLAUDE.md, sección 9.3): parser mínimo, sin dependencias.
// Acepta coma o punto y coma, comillas dobles con "" escapado, saltos CRLF y BOM.

export const MAX_IMPORT_ROWS = 500;

/** Divide el texto en filas de celdas. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  // Delimitador: el que más aparece en la cabecera, fuera de comillas.
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += source.charAt(i);
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += source.charAt(i);
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Se descartan las filas totalmente vacías.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface RawImportRow {
  /** Número de línea del archivo (la cabecera es la 1). */
  line: number;
  email: string;
  role: string;
  departments: string[];
  seat: string;
}

const aliases = {
  email: ["email", "correo", "correo electronico", "correo electrónico", "e-mail"],
  role: ["rol", "role"],
  departments: ["departamentos", "departamento", "departments", "department"],
  seat: ["plaza", "seat", "tipo de plaza"],
} as const;

/** Filas del CSV con las columnas reconocidas; null si falta la columna de email. */
export function readImportRows(table: string[][]): RawImportRow[] | null {
  const [header, ...body] = table;
  if (header === undefined) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const indexOf = (key: keyof typeof aliases) =>
    names.findIndex((name) => (aliases[key] as readonly string[]).includes(name));
  const email = indexOf("email");
  if (email === -1) return null;
  const role = indexOf("role");
  const departments = indexOf("departments");
  const seat = indexOf("seat");
  const cell = (row: string[], index: number) => (index === -1 ? "" : (row[index] ?? "").trim());
  return body.map((row, i) => ({
    line: i + 2,
    email: cell(row, email),
    role: cell(row, role),
    // Varios departamentos en una celda, separados por "|".
    departments: cell(row, departments)
      .split("|")
      .map((d) => d.trim())
      .filter((d) => d !== ""),
    seat: cell(row, seat).toUpperCase(),
  }));
}

/**
 * Serializa filas a CSV (coma, CRLF, BOM para que Excel respete los acentos). Las celdas que
 * empiezan con = + - @ o tab se prefijan con una comilla simple: evita que Excel las ejecute
 * como fórmulas (inyección de CSV).
 */
const BOM = String.fromCharCode(0xfeff);

export function toCsv(rows: string[][]): string {
  const cell = (value: string): string => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `${BOM}${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
