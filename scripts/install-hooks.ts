// Activa los hooks de git del repositorio (.githooks). Corre solo tras `npm install` (script
// «prepare»); sin .git (ej. una imagen de Docker) no hace nada.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git")) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  } catch {
    // Sin git instalado: los hooks se activan a mano con `npm run hooks:install`.
  }
}
