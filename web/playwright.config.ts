// E2E de la web pública con Playwright (CLAUDE.md, sección 16): chromium y webkit contra el build
// estático servido con la CSP estricta. Los navegadores se instalan con
// npx playwright install chromium webkit (paso explícito, no un script de instalación).
import { defineConfig, devices } from "@playwright/test";
import { E2E_WEB_URL } from "./e2e/config.ts";

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
  webServer: {
    command: "npm run build && node e2e/serve.ts",
    url: E2E_WEB_URL,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
