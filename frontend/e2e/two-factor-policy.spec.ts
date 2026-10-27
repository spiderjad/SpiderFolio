// «Exigir verificación en dos pasos a todos»: un miembro sin 2FA no puede seguir sin activarla, tanto
// si ya tenía la sesión abierta (la app recibe MFA_SETUP_REQUIRED) como al arrancar la sesión.
import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import { E2E_WEB_URL, MAILPIT_API } from "./config.ts";
import { expect, PASSWORD, register, test, uniqueEmail, verificationToken } from "./helpers.ts";

/** TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) del secreto en base32, como lo calcula la app. */
function totp(secretBase32: string, at = Date.now()): string {
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

async function invitationToken(to: string): Promise<string> {
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}" subject:"Te invitaron a"`);
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
      { timeout: 20_000 },
    )
    .toBe(true);
  return token ?? "";
}

const mandatory = (page: Page) =>
  expect(page.getByRole("heading", { name: "Activa la verificación en dos pasos" })).toBeVisible();

test("con «A todos», un miembro sin 2FA tiene que activarla", async ({ page, browser }) => {
  const ownerEmail = uniqueEmail("duena-2fa");
  await register(page, ownerEmail);
  const slug = new URL(page.url()).pathname.split("/")[2] ?? "";
  await page.goto(`/verify-email#token=${await verificationToken(ownerEmail)}`);
  await expect(page.getByText("Listo, tu email quedó confirmado.")).toBeVisible();

  // The policy belongs to the security-policies plugin, which doesn't ship with the core: skip without it.
  // Ask the server with the session cookie (the app only fetches it when it bundles plugins).
  const refreshed = await page.request.post("/api/v1/auth/refresh", {
    headers: { "X-Requested-With": "spiderfolio", Origin: E2E_WEB_URL },
  });
  expect(refreshed.ok()).toBe(true);
  const { accessToken } = (await refreshed.json()) as { accessToken: string };
  const pluginsResponse = await page.request.get(`/api/v1/w/${slug}/plugins`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(pluginsResponse.ok()).toBe(true);
  const { plugins } = (await pluginsResponse.json()) as { plugins: { id: string }[] };
  test.skip(
    !plugins.some((plugin) => plugin.id === "security-policies"),
    "Requiere el plugin security-policies activo.",
  );

  // Invita a un miembro, que entra antes de que exista la política.
  const memberEmail = uniqueEmail("jan");
  await page.goto(`/app/${slug}/admin/members`);
  await page.getByRole("button", { name: "Invitar personas" }).click();
  const invite = page.getByRole("dialog", { name: "Invitar personas" });
  await invite.getByLabel("Emails").fill(memberEmail);
  await invite.getByRole("button", { name: "Enviar invitaciones" }).click();
  await expect(page.getByText("Invitación enviada.")).toBeVisible();
  const memberContext = await browser.newContext({ baseURL: E2E_WEB_URL });
  const member = await memberContext.newPage();
  await member.goto(`/accept-invite#token=${await invitationToken(memberEmail)}`);
  await member.getByLabel("Nombre y apellido").fill("Jan E2E");
  await member.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await member.getByRole("checkbox", { name: /^Acepto los/ }).check();
  await member.getByRole("button", { name: "Aceptar y entrar" }).click();
  await expect(member.getByRole("heading", { name: "Inicio" })).toBeVisible();

  // La dueña activa su 2FA y exige la verificación a todos.
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
  await page.goto(`/app/${slug}/admin/security`);
  await page.getByRole("combobox", { name: "Exigir verificación en dos pasos" }).click();
  await page.getByRole("option", { name: "A todos (salvo invitados externos)" }).click();
  await expect(page.getByText("Cambios guardados.").first()).toBeVisible();

  // Con la sesión ya abierta: la siguiente petición responde MFA_SETUP_REQUIRED y aparece el alta.
  await member.getByRole("link", { name: "Archivos" }).first().click();
  await mandatory(member);
  // Al arrancar la sesión (recargar) también.
  await member.reload();
  await mandatory(member);
  // Y en un login nuevo, en otro navegador.
  const fresh = await browser.newContext({ baseURL: E2E_WEB_URL });
  const again = await fresh.newPage();
  await again.goto("/login");
  await again.getByLabel("Email", { exact: true }).fill(memberEmail);
  await again.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await again.getByRole("button", { name: "Iniciar sesión" }).click();
  await mandatory(again);

  await memberContext.close();
  await fresh.close();
});
