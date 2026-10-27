// Puertos y base propios de los E2E, para no chocar con npm run dev.
export const E2E_API_PORT = 4100;
export const E2E_WEB_PORT = 4173;
export const E2E_WEB_URL = `http://localhost:${String(E2E_WEB_PORT)}`;
export const E2E_DEMO_PASSWORD = "demo-de-e2e-12345";
export const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025/api/v1";
