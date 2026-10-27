// Recrea la base de tests desde cero: migraciones (igual que producción) y seed.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { TEST_DEMO_PASSWORD, testDatabaseUrl } from "./test-db.ts";

const backendDir = fileURLToPath(new URL("../..", import.meta.url));

export default async function setup(): Promise<void> {
  const testUrl = testDatabaseUrl();
  const dbName = new URL(testUrl).pathname.slice(1);
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  // Contraseña demo propia de los tests (los usuarios demo se usan en auth.test.ts).
  const env = { ...process.env, DATABASE_URL: testUrl, SEED_DEMO_PASSWORD: TEST_DEMO_PASSWORD };
  const run = (args: string[]) =>
    execFileSync(process.execPath, args, { cwd: backendDir, env, stdio: "pipe" });
  run([
    fileURLToPath(new URL("../../../node_modules/prisma/build/index.js", import.meta.url)),
    "migrate",
    "deploy",
  ]);
  run(["prisma/seed.ts"]);
}
