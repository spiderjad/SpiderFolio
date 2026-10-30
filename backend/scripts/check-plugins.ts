// Before an update (deploy/update.ps1, update.sh): run inside the NEW image against the installation's
// plugins, it says which ones that version won't load, with the same checks as the core's loader
// (manifest, official/free/community ids, plugin API version). It never runs a plugin's code.
// Exit 0 if all of them load, 1 if any won't (and why), 2 if it couldn't check.
//   docker compose run --rm --no-deps --entrypoint node app backend/scripts/check-plugins.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_API_VERSION, PluginManifestSchema } from "@spiderfolio/plugin-sdk";
import { checkDistribution, pluginDirectories } from "../src/plugins/loader.ts";

const dirs = (process.env.PLUGINS_DIR ?? "")
  .split(",")
  .map((dir) => dir.trim())
  .filter((dir) => dir !== "");

interface Result {
  dir: string;
  id: string;
  version: string;
  problem: string | null;
}

let results: Result[];
try {
  results = pluginDirectories({ dirs }).flatMap((dir): Result[] => {
    const file = join(dir, "package.json");
    if (!existsSync(file)) return [];
    let pkg: { version?: unknown; spiderfolio?: unknown };
    try {
      pkg = JSON.parse(readFileSync(file, "utf8")) as typeof pkg;
    } catch {
      return [{ dir, id: dir, version: "?", problem: "package.json no se puede leer" }];
    }
    if (pkg.spiderfolio === undefined) return [];
    const version = typeof pkg.version === "string" ? pkg.version : "?";
    const parsed = PluginManifestSchema.safeParse(pkg.spiderfolio);
    if (!parsed.success) {
      return [{ dir, id: dir, version, problem: "su manifiesto no es válido para esta versión" }];
    }
    const manifest = parsed.data;
    try {
      checkDistribution(manifest);
    } catch (error) {
      return [{ dir, id: manifest.id, version, problem: (error as Error).message }];
    }
    const problem =
      manifest.pluginApi > PLUGIN_API_VERSION
        ? `necesita la API de plugins ${String(manifest.pluginApi)} y esta versión ofrece la ${String(PLUGIN_API_VERSION)}`
        : null;
    return [{ dir, id: manifest.id, version, problem }];
  });
} catch (error) {
  console.error(`No se pudieron revisar los plugins: ${(error as Error).message}`);
  process.exit(2);
}

const broken = results.filter((result) => result.problem !== null);
for (const result of results) {
  console.log(
    result.problem === null
      ? `OK  ${result.id} ${result.version}`
      : `NO  ${result.id} ${result.version}: ${result.problem}`,
  );
}
if (results.length === 0) console.log("Sin plugins instalados.");
process.exit(broken.length > 0 ? 1 : 0);
