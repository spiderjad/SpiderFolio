import { createHmac, randomUUID } from "node:crypto";
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
  // Registering hashes the password and Home loads its first data: on a busy machine, more than 5 s.
  await expect(page.getByText("Documentos vigentes")).toBeVisible({ timeout: 20_000 });
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

/** TOTP (RFC 6238, SHA-1, 6 digits, 30 s) of a base32 secret, as the app computes it. */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.replaceAll(/\s/gu, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/gu) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = (hmac[19] ?? 0) & 15;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

/** The company's slug from the app's address (/app/:slug/…). */
export const slugOf = (page: Page): string => new URL(page.url()).pathname.split("/")[2] ?? "";

/** Confirms the email of the account just registered. */
export async function verifyEmail(page: Page, email: string): Promise<void> {
  await page.goto(`/verify-email#token=${await verificationToken(email)}`);
  await expect(page.getByText("Listo, tu email quedó confirmado.")).toBeVisible();
}

/** Turns on two-step verification from the profile (the session counts as just verified). */
export async function enableTwoFactor(page: Page, slug: string): Promise<void> {
  await page.goto(`/app/${slug}/profile`);
  await page.getByRole("button", { name: "Activar", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Activar la verificación en dos pasos" });
  await setup.getByRole("button", { name: "¿No puedes escanearlo? Mostrar la clave" }).click();
  const secret = (await setup.locator("code").innerText()).replaceAll(/\s/gu, "");
  await setup.getByLabel(/Escribe el código de 6 dígitos/).fill(totp(secret));
  await setup.getByRole("button", { name: "Activar" }).click();
  await page
    .getByRole("dialog", { name: "Tus códigos de recuperación" })
    .getByRole("button", { name: "Ya los guardé" })
    .click();
}
