// Contraseñas con argon2id (CLAUDE.md, sección 7.3): memoryCost 19456, timeCost 2,
// parallelism 1 (OWASP; argon2 usa p=4 si no se fija).
//
// - Un semáforo limita los hashes simultáneos por instancia: cada uno usa ~19 MB, y una ráfaga
//   de logins no puede agotar la memoria.
// - Hash de relleno: cuando el email no existe o la cuenta está bloqueada se verifica igual
//   contra él, así los tres casos hacen el mismo trabajo y tardan lo mismo.
import { randomBytes } from "node:crypto";
import argon2 from "argon2";

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const MAX_CONCURRENT_HASHES = 4;

export interface Passwords {
  hash(password: string): Promise<string>;
  /** false también si el hash está corrupto: nunca lanza por un hash inválido. */
  verify(hash: string, password: string): Promise<boolean>;
  /** Verificación contra el hash de relleno (resultado descartado), para igualar tiempos. */
  verifyDummy(password: string): Promise<void>;
  needsRehash(hash: string): boolean;
}

function createSemaphore(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export async function createPasswords(): Promise<Passwords> {
  const limit = createSemaphore(MAX_CONCURRENT_HASHES);
  const dummyHash = await argon2.hash(randomBytes(32).toString("base64url"), ARGON2_OPTIONS);

  const verify = (hash: string, password: string) =>
    limit(async () => {
      try {
        return await argon2.verify(hash, password);
      } catch {
        return false;
      }
    });

  return {
    hash: (password) => limit(() => argon2.hash(password, ARGON2_OPTIONS)),
    verify,
    async verifyDummy(password) {
      await verify(dummyHash, password);
    },
    needsRehash: (hash) => argon2.needsRehash(hash, ARGON2_OPTIONS),
  };
}
