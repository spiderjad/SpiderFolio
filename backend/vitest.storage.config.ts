import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "storage",
    include: ["tests/storage/**/*.test.ts"],
    setupFiles: ["tests/storage/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
