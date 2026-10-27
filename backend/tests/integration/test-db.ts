import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Contraseña de los usuarios demo en la base de tests. */
export const TEST_DEMO_PASSWORD = "demo-de-tests-123";

/** Carga .env y devuelve la URL de la base de tests: la de desarrollo con sufijo _test. */
export function testDatabaseUrl(): string {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.DATABASE_URL;
  if (base === undefined || base === "") throw new Error("Falta DATABASE_URL en .env");
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return url.toString();
}
