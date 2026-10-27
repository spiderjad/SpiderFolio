// Verificación sin conexión de la licencia de plugins (docs/spec/plugins.md): firma Ed25519 sobre
// «SFL1.<payload>», payload válido y no vencido. Nunca llama a ningún servidor.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  LicensePayloadSchema,
  splitLicense,
  type LicensePayload,
  type LicenseStatus,
} from "@spiderfolio/plugin-sdk";
import { LICENSE_PUBLIC_KEY_PEM } from "./license-key.ts";

const defaultKey = createPublicKey(LICENSE_PUBLIC_KEY_PEM);

export interface VerifyOptions {
  now?: Date;
  /** Solo tests: otra clave pública. */
  publicKey?: KeyObject;
}

export function verifyLicense(
  token: string | null | undefined,
  options: VerifyOptions = {},
): LicenseStatus {
  if (token === null || token === undefined || token.trim() === "") return { state: "none" };
  const parts = splitLicense(token);
  if (parts === null) return { state: "invalid", reason: "format" };
  const key = options.publicKey ?? defaultKey;
  if (key.asymmetricKeyType !== "ed25519") return { state: "invalid", reason: "signature" };
  if (!verify(null, parts.signed, key, parts.signature)) {
    return { state: "invalid", reason: "signature" };
  }
  let json: unknown;
  try {
    json = JSON.parse(parts.payloadJson);
  } catch {
    return { state: "invalid", reason: "payload" };
  }
  const parsed = LicensePayloadSchema.safeParse(json);
  if (!parsed.success) return { state: "invalid", reason: "payload" };
  const payload: LicensePayload = parsed.data;
  const now = options.now ?? new Date();
  if (payload.expiresAt !== null && new Date(payload.expiresAt).getTime() <= now.getTime()) {
    return { state: "expired", payload };
  }
  return { state: "valid", payload };
}

/** Plugins que una licencia activa ahora (vacío si no es válida o venció). */
export function licensedPlugins(status: LicenseStatus): ReadonlySet<string> {
  return status.state === "valid" ? new Set(status.payload.plugins) : new Set();
}
