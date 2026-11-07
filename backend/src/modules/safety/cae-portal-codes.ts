// The contractor's portal code (docs/spec/cae.md, «Portal de contratas»): 12 random characters from an
// alphabet without look-alikes (~60 bits), shown once and kept only as a hash bound to its access, like
// the audit rooms' codes. With the per-access lock and the per-address limits it can't be guessed.
import { randomInt, timingSafeEqual } from "node:crypto";
import { sha256 } from "../../lib/crypto.ts";

/** Crockford's base32: no I, L, O or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 12;

/** «7K2M-9QXR-4TBD». */
export function newPortalCode(): string {
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)] ?? "0";
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/** What's typed, as it's hashed: capitals, without dashes or spaces, look-alikes fixed. */
export function normalizePortalCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/gu, "").replace(/O/gu, "0").replace(/[IL]/gu, "1");
}

export const portalCodeHash = (accessId: string, code: string): string =>
  sha256(`${accessId}:${normalizePortalCode(code)}`);

export function samePortalHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
