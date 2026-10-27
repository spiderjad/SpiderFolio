// Rutas de importación (carpetas y ZIP, docs/spec/adopcion.md 9C.2): una ruta relativa con
// carpetas separadas por "/" hasta un archivo. Una función pura decide si es aceptable; la usan el
// plan de importación de carpetas y el descompresor de ZIP, con las mismas reglas: nada de rutas
// absolutas, de "..", de barras invertidas ni de nombres inválidos, y un tope de profundidad.
import { NodeNameSchema } from "../../lib/names.ts";

/** Motivos por los que se omite un archivo al importar (se muestran en el resumen final). */
export const importSkipReasons = [
  "invalidPath",
  "tooDeep",
  "systemFile",
  "unsupportedType",
  "empty",
  "tooLarge",
  "nameTaken",
  "noPermission",
  "encrypted",
  "symlink",
  "suspiciousRatio",
  "sizeMismatch",
  "contentMismatch",
  "overQuota",
  "tooMany",
] as const;
export type ImportSkipReason = (typeof importSkipReasons)[number];

export type ParsedImportPath =
  { ok: true; dirs: string[]; name: string } | { ok: false; reason: ImportSkipReason };

// Archivos que los sistemas operativos agregan solos: no son contenido de la persona.
const SYSTEM_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/**
 * @param raw ruta relativa ("Calidad/Procedimientos/PR-01.pdf")
 * @param maxDirs cuántos niveles de carpetas caben bajo el destino
 */
export function parseImportPath(raw: string, maxDirs: number): ParsedImportPath {
  if (raw === "" || raw.includes("\\") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    return { ok: false, reason: "invalidPath" };
  }
  const parts = raw.split("/");
  // "a//b" y una barra final (una carpeta) no son archivos.
  if (parts.some((part) => part === "")) return { ok: false, reason: "invalidPath" };
  if (parts[0] === "__MACOSX") return { ok: false, reason: "systemFile" };
  const names: string[] = [];
  for (const part of parts) {
    const parsed = NodeNameSchema.safeParse(part);
    if (!parsed.success) return { ok: false, reason: "invalidPath" };
    names.push(parsed.data);
  }
  const name = names.at(-1) ?? "";
  if (SYSTEM_FILES.has(name.toLowerCase())) return { ok: false, reason: "systemFile" };
  const dirs = names.slice(0, -1);
  if (dirs.length > maxDirs) return { ok: false, reason: "tooDeep" };
  return { ok: true, dirs, name };
}

/** Límites de una importación (9C.2): 5.000 archivos. */
export const MAX_IMPORT_ENTRIES = 5000;

/** Marca de una carpeta a la que no se puede entrar (hay un archivo con ese nombre). */
export const BLOCKED: unique symbol = Symbol("blocked");
