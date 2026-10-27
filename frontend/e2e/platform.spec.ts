// CSP estricta, aviso de navegador no compatible, refresh entre pestañas y 375 px.
import { expect, logout, register, trackCspViolations, uniqueEmail, test } from "./helpers.ts";

test("CSP estricta en el HTML y sin violaciones en el recorrido", async ({ page }) => {
  const violations = await trackCspViolations(page);
  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self';");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("frame-ancestors 'none'");

  await register(page, uniqueEmail());
  // Radix (menú y panel lateral) y sonner inyectan estilos: tienen que convivir con la CSP.
  // The theme is changed from the person menu, at the foot of the sidebar.
  await page.getByRole("complementary").locator('button[aria-haspopup="menu"]').last().click();
  await page.getByRole("menuitem", { name: "Tema oscuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  expect(await violations()).toEqual([]);
});

test("navegador no compatible: aviso legible y la app no arranca", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CSS.supports.bind(CSS);
    CSS.supports = (property: string, value?: string) =>
      value?.includes("color-mix") === true ? false : original(property, value ?? "");
  });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Tu navegador necesita una actualización" }),
  ).toBeVisible();
  await expect(page.getByText("Safari", { exact: true })).toBeVisible();
  await expect(page.locator("#root")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-unsupported", "");
});

test("dos pestañas: refresh coordinado sin cerrar la sesión, y logout en una cierra la otra", async ({
  context,
}) => {
  const first = await context.newPage();
  await register(first, uniqueEmail());
  const appUrl = first.url();
  const second = await context.newPage();
  await second.goto(appUrl);
  await expect(second.getByText("Documentos vigentes")).toBeVisible();

  // Recargas simultáneas: las dos pestañas rotan el refresh token a la vez. Con
  // navigator.locks lo hacen de a una y ninguna cae en la detección de reuso.
  for (let round = 0; round < 3; round++) {
    await Promise.all([first.reload(), second.reload()]);
    await expect(first.getByText("Documentos vigentes")).toBeVisible();
    await expect(second.getByText("Documentos vigentes")).toBeVisible();
  }

  await logout(first);
  await expect(first).toHaveURL(/\/login$/);
  await expect(second).toHaveURL(/\/login$/);
});

for (const theme of ["light", "dark"] as const) {
  test(`375 px en ${theme === "light" ? "claro" : "oscuro"}: sin scroll horizontal`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((value) => {
      localStorage.setItem("spiderfolio-theme", value);
    }, theme);
    const noHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    for (const path of ["/login", "/register", "/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await noHorizontalScroll(), path).toBe(true);
    }
    await register(page, uniqueEmail());
    expect(await noHorizontalScroll(), "dashboard").toBe(true);
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(dark).toBe(theme === "dark");
  });
}
