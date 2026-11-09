// The whistleblowing channel end to end (docs/spec/canal-denuncias.md): the owner designates herself as
// the person responsible and turns it on; someone without an account reports anonymously and keeps the
// follow-up code; management sees the case and answers; the reporter reads the answer in the mailbox and
// writes back; the case is admitted.
import {
  expect,
  enableTwoFactor,
  register,
  slugOf,
  test,
  uniqueEmail,
  verifyEmail,
} from "./helpers.ts";

const ACCOUNT = "En la línea 2 se reetiquetan lotes caducados con fecha nueva.";
const MAILBOX_PASSWORD = "clave-del-buzon-123";

test("comunicar de forma anónima, seguir el caso y responder desde la gestión", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("canal");
  await register(page, email);
  const slug = slugOf(page);
  await verifyEmail(page, email);
  await enableTwoFactor(page, slug);

  // The owner adds herself to management (she becomes the responsible person) and turns it on.
  await page.goto(`/app/${slug}/admin/security`);
  const card = page.locator(".v-card", {
    has: page.getByRole("heading", { name: "Canal de denuncias" }),
  });
  await card.getByRole("combobox", { name: "Agregar a la gestión" }).click();
  await page.getByRole("option", { name: /Ana E2E/ }).click();
  await expect(card.getByText("Responsable del sistema")).toBeVisible();
  await card.getByRole("switch", { name: "Canal activo" }).click();
  await expect(page.getByText("Canal activado")).toBeVisible();

  // Someone without an account reports from the public page.
  const outside = await browser.newContext({ locale: "es-ES" });
  const reporter = await outside.newPage();
  await reporter.goto(`/canal/${slug}`);
  await expect(reporter.getByRole("heading", { name: "Canal de denuncias" })).toBeVisible();
  await reporter.getByRole("button", { name: "Comunicar algo" }).click();
  await reporter.getByRole("combobox", { name: "Sobre qué es" }).click();
  await reporter.getByRole("option", { name: "Seguridad alimentaria" }).click();
  await reporter.getByLabel("Qué pasó").fill(ACCOUNT);
  await reporter.getByLabel("Contraseña para tu buzón", { exact: true }).fill(MAILBOX_PASSWORD);
  await reporter.getByLabel("Repite la contraseña", { exact: true }).fill(MAILBOX_PASSWORD);
  await reporter.getByRole("button", { name: "Enviar" }).click();
  await expect(reporter.getByRole("heading", { name: "Comunicación recibida" })).toBeVisible();
  const code = (await reporter.locator("p.font-mono").innerText()).trim();
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/u);

  // Management: the case, without its content in the list; inside, the account. It answers.
  await page.goto(`/app/${slug}/canal`);
  const caseLink = page.getByRole("link", { name: /^DEN-\d{4}-0001$/u });
  await expect(caseLink).toBeVisible();
  await expect(page.getByText(ACCOUNT)).toHaveCount(0);
  await caseLink.click();
  await expect(page.getByText(ACCOUNT)).toBeVisible();
  await expect(page.getByText("Anónima: no se sabe quién informa.")).toBeVisible();
  await page.getByLabel("Mensajes con quien informa").fill("¿Desde cuándo pasa? ¿Qué lotes?");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText("¿Desde cuándo pasa? ¿Qué lotes?")).toBeVisible();

  // The reporter reads the answer in the mailbox and writes back.
  await reporter.goto(`/canal/${slug}/buzon`);
  await reporter.getByLabel("Código de seguimiento").fill(code);
  await reporter.getByLabel("Contraseña", { exact: true }).fill(MAILBOX_PASSWORD);
  await reporter.getByRole("button", { name: "Entrar" }).click();
  await expect(reporter.getByText("¿Desde cuándo pasa? ¿Qué lotes?")).toBeVisible();
  await expect(reporter.getByText("La gestión del canal").first()).toBeVisible();
  await reporter
    .getByLabel("Escribir a la gestión")
    .fill("Desde septiembre, los lotes de chorizo.");
  await reporter.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(reporter.getByText("Desde septiembre, los lotes de chorizo.")).toBeVisible();

  // A wrong password answers the same as a code that doesn't exist.
  const stranger = await outside.newPage();
  await stranger.goto(`/canal/${slug}/buzon`);
  await reporter.getByRole("button", { name: "Salir" }).click();
  await stranger.getByLabel("Código de seguimiento").fill(code);
  await stranger.getByLabel("Contraseña", { exact: true }).fill("otra-clave-123");
  await stranger.getByRole("button", { name: "Entrar" }).click();
  await expect(
    stranger.getByText("El código de seguimiento o la contraseña no son correctos."),
  ).toBeVisible();
  await outside.close();

  // Management sees the new message and admits the case.
  await page.goto(`/app/${slug}/canal`);
  await expect(page.getByText("Nuevo").first()).toBeVisible();
  await page.getByRole("link", { name: /^DEN-\d{4}-0001$/u }).click();
  await expect(page.getByText("Desde septiembre, los lotes de chorizo.")).toBeVisible();
  await page.getByRole("button", { name: "Admitir", exact: true }).click();
  await expect(page.getByText("Caso actualizado")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).getByText("Admitido")).toBeVisible();
});
