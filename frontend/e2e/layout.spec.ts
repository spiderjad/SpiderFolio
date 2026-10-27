// Sin desborde horizontal de la página (CLAUDE.md, sección 10): a 1280, 1024, 768 y 375 px ninguna
// pantalla se ensancha más que la ventana. Lo ancho (tablas, árboles) hace scroll dentro de su
// propio contenedor. Se mide cada elemento: si se sale por la derecha, algún ancestro tiene que
// recortarlo o scrollearlo (overflow distinto de visible).
import type { Page } from "@playwright/test";
import { expect, register, test, uniqueEmail } from "./helpers.ts";

const WIDTHS = [1280, 1024, 768, 375] as const;

/** Elementos que se salen por la derecha de la ventana sin que un ancestro los contenga. */
async function overflowing(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const clips = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return ["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
    };
    const found: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit + 1) continue;
      let contained = false;
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        if (parent === document.documentElement) break;
        if (clips(parent)) {
          // El ancestro que recorta tiene que caber en la ventana.
          contained = parent.getBoundingClientRect().right <= limit + 1;
          if (contained) break;
        }
      }
      if (!contained) {
        found.push(
          `${element.tagName.toLowerCase()}.${element.className.slice(0, 60)} (${String(Math.round(rect.right))} > ${String(limit)})`,
        );
      }
      if (found.length >= 5) break;
    }
    return found;
  });
}

test("ninguna pantalla se desborda horizontalmente a 1280, 1024, 768 y 375 px", async ({
  page,
}) => {
  await register(page, uniqueEmail("layout"));
  const slug = /\/app\/([^/]+)/.exec(page.url())?.[1] ?? "";
  // Con datos (un departamento de nombre largo) y, de paso, la apertura automática del primero.
  await page.goto(`/app/${slug}/admin/departments`);
  await page.getByRole("button", { name: "Nuevo departamento" }).click();
  await page
    .getByLabel("Nombre", { exact: true })
    .fill("Calidad con un nombre largo para probar el desborde horizontal del árbol y del detalle");
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await page.goto(`/app/${slug}/admin/departments`);
  await expect(page).toHaveURL(/\/admin\/departments\/[^/?]+/);
  const routes = [
    "",
    "/files",
    "/admin/members",
    "/admin/departments",
    "/admin/roles",
    "/admin/security",
  ];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(`/app/${slug}${route}`);
      await page.waitForLoadState("networkidle");
      // Primero el detalle (qué elemento se sale) y después la medida global.
      expect(await overflowing(page), `${route || "/"} a ${String(width)} px`).toEqual([]);
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scroll.scrollWidth,
        `${route || "/"} a ${String(width)} px: scroll horizontal`,
      ).toBeLessThanOrEqual(scroll.clientWidth);
      expect(await overflowing(page), `${route || "/"} a ${String(width)} px`).toEqual([]);
    }
  }
});
