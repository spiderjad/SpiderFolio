// Recarga en desarrollo para la API y el worker: `node scripts/dev-watch.ts src/server.ts`.
//
// Reemplaza a `node --watch`, que en Windows reinicia el proceso cuando un archivo del grafo de
// módulos solo se LEE: NTFS actualiza la hora de último acceso (como mucho una vez por hora por
// archivo) y fs.watch lo informa como "change". Cualquier lectura (tsc, ESLint, Vitest, el
// editor o el propio proceso al cargar un módulo) disparaba reinicios. Acá un evento solo
// cuenta si cambió el contenido: mtime o tamaño, o el archivo apareció o desapareció.
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, statSync, watch } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** mtime y tamaño; null si el archivo no existe. */
export type Fingerprint = string | null;

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

export function fingerprint(path: string): Fingerprint {
  try {
    const stats = statSync(path);
    return stats.isFile() ? `${String(stats.mtimeMs)}:${String(stats.size)}` : null;
  } catch {
    return null;
  }
}

export function isIgnored(path: string): boolean {
  return path.split(/[\\/]/).some((part) => IGNORED_DIRS.has(part));
}

/** Huellas de todos los archivos bajo `dir`, sin node_modules ni similares. */
export function snapshot(dir: string, into = new Map<string, Fingerprint>()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) snapshot(path, into);
    else if (entry.isFile()) into.set(path, fingerprint(path));
  }
  return into;
}

/** Actualiza la huella de `path` y dice si su contenido cambió (no basta con leerlo). */
export function recordChange(known: Map<string, Fingerprint>, path: string): boolean {
  const next = fingerprint(path);
  const previous = known.get(path) ?? null;
  if (next === null) known.delete(path);
  else known.set(path, next);
  return next !== previous;
}

function main(entry: string): void {
  const backendDir = fileURLToPath(new URL("..", import.meta.url));
  const envFile = resolve(backendDir, "../.env");
  const roots = [resolve(backendDir, "src"), resolve(backendDir, "../packages")];

  const known = new Map<string, Fingerprint>();
  for (const root of roots) snapshot(root, known);
  known.set(envFile, fingerprint(envFile));

  let child: ChildProcess | undefined;
  let restartTimer: NodeJS.Timeout | undefined;
  let stopping = false;

  const start = () => {
    const proc = spawn(process.execPath, ["--env-file-if-exists=../.env", entry], {
      cwd: backendDir,
      stdio: "inherit",
    });
    proc.on("exit", (code, signal) => {
      if (child === proc) child = undefined;
      if (!stopping && signal === null) {
        console.log(
          `'${entry}' terminó (código ${String(code)}); esperando cambios para reiniciar`,
        );
      }
    });
    child = proc;
  };

  const restart = (trigger: string) => {
    console.log(`Reiniciando '${entry}' (${relative(backendDir, trigger)})`);
    const current = child;
    if (current === undefined) {
      start();
      return;
    }
    current.once("exit", start);
    current.kill("SIGTERM");
  };

  const onEvent = (path: string) => {
    if (isIgnored(path) || !recordChange(known, path)) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restart(path);
    }, 150);
  };

  for (const root of roots) {
    watch(root, { recursive: true }, (_event, name) => {
      if (name !== null) onEvent(join(root, name));
    });
  }
  watch(resolve(backendDir, ".."), (_event, name) => {
    if (name === ".env") onEvent(envFile);
  });

  const stop = () => {
    stopping = true;
    if (child === undefined) process.exit(0);
    child.once("exit", () => process.exit(0));
    child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  start();
}

if (import.meta.main) {
  const entry = process.argv[2];
  if (entry === undefined) throw new Error("Uso: node scripts/dev-watch.ts <archivo de entrada>");
  main(entry);
}
