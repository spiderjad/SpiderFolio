// Cifrado del secreto TOTP de cada persona: AES-256-GCM con `MFA_ENCRYPTION_KEY` (clave propia, no la
// del SMTP). Formato `<idDeClave>:iv:tag:texto`. El id de clave deja rotar: una clave nueva recibe otro
// id, las anteriores se siguen aceptando para descifrar y lo nuevo se cifra con la vigente. El
// userId va como dato autenticado (AAD): un secreto copiado a otra cuenta no descifra.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Env } from "../config/env.ts";

/** Identificador de la clave vigente. Al rotar se agrega la nueva con otro id y se cambia este. */
export const CURRENT_MFA_KEY_ID = "k1";
const IV_BYTES = 12;

export interface MfaBox {
  encrypt(userId: string, plaintext: string): string;
  /** Lanza si el texto fue alterado, es de otra cuenta, la clave no coincide o el id es desconocido. */
  decrypt(userId: string, payload: string): string;
  /** Id de clave con el que se cifró un valor (para saber qué hay que re-cifrar al rotar). */
  keyIdOf(payload: string): string | null;
}

export function createMfaBox(env: Pick<Env, "MFA_ENCRYPTION_KEY">): MfaBox {
  const encoded = env.MFA_ENCRYPTION_KEY;
  if (encoded === undefined) throw new Error("MFA_ENCRYPTION_KEY no está configurada");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY debe ser de 32 bytes");
  const keys = new Map<string, Buffer>([[CURRENT_MFA_KEY_ID, key]]);
  const aad = (userId: string) => Buffer.from(`mfa:${userId}`, "utf8");

  return {
    encrypt(userId, plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(userId));
      const text = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [
        CURRENT_MFA_KEY_ID,
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        text.toString("base64"),
      ].join(":");
    },
    decrypt(userId, payload) {
      const [keyId, iv, tag, text, extra] = payload.split(":");
      const selected = keyId === undefined ? undefined : keys.get(keyId);
      if (
        selected === undefined ||
        iv === undefined ||
        tag === undefined ||
        text === undefined ||
        extra !== undefined
      ) {
        throw new Error("Secreto con formato o clave desconocidos");
      }
      const decipher = createDecipheriv("aes-256-gcm", selected, Buffer.from(iv, "base64"));
      decipher.setAAD(aad(userId));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(text, "base64")),
        decipher.final(),
      ]).toString("utf8");
    },
    keyIdOf(payload) {
      const id = payload.split(":")[0];
      return id !== undefined && keys.has(id) ? id : null;
    },
  };
}
