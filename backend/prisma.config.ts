// Configuración de Prisma 7 (CLI: migrate, generate). Prisma 7 no lee .env solo.
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
