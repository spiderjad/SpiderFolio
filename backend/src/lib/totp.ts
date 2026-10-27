// TOTP (RFC 6238) con node:crypto: sin dependencias. SHA-1, 6 dígitos y paso de 30 segundos, que es lo
// que entienden Google Authenticator y Microsoft Authenticator. Todo lo de acá es lógica pura (el reloj
// y el azar se pasan como parámetros) para poder probarla con los vectores del RFC.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Pasos aceptados a cada lado del actual: tolera el desfase del reloj del teléfono (±30 s). */
export const TOTP_WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replaceAll(/[\s=-]/gu, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Base32 no válido");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo: 20 bytes (160 bits) en base32, el tamaño que recomienda el RFC 4226. */
export function generateTotpSecret(random: (size: number) => Buffer = randomBytes): string {
  return base32Encode(random(20));
}

/** HOTP (RFC 4226) de un contador. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(message).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 15;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Número de paso (30 s) de un instante. */
export const stepOf = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secretBase32: string, at: Date): string {
  return hotp(base32Decode(secretBase32), stepOf(at));
}

const sameText = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Comprueba un código y devuelve el paso en que coincide (null si no). `lastStep` es el último paso ya
 * aceptado: un código de ese paso o de uno anterior no vale otra vez (un código no se reutiliza).
 * Se recorren todos los pasos de la ventana sin cortar antes, para no filtrar cuál acertó.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  at: Date,
  lastStep: number | null = null,
): number | null {
  const clean = code.replaceAll(/\s/gu, "");
  if (!/^\d{6}$/u.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepOf(at);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (sameText(hotp(secret, step), clean) && (lastStep === null || step > lastStep)) {
      matched = matched === null ? step : Math.max(matched, step);
    }
  }
  return matched;
}

/** Enlace otpauth:// que leen las apps al escanear el QR. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

// ─── Códigos de recuperación ─────────────────────────────────────────────────────────────

/** Sin 0/O/1/I/L: se leen y se escriben a mano sin errores. */
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RECOVERY_CODE_COUNT = 10;

/** `XXXXX-XXXXX`: 10 caracteres de un alfabeto de 31 (≈ 49 bits). */
export function generateRecoveryCode(random: (size: number) => Buffer = randomBytes): string {
  const chars: string[] = [];
  // Se descartan los bytes que sesgarían el reparto entre los 31 caracteres.
  while (chars.length < 10) {
    for (const byte of random(16)) {
      if (byte < 248 && chars.length < 10) chars.push(RECOVERY_ALPHABET.charAt(byte % 31));
    }
  }
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

export function generateRecoveryCodes(random: (size: number) => Buffer = randomBytes): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(generateRecoveryCode(random));
  return [...codes];
}

/** Forma canónica: sin guion ni espacios, en mayúsculas. */
export const normalizeRecoveryCode = (code: string): string =>
  code.replaceAll(/[\s-]/gu, "").toUpperCase();

export const looksLikeRecoveryCode = (code: string): boolean =>
  new RegExp(`^[${RECOVERY_ALPHABET}]{10}$`, "u").test(normalizeRecoveryCode(code));

/** Huella que se guarda (los códigos solo se muestran una vez; el azar es alto: alcanza SHA-256). */
export const hashRecoveryCode = (code: string): string =>
  createHash("sha256")
    .update(`recovery:${normalizeRecoveryCode(code)}`)
    .digest("hex");
