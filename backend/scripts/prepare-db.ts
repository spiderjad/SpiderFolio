// Recrea desde cero la base de DATABASE_URL: migraciones (como producción) y seed. Lo usan los
// E2E (frontend/e2e). Por el seed, solo corre contra una base local (prisma/seed-guard.ts).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertSafeSeedTarget } from "../prisma/seed-guard.ts";

const backendDir = fileURLToPath(new URL("..", import.meta.url));
const prismaCli = fileURLToPath(
  new URL("../../node_modules/prisma/build/index.js", import.meta.url),
);

const { databaseUrl } = assertSafeSeedTarget(process.env);
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error("Nombre de base inválido");
const admin = new URL(databaseUrl);
admin.pathname = "/postgres";

const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
} finally {
  await client.end();
}
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: backendDir,
  stdio: "pipe",
});
execFileSync(process.execPath, ["prisma/seed.ts"], { cwd: backendDir, stdio: "pipe" });
console.log(`Base ${dbName} lista`);
