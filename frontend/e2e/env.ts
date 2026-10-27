// Entorno de la API y el worker de los E2E: misma configuración local, otra base y otro origen.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E2E_API_PORT, E2E_DEMO_PASSWORD, E2E_WEB_URL } from "./config.ts";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

export function e2eDatabaseUrl(): string {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.DATABASE_URL;
  if (base === undefined || base === "") throw new Error("Falta DATABASE_URL en .env");
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_e2e$/, "")}_e2e`;
  return url.toString();
}

export function e2eBackendEnv(): Record<string, string> {
  const databaseUrl = e2eDatabaseUrl(); // carga .env primero
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    NODE_ENV: "test",
    PORT: String(E2E_API_PORT),
    APP_URL: E2E_WEB_URL,
    DATABASE_URL: databaseUrl,
    SEED_DEMO_PASSWORD: E2E_DEMO_PASSWORD,
  };
}
