import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backend",
    include: ["tests/**/*.test.ts"],
    // Requieren los servicios de docker compose: npm run test:storage y npm run test:integration
    exclude: ["tests/storage/**", "tests/integration/**"],
  },
});
