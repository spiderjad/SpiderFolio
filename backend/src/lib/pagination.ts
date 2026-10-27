// Paginación común (CLAUDE.md, sección 17): todas las listas paginan, ordenan y filtran en el
// servidor. pageSize máximo 100 y por defecto 25; el orden es siempre estable (id de
// desempate). Toda lista se pide por cursor (`cursor` → `nextCursor`, scroll infinito en la app):
// en las tablas con varios criterios de orden y filtros el cursor es opaco y guarda la posición
// dentro de ese orden estable; las listas que crecen sin parar (auditoría, notificaciones,
// actividad, archivos) usan además el cursor por último elemento visto (`cursorPageOf`).
import { z } from "zod";
import { validationMessages } from "../i18n/index.ts";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE = 10_000;

/**
 * Ids separados por coma (hasta 50): los combobox los piden para mostrar lo que ya está elegido
 * sin importar en qué página caería.
 */
export const IdsParam = z
  .string()
  .max(1000)
  .transform((value) => [...new Set(value.split(",").filter((id) => id !== ""))].slice(0, 50))
  .optional();

/** Búsqueda de texto libre, recortada. */
export const SearchParam = z.string().trim().max(100).optional();

/**
 * Campos de paginación y orden de una tabla con offset: page, pageSize, sort y dir.
 * Se mezcla con los filtros propios: `z.object({ ...pageShape(fields, "name"), q: SearchParam })`.
 */
export function pageShape<const F extends readonly [string, ...string[]]>(
  sortFields: F,
  defaultSort: F[number],
  options: { defaultPageSize?: number } = {},
) {
  return {
    page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
    /** Cursor opaco de la página siguiente (el `nextCursor` de la respuesta anterior). */
    cursor: z
      .string()
      .max(100)
      .refine((value) => decodeOffsetCursor(value) !== null, { error: () => validationMessages.invalidCursor })
      .optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(options.defaultPageSize ?? DEFAULT_PAGE_SIZE),
    sort: z.enum(sortFields).default(defaultSort),
    dir: z.enum(["asc", "desc"]).default("asc"),
  };
}

export interface PageQuery {
  page: number;
  pageSize: number;
  cursor?: string | undefined;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Cursor de la página siguiente; null si no hay más. */
  nextCursor: string | null;
}

/** Cursor opaco de posición: cuántos elementos del orden estable ya se entregaron. */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

/** null si el cursor no es válido. */
export function decodeOffsetCursor(cursor: string): number | null {
  try {
    const parsed = z
      .strictObject({
        o: z
          .number()
          .int()
          .min(0)
          .max(MAX_PAGE * MAX_PAGE_SIZE),
      })
      .safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return parsed.success ? parsed.data.o : null;
  } catch {
    return null;
  }
}

/** Cuántos elementos ya se entregaron antes de la página pedida (por cursor o por número). */
function startOf(query: PageQuery): number {
  const fromCursor = query.cursor === undefined ? null : decodeOffsetCursor(query.cursor);
  return fromCursor ?? (query.page - 1) * query.pageSize;
}

/** skip/take de Prisma para la página pedida. */
export function offsetArgs(query: PageQuery): { skip: number; take: number } {
  return { skip: startOf(query), take: query.pageSize };
}

/** Cursor de lo que sigue después de `count` elementos entregados desde `start`; null si no hay. */
export function nextOffsetCursor(start: number, count: number, total: number): string | null {
  return start + count < total ? encodeOffsetCursor(start + count) : null;
}

export function pageOf<T>(items: T[], total: number, query: PageQuery): Page<T> {
  const start = startOf(query);
  return {
    items,
    total,
    page: Math.floor(start / query.pageSize) + 1,
    pageSize: query.pageSize,
    nextCursor: nextOffsetCursor(start, items.length, total),
  };
}

/** Orden estable: el criterio pedido y el id como desempate. */
export function stableOrder<T extends object>(primary: T | T[]): (T | { id: "asc" })[] {
  return [...(Array.isArray(primary) ? primary : [primary]), { id: "asc" }];
}

// ─── Cursor ──────────────────────────────────────────────────────────────────────────────

/** Cursor opaco de una lista que crece: el último elemento visto (valor de orden + id). */
export interface CursorPosition {
  /** Valor del campo de orden del último elemento (fecha ISO, número o texto). */
  v: string | number;
  id: string;
}

export const CursorQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorQuery = z.infer<typeof CursorQuerySchema>;

const CursorPositionSchema = z.strictObject({
  v: z.union([z.string().max(100), z.number()]),
  id: z.string().min(1).max(64),
});

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

/** null si no hay cursor o no es válido (se trata como la primera página). */
export function decodeCursor(cursor: string | undefined): CursorPosition | null {
  if (cursor === undefined || cursor === "") return null;
  try {
    const parsed = CursorPositionSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Recibe hasta limit + 1 filas (la consulta pide una de más para saber si hay otra página) y
 * arma la página con el cursor del último elemento devuelto.
 */
export function cursorPageOf<T>(
  rows: T[],
  limit: number,
  positionOf: (row: T) => CursorPosition,
): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last !== undefined ? encodeCursor(positionOf(last)) : null;
  return { items, nextCursor };
}
