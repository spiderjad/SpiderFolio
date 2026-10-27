import { expect, test, type Page } from "@playwright/test";

/** Registra las violaciones de CSP de la página (el evento securitypolicyviolation). */
async function trackCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** Simula un navegador sin scroll-driven animations (para probar la alternativa). */
async function withoutScrollTimeline(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = CSS.supports.bind(CSS);
    CSS.supports = (property: string, value?: string) =>
      property.includes("animation-timeline") ? false : original(property, value ?? "");
  });
}

async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 400) {
    await page.evaluate((top) => {
      window.scrollTo(0, top);
    }, y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(900);
}

test("inicio: CSP estricta, sin violaciones y CTA a la instalación", async ({ page }) => {
  const violations = await trackCspViolations(page);
  const response = await page.goto("/es");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
  expect(csp).not.toMatch(/(script|style)-src[^;]*unsafe-inline/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Instalar" }).first()).toHaveAttribute(
    "href",
    /\/es\/instalacion$/,
  );
  await scrollThrough(page);
  expect(await violations()).toEqual([]);
});

test("efectos de entrada: todo queda visible después de recorrer la página", async ({ page }) => {
  await page.goto("/es");
  await scrollThrough(page);
  const cards = page.locator("#funciones article");
  await expect(cards).toHaveCount(6);
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS("opacity", "1");
  }
});

test("efectos de entrada: alternativa con IntersectionObserver sin animation-timeline", async ({
  page,
}) => {
  await withoutScrollTimeline(page);
  await page.goto("/es");
  await expect(page.locator("html")).toHaveClass(/reveal-fallback/);
  const last = page.locator("#funciones article").last();
  await expect(last).toHaveCSS("opacity", "0");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveClass(/is-in/);
  await expect(last).toHaveCSS("opacity", "1");
});

test("con prefers-reduced-motion nada queda oculto ni se anima", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await withoutScrollTimeline(page);
  await page.goto("/es");
  await expect(page.locator("#funciones article").last()).toHaveCSS("opacity", "1");
  await expect(page.locator(".hero-stagger > *").first()).toHaveCSS("animation-name", "none");
});

test("plugins y servicios: catálogo sin precios, con contacto en cada uno", async ({ page }) => {
  await page.goto("/es/plugins");
  await expect(page.getByRole("heading", { level: 1, name: "Plugins y servicios" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Plugins" }).locator("article")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Servicios" }).getByRole("listitem")).toHaveCount(
    4,
  );
  // Five plugins, the Enterprise bundle, four services and the closing call to action.
  await expect(page.locator('a[href^="mailto:contacto@spiderjad.com"]')).toHaveCount(11);
  await expect(page.locator("main")).not.toContainText(/€|USD|[Pp]recio/);
});

test("legales: las cuatro páginas, enlazadas desde el pie, con fecha y sin banner de cookies", async ({
  page,
}) => {
  for (const [lang, names] of [
    ["es", ["Aviso legal", "Privacidad", "Términos", "Cookies"]],
    ["en", ["Legal notice", "Privacy", "Terms", "Cookies"]],
  ] as const) {
    for (const name of names) {
      await page.goto(`/${lang}`);
      await page.getByRole("contentinfo").getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main time")).toBeVisible();
    }
  }
  expect(await page.context().cookies()).toEqual([]);
});

test("docs: navegación y búsqueda con Ctrl+K", async ({ page }) => {
  const violations = await trackCspViolations(page);
  await page.goto("/es/docs");
  await expect(page.getByRole("navigation", { name: "Documentación" })).toBeVisible();
  await page.keyboard.press("Control+K");
  const dialog = page.locator("[data-search-dialog]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("searchbox").fill("contraseña");
  await expect(dialog.getByRole("link").first()).toBeVisible();
  await dialog.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await violations()).toEqual([]);
});

test("tema oscuro: se aplica y se recuerda", async ({ page }) => {
  await page.goto("/es");
  await page.getByRole("button", { name: "Cambiar tema" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("375 px: sin scroll horizontal en las páginas principales", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of [
    "/es",
    "/es/instalacion",
    "/es/plugins",
    "/es/faq",
    "/es/seguridad",
    "/es/docs",
    "/en",
    "/en/install",
    "/en/docs",
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `desborde en ${path}`).toBeLessThanOrEqual(0);
  }
});

test("404 con el diseño del sitio", async ({ page }) => {
  const response = await page.goto("/es/no-existe");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
});

test("idiomas: la portada lleva al idioma del navegador y el selector a la misma página", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/en/docs/create-account");
  await page.locator(".language-picker summary").click();
  await page.locator(".language-picker a[hreflang=es]").click();
  await expect(page).toHaveURL(/\/es\/docs\/crear-cuenta$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await context.close();
});
