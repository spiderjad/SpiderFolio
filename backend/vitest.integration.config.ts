import { defineConfig } from "vitest/config";

// Requieren los servicios de docker compose (Postgres y Mailpit): npm run test:integration.
// Usan una base aparte (<base>_test) que el globalSetup recrea desde las migraciones.
export default defineConfig({
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Comparten base, pg-boss y rate limit: un archivo a la vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
