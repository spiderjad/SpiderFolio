import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "root",
          include: ["tests/**/*.test.ts"],
          // Los tests de reglas de ESLint arman la configuración con tipos en frío: el primer
          // caso de cada archivo puede pasar los 5 s por defecto con la máquina cargada.
          testTimeout: 30_000,
        },
      },
      "backend",
      "packages/limits",
      "packages/tailwind-preset",
      "frontend",
      "web",
    ],
  },
});
