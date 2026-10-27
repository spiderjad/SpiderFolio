// E2E con Playwright (CLAUDE.md, secciones 10.10 y 16): chromium y webkit contra el build de
// producción servido con la CSP estricta, una API propia y la base spiderfolio_e2e.
// Requiere docker compose up -d (Postgres, Mailpit) y los navegadores instalados con
// npx playwright install chromium webkit (paso explícito, no un script de instalación).
import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_WEB_URL } from "./e2e/config.ts";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: E2E_WEB_URL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "node e2e/start-backend.ts",
      url: `http://localhost:${String(E2E_API_PORT)}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "npx vite build && node e2e/serve.ts",
      url: E2E_WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
