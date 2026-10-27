// Límites de una empresa (docs/spec/limites.md). SpiderFolio no tiene planes: por defecto no hay
// ningún límite (null = ilimitado) y el administrador fija los que le sirvan. En código solo quedan las
// claves que el producto sabe aplicar; los valores viven en Workspace.limits.
import { z } from "zod";

export const limitKeys = [
  /** Almacenamiento total del workspace, en GB. */
  "storageGb",
  /** Tamaño máximo de un archivo, en MB. */
  "maxFileMb",
  /** Versiones guardadas de cada archivo común (la vigente nunca se borra). */
  "fileVersionsKept",
  /** Días que se conserva el registro de auditoría. */
  "auditRetentionDays",
  /** Total de consultas a Bian por mes calendario en toda la empresa. */
  "aiQueriesPerMonth",
] as const;

export const LimitKeySchema = z.enum(limitKeys);
export type LimitKey = z.infer<typeof LimitKeySchema>;

/** null = ilimitado. */
export const LimitValueSchema = z.int().nonnegative().max(1_000_000_000).nullable();

export type Limits = Record<LimitKey, number | null>;

/** Lo guardado en Workspace.limits: solo las claves fijadas. */
export const StoredLimitsSchema = z.partialRecord(LimitKeySchema, LimitValueSchema);
export type StoredLimits = z.infer<typeof StoredLimitsSchema>;

/** Mínimos razonables al fijar un límite (evita dejar la empresa sin poder subir nada por error). */
export const limitMinimums: Partial<Record<LimitKey, number>> = {
  maxFileMb: 1,
  fileVersionsKept: 1,
  auditRetentionDays: 30,
};

/** Límites efectivos: lo guardado y, para lo demás, ilimitado. Lo inválido se ignora. */
export function resolveLimits(stored: unknown): Limits {
  const parsed = StoredLimitsSchema.safeParse(stored);
  const values: StoredLimits = parsed.success ? parsed.data : {};
  return Object.fromEntries(limitKeys.map((key) => [key, values[key] ?? null])) as Limits;
}
