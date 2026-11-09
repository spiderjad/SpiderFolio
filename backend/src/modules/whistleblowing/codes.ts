// The reporter's follow-up code (docs/spec/canal-denuncias.md, «Buzón del informante»): 16 random
// characters from Crockford's base32 (~80 bits), shown once and kept only as a hash bound to the
// company, so the code alone finds the case without its id. A password guards it too.
import { randomInt } from "node:crypto";
import { sha256 } from "../../lib/crypto.ts";

/** Crockford's base32: no I, L, O or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 16;

/** «7K2M-9QXR-4TBD-H3WP». */
export function newFollowUpCode(): string {
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)] ?? "0";
  return code.match(/.{4}/gu)?.join("-") ?? code;
}

/** What's typed, as it's hashed: capitals, without dashes or spaces, look-alikes fixed. */
function normalize(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/gu, "").replace(/O/gu, "0").replace(/[IL]/gu, "1");
}

export const followUpHash = (workspaceId: string, code: string): string =>
  sha256(`whistleblowing:${workspaceId}:${normalize(code)}`);
