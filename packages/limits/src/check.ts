// Comprobación pura de un límite (usado + reservado + pedido ≤ máximo) y nivel de uso para los avisos.
import type { LimitKey, Limits } from "./schema.ts";
import { bytesToJson, limitInBaseUnits } from "./units.ts";

export const LIMIT_REACHED = "LIMIT_REACHED";

export interface LimitUsage {
  /** Consumo actual, en la unidad base (bytes para storageGb y maxFileMb). */
  used: number | bigint;
  /** Reservado y todavía no confirmado (ej. subidas en curso). */
  reserved?: number | bigint;
  /** Lo que se quiere agregar. */
  requested: number | bigint;
}

/** Error LIMIT_REACHED. Cantidades en la unidad base: bytes o unidades. */
export interface LimitReached {
  code: typeof LIMIT_REACHED;
  limit: LimitKey;
  used: number;
  max: number;
}

export type LimitCheck = { ok: true } | { ok: false; error: LimitReached };

export function checkLimit(limits: Limits, key: LimitKey, usage: LimitUsage): LimitCheck {
  const max = limitInBaseUnits(key, limits[key]);
  if (max === null) return { ok: true };

  const consumed = BigInt(usage.used) + BigInt(usage.reserved ?? 0);
  if (consumed + BigInt(usage.requested) <= max) return { ok: true };

  return {
    ok: false,
    error: { code: LIMIT_REACHED, limit: key, used: bytesToJson(consumed), max: bytesToJson(max) },
  };
}

/** Porcentajes de aviso al acercarse a un límite. */
export const USAGE_THRESHOLDS = [80, 95] as const;

export interface UsageLevel {
  /** Porcentaje usado (dos decimales); null si el límite es ilimitado. */
  percent: number | null;
  /** Mayor umbral de aviso alcanzado (ej. 80 o 95), o null. */
  threshold: number | null;
  atLimit: boolean;
}

/** Nivel de uso. used y max en la misma unidad. */
export function usageLevel(
  thresholds: readonly number[],
  used: number | bigint,
  max: number | bigint | null,
): UsageLevel {
  if (max === null) return { percent: null, threshold: null, atLimit: false };
  const u = BigInt(used);
  const m = BigInt(max);
  const percent = m === 0n ? 100 : Number((u * 10000n) / m) / 100;
  const reached = thresholds.filter((t) => percent >= t);
  return {
    percent,
    threshold: reached.length > 0 ? Math.max(...reached) : null,
    atLimit: u >= m,
  };
}
