// Arranque de la API en la imagen de Docker: aplica las migraciones pendientes de Prisma (esperando a que
// la base responda) y arranca el servidor. Las migraciones de los plugins las aplica el propio servidor
// al cargarlos. Uso: node backend/scripts/start.ts
//
// Con API_PROCESSES > 1 (una planta con mucha gente a la vez), la API corre en varios procesos que
// comparten el puerto (node:cluster), uno por núcleo: el primero arranca solo (aplica las migraciones de
// los plugins y abre el puerto) y después los demás. Si uno termina (un reinicio programado, un fallo),
// se cierran todos con su mismo código y Docker vuelve a arrancar el contenedor, como con uno solo.
import { execFileSync } from "node:child_process";
import cluster from "node:cluster";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const backend = fileURLToPath(new URL("..", import.meta.url));
const MAX_ATTEMPTS = 30;
const parsed = Number.parseInt(process.env.API_PROCESSES ?? "1", 10);
const processes = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 32) : 1;

if (cluster.isPrimary) {
  for (let attempt = 1; ; attempt++) {
    try {
      // On Windows npx is a .cmd: it needs the shell (the arguments are fixed, nothing from outside).
      execFileSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: backend,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      break;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      console.error(
        `La base todavía no responde o falló la migración (intento ${String(attempt)}); reintento en 2 s`,
      );
      await sleep(2000);
    }
  }
}

if (processes === 1 || cluster.isWorker) {
  await import("../src/server.ts");
} else {
  let stopping = false;
  const stopAll = (code: number) => {
    if (stopping) return;
    stopping = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill("SIGTERM");
    // Each one closes in order (server.ts gives in-flight requests their time); then this one goes.
    const wait = setInterval(() => {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        clearInterval(wait);
        process.exit(code);
      }
    }, 200);
    setTimeout(() => process.exit(code), 30_000).unref();
  };
  cluster.on("exit", (_worker, code) => {
    // Killed by a signal, the code comes as null whatever the types say.
    stopAll(Number.isInteger(code) ? code : 1);
  });
  process.once("SIGTERM", () => {
    stopAll(0);
  });
  process.once("SIGINT", () => {
    stopAll(0);
  });
  // The first alone (the plugins' migrations, the queues), then the rest.
  cluster.fork().once("listening", () => {
    for (let index = 1; index < processes && !stopping; index++) cluster.fork();
    console.log(`API en ${String(processes)} procesos`);
  });
}
