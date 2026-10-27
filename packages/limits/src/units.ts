// Unidades de almacenamiento: 1 GB = 1024³ bytes y 1 MB = 1024², igual en límites, interfaz y
// conciliación con el almacenamiento. Internamente los bytes son BigInt; en las respuestas de la API
// viajan como number.
import type { LimitKey } from "./schema.ts";

export const BYTES_PER_MB = 1024n ** 2n;
export const BYTES_PER_GB = 1024n ** 3n;

/** Factor de los límites que se expresan en bytes; el resto se cuenta en unidades. */
const baseUnit: Partial<Record<LimitKey, bigint>> = {
  storageGb: BYTES_PER_GB,
  maxFileMb: BYTES_PER_MB,
};

/** Si el límite se mide en bytes (storageGb, maxFileMb). */
export function isByteLimit(key: LimitKey): boolean {
  return key in baseUnit;
}

/** Valor del límite en su unidad base (bytes o unidades). null = ilimitado. */
export function limitInBaseUnits(key: LimitKey, value: number | null): bigint | null {
  if (value === null) return null;
  return BigInt(value) * (baseUnit[key] ?? 1n);
}

/**
 * Bytes para una respuesta JSON. number es exacto hasta Number.MAX_SAFE_INTEGER
 * (≈ 9 PB, 8 PiB), muy por encima de cualquier cuota.
 */
export function bytesToJson(bytes: bigint): number {
  if (bytes < 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Cantidad de bytes fuera de rango: ${bytes.toString()}`);
  }
  return Number(bytes);
}

/** Bytes recibidos como number (ej. tamaño declarado de una subida). */
export function bytesFromJson(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Cantidad de bytes inválida: ${String(value)}`);
  }
  return BigInt(value);
}
