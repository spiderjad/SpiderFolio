import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "tailwind-preset",
    include: ["tests/**/*.test.ts"],
  },
});
