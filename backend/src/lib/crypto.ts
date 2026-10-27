import { createHash, randomBytes } from "node:crypto";

/** Token opaco aleatorio (32 bytes, base64url). Se entrega una vez; en la base va su hash. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
