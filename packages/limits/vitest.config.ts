import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "limits",
    include: ["tests/**/*.test.ts"],
  },
});
