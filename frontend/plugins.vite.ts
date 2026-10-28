// Plugins in the app build (docs/spec/plugins.md).
//
// «virtual:spiderfolio-plugins»: the app part of each installed plugin that brings its source
// (`spiderfolio.frontend`), included when the app is built. It looks in the PLUGINS_DIR folders
// (comma-separated; default plugins/ at the root) and in the PLUGIN_PACKAGES npm packages. Without
// plugins, the module exports an empty list.
//
// Shared modules: the build also emits dist/plugin-shared/<file>.js (PLUGIN_SHARED_MODULES), the
// modules that built plugins (frontendBundle) import instead of bundling their own copy. They come out
// of the same build as the app, so they are the very instances the app uses. In development the dev
// server answers /plugin-shared/<file>.js with the same module, resolved like the app's imports.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SHARED_MODULES, PLUGIN_SHARED_PATH } from "@spiderfolio/plugin-sdk";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:spiderfolio-plugins";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const SHARED_PREFIX = "\0spiderfolio-shared:";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRONTEND = fileURLToPath(new URL(".", import.meta.url));

interface Manifest {
  id?: unknown;
  frontend?: unknown;
}

function frontendEntries(): string[] {
  const dirs: string[] = [];
  const roots = (process.env.PLUGINS_DIR ?? "plugins")
    .split(",")
    .map((dir) => dir.trim())
    .filter((dir) => dir !== "");
  for (const root of roots.map((dir) => resolve(ROOT, dir))) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) dirs.push(join(root, entry.name));
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

/**
 * The source of a shared module. Packages re-export each name explicitly, read from the module Node
 * loads (the same ESM or CommonJS entry the build uses), so the output has real named exports and a
 * default only when there is one (CommonJS always has it). The app's own modules (ESM) use
 * `export *`, which keeps live bindings (the active locale).
 */
async function sharedModule(specifier: string): Promise<string> {
  if (specifier.startsWith("@/")) return `export * from ${JSON.stringify(specifier)};\n`;
  // Resolved with the «import» condition, like the browser build (require.resolve would pick the
  // CommonJS build of packages that ship both).
  const namespace = (await import(specifier)) as Record<string, unknown>;
  const names = Object.keys(namespace).filter(
    (name) => name !== "default" && name !== "__esModule" && /^[A-Za-z_$][\w$]*$/u.test(name),
  );
  const source = JSON.stringify(specifier);
  return [
    `import * as shared from ${source};`,
    "default" in namespace ? "export default shared.default ?? shared;" : "",
    names.length > 0 ? `export const { ${names.join(", ")} } = shared;` : "",
    "",
  ].join("\n");
}

export function spiderfolioPlugins(): Plugin {
  const shared = Object.entries(PLUGIN_SHARED_MODULES);
  const byUrl = new Map(
    shared.map(([specifier, file]) => [`${PLUGIN_SHARED_PATH}${file}.js`, specifier]),
  );
  return {
    name: "spiderfolio-plugins",
    config(_config, { command }) {
      if (command !== "build") return;
      return {
        build: {
          rolldownOptions: {
            input: {
              index: join(FRONTEND, "index.html"),
              ...Object.fromEntries(
                shared.map(([specifier, file]) => [
                  `plugin-shared/${file}`,
                  SHARED_PREFIX + specifier,
                ]),
              ),
            },
            // Plugins import the shared modules by a fixed name, so those entries must keep all their
            // exports even if the app uses none of them.
            preserveEntrySignatures: "strict",
            output: {
              entryFileNames: (chunk) =>
                chunk.name.startsWith("plugin-shared/") ? "[name].js" : "assets/[name]-[hash].js",
            },
          },
        },
      };
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id.startsWith(SHARED_PREFIX)) return id;
      // Development: a built plugin asks the dev server for /plugin-shared/<file>.js.
      const specifier = byUrl.get(id.split("?")[0] ?? "");
      if (specifier !== undefined) return SHARED_PREFIX + specifier;
      return null;
    },
    async load(id) {
      if (id.startsWith(SHARED_PREFIX)) return sharedModule(id.slice(SHARED_PREFIX.length));
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
