// Registro → verificación → logout → "atrás" no muestra datos → login (CLAUDE.md, sección 16).
import {
  expect,
  login,
  logout,
  PASSWORD,
  register,
  uniqueEmail,
  verificationToken,
  test,
} from "./helpers.ts";

test("registro, verificación, logout, atrás sin datos y login", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await expect(page).toHaveURL(/\/app\/industrias-e2e/);
  await expect(page.getByText(/Confirma tu email para invitar/)).toBeVisible();

  // El token nunca se guarda en el navegador.
  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(stored.local.filter((key) => key !== "spiderfolio-theme")).toEqual([]);
  expect(stored.session).toEqual([]);

  const token = await verificationToken(email);
  await page.goto(`/verify-email#token=${token}`);
  await expect(page.getByText("Listo, tu email quedó confirmado.")).toBeVisible();
  // El token salió de la URL.
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("link", { name: "Ir a SpiderFolio" }).click();
  await expect(page.getByText("Documentos vigentes")).toBeVisible();
  await expect(page.getByText(/Confirma tu email para invitar/)).toHaveCount(0);

  await logout(page);
  await expect(page).toHaveURL(/\/login$/);

  // "Atrás" no muestra datos: el logout reemplazó la entrada de la app por /login, y volver a
  // una URL de la app sin sesión lleva al login.
  await page.goBack();
  await expect(page.getByText("Documentos vigentes")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByText("Documentos vigentes")).toHaveCount(0);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
  await expect(page.getByText("Documentos vigentes")).toHaveCount(0);

  await login(page, email);
});

test("una URL privada sin sesión lleva al login y después vuelve a ella", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  const workspaceUrl = new URL(page.url()).pathname;
  await logout(page);
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(workspaceUrl);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(new RegExp(`${workspaceUrl}$`));
});
