// Arranque de la API en la imagen de Docker: aplica las migraciones pendientes de Prisma (esperando a que
// la base responda) y arranca el servidor. Las migraciones de los plugins las aplica el propio servidor
// al cargarlos. Uso: node backend/scripts/start.ts
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const backend = fileURLToPath(new URL("..", import.meta.url));
const MAX_ATTEMPTS = 30;

for (let attempt = 1; ; attempt++) {
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: backend, stdio: "inherit" });
    break;
  } catch (error) {
    if (attempt >= MAX_ATTEMPTS) throw error;
    console.error(`La base todavía no responde o falló la migración (intento ${String(attempt)}); reintento en 2 s`);
    await sleep(2000);
  }
}

await import("../src/server.ts");
