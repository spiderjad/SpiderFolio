import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Las pruebas de almacenamiento usan el mismo .env que docker compose.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
