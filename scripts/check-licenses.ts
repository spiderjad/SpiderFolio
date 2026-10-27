// Revisa las licencias de todas las dependencias instaladas (package-lock.json) frente a la AGPLv3 del
// proyecto. Falla si alguna es incompatible o desconocida y no está en la lista de revisadas a mano.
//   node scripts/check-licenses.ts [--report docs/licencias-dependencias.md]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { report: { type: "string" } } });

/** Compatibles con distribuir el conjunto bajo AGPLv3. */
const COMPATIBLE = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "MPL-2.0",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "Zlib",
  "OFL-1.1",
  "LGPL-2.1-or-later",
  "LGPL-3.0-or-later",
  "LGPL-3.0",
  "GPL-3.0",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-or-later",
  "WTFPL",
]);

/** Revisadas a mano (paquete → motivo). */
const REVIEWED: Record<string, string> = {
  // lop → mammoth: «BSD» sin variante (la del paquete es BSD de 2 cláusulas, permisiva).
  duck: "BSD permisiva (dependencia de mammoth)",
  // Prisma Studio (CLI de Prisma, no se enlaza con el código de SpiderFolio): agregado, no obra derivada.
  elkjs: "EPL-2.0, solo en Prisma Studio (herramienta de la CLI de Prisma)",
  // Dependencia de los plugins de bundler de @sentry/node; no se usa en tiempo de ejecución.
  sentry:
    "FSL-1.1-Apache-2.0, dependencia de @sentry/node (bundler-plugins); revisar si se quita Sentry",
};

interface LockPackage {
  version?: string;
  license?: string | { type?: string };
  dev?: boolean;
  link?: boolean;
}

/** «(MIT OR Apache-2.0)» → compatible si alguna opción lo es; «A AND B», si todas. */
function compatible(expression: string): boolean {
  const clean = expression
    .replace(/[()]/gu, "")
    .replace(/ and /gu, " AND ")
    .replace(/ or /gu, " OR ")
    .trim();
  if (clean.includes(" OR ")) return clean.split(" OR ").some((part) => compatible(part));
  if (clean.includes(" AND ")) return clean.split(" AND ").every((part) => compatible(part));
  return COMPATIBLE.has(clean.replace(/\+$/u, "-or-later"));
}

function licenseOf(name: string, entry: LockPackage): string {
  const raw = typeof entry.license === "string" ? entry.license : entry.license?.type;
  if (raw !== undefined && raw !== "") return raw;
  // El lock no siempre trae la licencia: se lee del package.json instalado.
  const file = join(root, "node_modules", name, "package.json");
  if (!existsSync(file)) return "DESCONOCIDA";
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { license?: string | { type?: string } };
  const fromPkg = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
  return fromPkg ?? "DESCONOCIDA";
}

const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
  packages: Record<string, LockPackage>;
};
const rows: { name: string; version: string; license: string; dev: boolean; ok: boolean }[] = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.includes("node_modules/") || entry.link === true) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (name.startsWith("@spiderfolio")) continue;
  const license = licenseOf(name, entry);
  rows.push({
    name,
    version: entry.version ?? "",
    license,
    dev: entry.dev === true,
    ok: compatible(license) || name in REVIEWED,
  });
}
const unique = [...new Map(rows.map((row) => [`${row.name}@${row.version}`, row])).values()].sort(
  (a, b) => a.name.localeCompare(b.name),
);
const bad = unique.filter((row) => !row.ok);
const counts = new Map<string, number>();
for (const row of unique) counts.set(row.license, (counts.get(row.license) ?? 0) + 1);

if (values.report !== undefined) {
  const lines = [
    "# Licencias de las dependencias",
    "",
    `Generado con \`node scripts/check-licenses.ts --report ${values.report}\` a partir de package-lock.json.`,
    `Total: ${String(unique.length)} paquetes. El proyecto es AGPLv3.`,
    "",
    "## Por licencia",
    "",
    "| Licencia | Paquetes |",
    "|---|---|",
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([license, count]) => `| ${license} | ${String(count)} |`),
    "",
    "## Para revisar",
    "",
    ...Object.entries(REVIEWED).map(([name, reason]) => `- ${name}: ${reason} (revisada a mano)`),
    "",
    ...(bad.length === 0
      ? ["Sin otras: el resto es compatible con la AGPLv3."]
      : bad.map(
          (row) =>
            `- ${row.name}@${row.version}: ${row.license}${row.dev ? " (solo desarrollo)" : ""}`,
        )),
    "",
  ];
  writeFileSync(join(root, values.report), lines.join("\n"));
}

console.log(`${String(unique.length)} paquetes revisados.`);
if (bad.length > 0) {
  console.error("Licencias a revisar:");
  for (const row of bad) {
    console.error(
      `  - ${row.name}@${row.version}: ${row.license}${row.dev ? " (desarrollo)" : ""}`,
    );
  }
  process.exitCode = 1;
}
