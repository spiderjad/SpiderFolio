// Protecciones del seed: crea usuarios con una contraseña conocida, así que solo corre contra
// una base local y nunca en producción (CLAUDE.md, secciones 3 y 17).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface SeedEnv {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  SEED_DEMO_PASSWORD?: string | undefined;
}

export interface SeedTarget {
  databaseUrl: string;
  demoPassword: string;
}

export function assertSafeSeedTarget(env: SeedEnv): SeedTarget {
  if (env.NODE_ENV === "production") {
    throw new Error("El seed no corre con NODE_ENV=production");
  }
  const databaseUrl = env.DATABASE_URL ?? "";
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL inválida o vacía");
  }
  if (!LOCAL_HOSTS.has(host)) {
    // Sin mostrar la URL: puede llevar credenciales.
    throw new Error("El seed solo corre contra una base local (localhost o 127.0.0.1)");
  }
  const demoPassword = env.SEED_DEMO_PASSWORD ?? "";
  if (demoPassword.length < 10) {
    throw new Error("Falta SEED_DEMO_PASSWORD en .env (mínimo 10 caracteres)");
  }
  return { databaseUrl, demoPassword };
}
