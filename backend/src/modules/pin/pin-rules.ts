// Reglas puras del ingreso con usuario + PIN (CLAUDE.md, sección 7.6), sin base de datos.
import { randomInt } from "node:crypto";

export const PIN_LENGTH = 6;
/** Fallos seguidos que bloquean la cuenta. */
export const MAX_PIN_FAILURES = 5;
/** Primer bloqueo; cada bloqueo consecutivo duplica el tiempo, hasta el tope. */
export const PIN_LOCK_BASE_MS = 15 * 60 * 1000;
export const PIN_LOCK_MAX_MS = 60 * 60 * 1000;
/** Tope absoluto de una sesión de tablet, por mucho que se use. */
export const KIOSK_MAX_AGE_MS = 8 * 3600 * 1000;

const LOGIN_NAME = /^[a-z0-9._-]{3,32}$/;
const PIN_FORMAT = new RegExp(`^\\d{${String(PIN_LENGTH)}}$`);

/** Forma guardada del usuario: sin espacios, NFKC y en minúsculas. */
export function normalizeLoginName(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export function isValidLoginName(value: string): boolean {
  return LOGIN_NAME.test(value);
}

export function isPinFormat(value: string): boolean {
  return PIN_FORMAT.test(value);
}

/** Duración del bloqueo número `lockCount` (1 = el primero): 15, 30 y 60 min, y 60 después. */
export function pinLockMs(lockCount: number): number {
  const doublings = Math.min(Math.max(0, lockCount - 1), 10);
  return Math.min(PIN_LOCK_BASE_MS * 2 ** doublings, PIN_LOCK_MAX_MS);
}

/**
 * PIN fácil de adivinar: un solo dígito repetido, secuencias seguidas (123456, 654321) o un
 * patrón de 2 o 3 dígitos que se repite (121212, 123123).
 */
export function isWeakPin(pin: string): boolean {
  const digits = Array.from({ length: pin.length }, (_, i) => Number(pin.charAt(i)));
  const steps = digits.slice(1).map((d, i) => d - (digits[i] ?? 0));
  if (steps.every((s) => s === 0)) return true;
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  const repeats = (period: number) =>
    digits.every((d, i) => i < period || d === digits[i - period]);
  return repeats(2) || repeats(3);
}

/** PIN aleatorio (criptográfico) que no sea débil. */
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
    if (!isWeakPin(pin)) return pin;
  }
}
