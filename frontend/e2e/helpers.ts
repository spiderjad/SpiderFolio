import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { MAILPIT_API } from "./config.ts";

export const PASSWORD = "una-clave-de-e2e-123";

/** test con una IP de cliente propia por test (ver e2e/serve.ts). */
export const test = base.extend<{ clientIp: string }>({
  clientIp: [
    async ({ context }, use) => {
      const ip = `198.18.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`;
      await context.setExtraHTTPHeaders({ "x-e2e-client-ip": ip });
      await use(ip);
    },
    { auto: true },
  ],
});
export { expect };

export const uniqueEmail = (label = "e2e") => `${label}-${randomUUID()}@e2e.local`;

/** Token del último email de verificación para `to` (el enlace lo trae en #token=…). */
export async function verificationToken(to: string): Promise<string> {
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}" subject:"Confirma tu email en SpiderFolio"`);
        const search = (await (await fetch(`${MAILPIT_API}/search?query=${query}`)).json()) as {
          messages: { ID: string }[];
        };
        const id = search.messages[0]?.ID;
        if (id === undefined) return false;
        const message = (await (await fetch(`${MAILPIT_API}/message/${id}`)).json()) as {
          Text: string;
        };
        token = /#token=([A-Za-z0-9_-]+)/.exec(message.Text)?.[1];
        return token !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return token ?? "";
}

export async function register(page: Page, email: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Nombre y apellido").fill("Ana E2E");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Nombre de la empresa").fill("Industrias E2E");
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("checkbox", { name: /^Acepto los/ }).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText("Documentos vigentes")).toBeVisible();
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByText("Documentos vigentes")).toBeVisible();
}

/** Signs out from the person menu (at the foot of the sidebar), confirming in the dialog. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("complementary").locator('button[aria-haspopup="menu"]').last().click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page
    .getByRole("alertdialog", { name: "¿Cerrar sesión?" })
    .getByRole("button", { name: "Cerrar sesión" })
    .click();
}

/** Registra las violaciones de CSP de la página (el init script no depende de la CSP). */
export async function trackCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store: string[] = [];
    Object.defineProperty(window, "__cspViolations", { value: store });
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}
