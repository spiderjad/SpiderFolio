// Offline verification of the plugin license (docs/spec/plugins.md): Ed25519 signature over
// «SFL1.<payload>», a valid payload, not expired and, if it names a company, that company. It never
// calls any server.
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
  /** Tests only: another public key. */
  publicKey?: KeyObject;
  /** The company checking it: a license for another company (workspaceId) is invalid here. */
  workspaceId?: string;
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
  if (
    payload.workspaceId !== undefined &&
    options.workspaceId !== undefined &&
    payload.workspaceId !== options.workspaceId
  ) {
    return { state: "invalid", reason: "workspace" };
  }
  const now = options.now ?? new Date();
  if (payload.expiresAt !== null && new Date(payload.expiresAt).getTime() <= now.getTime()) {
    return { state: "expired", payload };
  }
  return { state: "valid", payload };
}

/** Plugins a license activates now (empty if it isn't valid or has expired). */
export function licensedPlugins(status: LicenseStatus): ReadonlySet<string> {
  return status.state === "valid" ? new Set(status.payload.plugins) : new Set();
}
