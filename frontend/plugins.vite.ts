// Módulo virtual «virtual:spiderfolio-plugins» (docs/spec/plugins.md): la lista de la parte de app de
// cada plugin instalado, para incluirla al compilar. Busca en PLUGINS_DIR (por defecto plugins/ en la
// raíz) las carpetas cuyo package.json declara «spiderfolio.frontend», y en PLUGIN_PACKAGES los paquetes
// npm. Sin plugins, el módulo exporta una lista vacía.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:spiderfolio-plugins";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface Manifest {
  id?: unknown;
  frontend?: unknown;
}

function frontendEntries(): string[] {
  const dirs: string[] = [];
  const pluginsDir = resolve(ROOT, process.env.PLUGINS_DIR ?? "plugins");
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith("."))
        dirs.push(join(pluginsDir, entry.name));
    }
  }
  const require = createRequire(join(ROOT, "package.json"));
  for (const name of (process.env.PLUGIN_PACKAGES ?? "").split(",").map((n) => n.trim())) {
    if (name !== "") dirs.push(dirname(require.resolve(`${name}/package.json`)));
  }
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const file = join(dir, "package.json");
    if (!existsSync(file)) continue;
    const manifest = (JSON.parse(readFileSync(file, "utf8")) as { spiderfolio?: Manifest })
      .spiderfolio;
    if (typeof manifest?.frontend !== "string" || typeof manifest.id !== "string") continue;
    if (seen.has(manifest.id)) continue;
    seen.add(manifest.id);
    entries.push(resolve(dir, manifest.frontend).replaceAll("\\", "/"));
  }
  return entries;
}

export function spiderfolioPlugins(): Plugin {
  return {
    name: "spiderfolio-plugins",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const entries = frontendEntries();
      const imports = entries.map(
        (entry, index) => `import p${index} from ${JSON.stringify(entry)};`,
      );
      const list = entries.map((_, index) => `p${index}`).join(", ");
      return `${imports.join("\n")}\nexport default [${list}];\n`;
    },
  };
}
