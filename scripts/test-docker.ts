// Pruebas dentro de la imagen de Node de producción (sección 15.2), con los scripts de
// instalación bloqueados como en el Dockerfile y el CI (strict-allow-scripts y allowScripts).
// Requiere Docker y, para Prisma, el Postgres de docker compose levantado.
//
// 1. argon2: Alpine usa musl y no trae herramientas de compilación; el binario precompilado
//    tiene que funcionar sin su script de instalación.
// 2. prisma migrate deploy: sin el postinstall de @prisma/engines no hay schema-engine; el
//    Dockerfile lo trae en la etapa de build con un paso explícito (prisma version) y el
//    deploy aplica las migraciones sin descargar nada.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IMAGE = "node:24.22.0-alpine"; // igual que .nvmrc y el Dockerfile (sección 15)
const TEST_DB = "spiderfolio_docker_test";
const backendDir = fileURLToPath(new URL("../backend", import.meta.url));

function backendDependency(name: string): string {
  const pkg = JSON.parse(readFileSync(`${backendDir}/package.json`, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const version = pkg.dependencies?.[name];
  // argon2 llega al backend en la Parte 4; hasta entonces, la versión aprobada.
  if (version === undefined && name === "argon2") return "0.45.1";
  if (version === undefined) throw new Error(`${name} no está en backend/package.json`);
  return version;
}

/** package.json + .npmrc de un proyecto mínimo con los scripts bloqueados. */
function lockedProject(dependencies: Record<string, string>, denied: string[]): string {
  const pkg = {
    name: "prueba",
    private: true,
    type: "module",
    dependencies,
    allowScripts: Object.fromEntries(denied.map((name) => [name, false])),
  };
  return [
    `printf '%s' '${JSON.stringify(pkg)}' > package.json`,
    "echo 'strict-allow-scripts=true' > .npmrc",
    "npm install --no-audit --no-fund --loglevel=error",
  ].join(" && ");
}

function docker(args: string[], label: string): string {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) {
    console.error(`No se pudo ejecutar docker: ${result.error.message}`);
    process.exit(1);
  }
  process.stdout.write(result.stdout);
  if (result.status !== 0) {
    console.error(`✗ ${label}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const shellQuote = (code: string) => `'${code.replaceAll("'", "'\\''")}'`;

// ─── 1. argon2 ───────────────────────────────────────────────────────────────

// Mismos parámetros que el registro (CLAUDE.md, sección 7.3).
const argon2Check = `
const argon2 = require("argon2");
(async () => {
  const opts = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
  const hash = await argon2.hash("clave-de-prueba-123", opts);
  // Formato PHC: $argon2id$v=19$m=...,p=...,t=...$sal$hash (el orden de los parámetros varía).
  const [, type, , params] = hash.split("$");
  const p = Object.fromEntries(params.split(",").map((kv) => kv.split("=")));
  if (type !== "argon2id" || p.m !== "19456" || p.t !== "2" || p.p !== "1") throw new Error("hash inesperado: " + hash);
  if (!(await argon2.verify(hash, "clave-de-prueba-123"))) throw new Error("verify falló");
  if (await argon2.verify(hash, "otra")) throw new Error("verify aceptó una contraseña incorrecta");
  // needsRehash (login, 7.3): un hash con parámetros viejos (p=4) se recalcula; el actual no.
  const old = await argon2.hash("clave-de-prueba-123", { ...opts, parallelism: 4 });
  if (!argon2.needsRehash(old, opts)) throw new Error("needsRehash no detectó p=4");
  if (argon2.needsRehash(hash, opts)) throw new Error("needsRehash pidió recalcular un hash actual");
  console.log("✓ argon2 OK en " + process.version + " (" + process.platform + "/" + process.arch + "), sin script de instalación");
})().catch((err) => { console.error(err); process.exit(1); });
`;

const argon2Version = backendDependency("argon2");
console.log(`\n== argon2@${argon2Version} en ${IMAGE}`);
docker(
  [
    "run",
    "--rm",
    IMAGE,
    "sh",
    "-c",
    [
      "set -e",
      "mkdir -p /tmp/t && cd /tmp/t",
      lockedProject({ argon2: argon2Version }, ["argon2"]),
      `node -e ${shellQuote(argon2Check)}`,
    ].join(" && "),
  ],
  "argon2",
);

// ─── 2. prisma migrate deploy ────────────────────────────────────────────────

const prismaVersion = backendDependency("prisma");
console.log(`\n== prisma@${prismaVersion} migrate deploy en ${IMAGE}`);

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const devUrl = process.env.DATABASE_URL;
if (devUrl === undefined || devUrl === "") {
  console.error("Falta DATABASE_URL en .env");
  process.exit(1);
}
// Misma base de Postgres de docker compose, vista desde su red interna.
const containerUrl = new URL(devUrl);
containerUrl.hostname = "postgres";
containerUrl.port = "5432";
containerUrl.pathname = `/${TEST_DB}`;

const postgresId = docker(["compose", "ps", "-q", "postgres"], "Postgres de docker compose").trim();
if (postgresId === "") {
  console.error("Postgres no está corriendo: docker compose up -d");
  process.exit(1);
}
const network = docker(
  ["inspect", postgresId, "--format", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}"],
  "red de Postgres",
).trim();
const user = decodeURIComponent(containerUrl.username);
const psql = (sql: string) =>
  docker(
    ["compose", "exec", "-T", "postgres", "psql", "-q", "-U", user, "-d", "postgres", "-c", sql],
    sql,
  );

psql(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
psql(`CREATE DATABASE "${TEST_DB}"`);
try {
  const enginesDir = "node_modules/@prisma/engines";
  docker(
    [
      "run",
      "--rm",
      "--network",
      network,
      "-v",
      `${backendDir}:/src:ro`,
      "-e",
      `DATABASE_URL=${containerUrl.toString()}`,
      IMAGE,
      "sh",
      "-c",
      [
        "set -e",
        "mkdir -p /app && cd /app",
        "cp -r /src/prisma /src/prisma.config.ts .",
        lockedProject({ prisma: prismaVersion }, ["prisma", "@prisma/engines"]),
        // Con los scripts bloqueados no se descarga el motor al instalar.
        `if ls ${enginesDir} | grep -q schema-engine; then echo "✗ el postinstall corrió" && exit 1; fi`,
        "echo '✓ instalación sin scripts: sin schema-engine'",
        // Etapa de build del Dockerfile: trae el motor con un paso explícito.
        "npx prisma version > /dev/null",
        `ls ${enginesDir} | grep schema-engine`,
        "npx prisma migrate deploy",
        "npx prisma migrate status",
      ].join(" && "),
    ],
    "prisma migrate deploy",
  );
  console.log("✓ prisma migrate deploy OK con scripts bloqueados");
} finally {
  psql(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
}
