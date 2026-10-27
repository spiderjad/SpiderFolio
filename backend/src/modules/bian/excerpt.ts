// Recorte de las tablas que cita Bian (funciones puras). En los fragmentos una tabla es texto legible:
// una fila por línea, «Columna: valor; Columna: valor». Si la cita cae en una tabla, la fuente muestra
// solo el encabezado y las filas que tienen que ver con la pregunta, no la tabla entera.
import { normalizeText } from "./query-terms.ts";

export interface TableExcerpt {
  headers: string[];
  rows: string[][];
  /** Filas de la tabla que no se muestran. */
  omitted: number;
}

/** Cuántas filas se muestran como máximo. */
export const MAX_EXCERPT_ROWS = 12;
/** Si ninguna fila se destaca (la pregunta es sobre toda la tabla), cuántas se muestran. */
const FALLBACK_ROWS = 5;
const MAX_LABEL = 40;

interface ParsedRow {
  cells: Map<string, string>;
  raw: string;
}

/** Una línea «A: x; B: y» como fila; null si no tiene esa forma. */
function parseRow(line: string): ParsedRow | null {
  const parts = line.split(/;\s+(?=[^:;]{1,40}:\s)/u);
  const cells = new Map<string, string>();
  for (const part of parts) {
    const at = part.indexOf(": ");
    if (at <= 0 || at > MAX_LABEL) return null;
    cells.set(part.slice(0, at).trim(), part.slice(at + 2).trim());
  }
  return cells.size === 0 ? null : { cells, raw: line };
}

/**
 * La primera tabla del texto: dos o más líneas seguidas con forma de fila (las que tienen una sola
 * columna cuentan si su columna aparece en las demás: las celdas vacías no se escriben).
 */
function findTable(text: string): { headers: string[]; rows: ParsedRow[] } | null {
  const lines = text.split("\n").map((line) => line.trim());
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const row = parseRow(lines[i] ?? "");
    if (row === null || row.cells.size < 2) continue;
    start = i;
    break;
  }
  if (start === -1) return null;
  const rows: ParsedRow[] = [];
  const headers: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const row = parseRow(lines[i] ?? "");
    if (row === null) break;
    if (row.cells.size < 2 && ![...row.cells.keys()].every((label) => headers.includes(label)))
      break;
    for (const label of row.cells.keys()) if (!headers.includes(label)) headers.push(label);
    rows.push(row);
  }
  return rows.length >= 2 ? { headers, rows } : null;
}

/** Similitud por trigramas (Dice), para que una falta de ortografía igual encuentre su fila. */
function similarity(a: string, b: string): number {
  const grams = (value: string) => {
    const padded = `  ${value} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** ¿Alguna de las palabras de la pregunta aparece en el texto de la fila (con faltas incluidas)? */
function rowMatches(values: string, words: readonly string[]): boolean {
  const tokens = normalizeText(values)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3);
  return words.some((word) =>
    tokens.some(
      (token) =>
        token === word ||
        (word.length >= 5 &&
          (token.startsWith(word.slice(0, 5)) || word.startsWith(token.slice(0, 5)))) ||
        (word.length >= 5 && token.length >= 5 && similarity(word, token) >= 0.6),
    ),
  );
}

/**
 * Si la cita cae en una tabla del fragmento, el encabezado y las filas que importan: las que tienen
 * que ver con la pregunta; si ninguna, las que se citaron; si tampoco, las primeras.
 */
export function tableExcerpt(
  fragmentText: string,
  quote: string,
  words: readonly string[],
): TableExcerpt | null {
  const table = findTable(fragmentText);
  if (table === null) return null;
  const cited = normalizeText(quote);
  // La cita tiene que tocar la tabla: alguna de sus filas, o un trozo de una fila.
  const touches = table.rows.some((row) => {
    const raw = normalizeText(row.raw);
    return cited.includes(raw) || (cited.length >= 8 && raw.includes(cited));
  });
  if (!touches) return null;
  const valuesOf = (row: ParsedRow) => [...row.cells.values()].join(" ");
  // Las palabras que nombran una columna («línea», «alérgeno») describen la tabla, no una fila: no
  // sirven para elegir filas.
  const columnWords = table.headers.map((header) => normalizeText(header));
  const rowWords = words.filter(
    (word) =>
      !columnWords.some(
        (column) =>
          column === word ||
          (word.length >= 5 && column.length >= 5 && similarity(word, column) >= 0.6) ||
          (word.length >= 5 &&
            (column.startsWith(word.slice(0, 5)) || word.startsWith(column.slice(0, 5)))),
      ),
  );
  let chosen =
    rowWords.length === 0 ? [] : table.rows.filter((row) => rowMatches(valuesOf(row), rowWords));
  if (chosen.length === 0) {
    chosen = table.rows.filter((row) => cited.includes(normalizeText(row.raw)));
  }
  if (chosen.length === 0) chosen = table.rows.slice(0, FALLBACK_ROWS);
  const shown = chosen.slice(0, MAX_EXCERPT_ROWS);
  return {
    headers: table.headers,
    rows: shown.map((row) => table.headers.map((label) => row.cells.get(label) ?? "")),
    omitted: table.rows.length - shown.length,
  };
}
