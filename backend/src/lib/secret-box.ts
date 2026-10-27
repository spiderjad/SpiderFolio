// Cifrado de secretos guardados por empresa (la contraseña del SMTP propio): AES-256-GCM con
// `EMAIL_ENCRYPTION_KEY`. El workspaceId va como dato autenticado (AAD): un texto cifrado copiado a
// otra empresa no descifra. El prefijo `v1` deja rotar la clave más adelante.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { Env } from "../config/env.ts";

const VERSION = "v1";
const IV_BYTES = 12;

export interface SecretBox {
  encrypt(workspaceId: string, plaintext: string): string;
  /** Lanza si el texto fue alterado, es de otra empresa o la clave no es la misma. */
  decrypt(workspaceId: string, payload: string): string;
  /** Huella con clave (HMAC-SHA256) ligada a la empresa: no se puede reproducir sin la clave. */
  mac(workspaceId: string, data: string): string;
}

export function createSecretBox(env: Pick<Env, "EMAIL_ENCRYPTION_KEY">): SecretBox {
  const encoded = env.EMAIL_ENCRYPTION_KEY;
  if (encoded === undefined) throw new Error("EMAIL_ENCRYPTION_KEY no está configurada");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("EMAIL_ENCRYPTION_KEY debe ser de 32 bytes");

  return {
    encrypt(workspaceId, plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(workspaceId, "utf8"));
      const text = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [
        VERSION,
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        text.toString("base64"),
      ].join(":");
    },
    mac(workspaceId, data) {
      return createHmac("sha256", key).update(`${workspaceId}\n${data}`).digest("hex");
    },
    decrypt(workspaceId, payload) {
      const [version, iv, tag, text, extra] = payload.split(":");
      if (
        version !== VERSION ||
        iv === undefined ||
        tag === undefined ||
        text === undefined ||
        extra !== undefined
      ) {
        throw new Error("Secreto con formato desconocido");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAAD(Buffer.from(workspaceId, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(text, "base64")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
