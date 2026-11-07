// The rail of areas and the area's menu collapsed to icons (docs/spec/diseno.md 10.4.1): every icon has
// to be visible inside its column. A repeated regression left the centered rows outside the visible
// width of the collapsed menu (the panel clips what goes past it).
import type { Locator } from "@playwright/test";
import { MENU_COLLAPSED_WIDTH, RAIL_WIDTH } from "../src/components/shell-sizes.ts";
import { expect, register, test, uniqueEmail } from "./helpers.ts";

/** A control is visible, has a visible icon or mark, and fits between `from` and `to` (px). */
async function fitsBetween(control: Locator, from: number, to: number) {
  const target = control.first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(from);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(to);
  // Inside it there's an icon or a visible mark (not just the empty box).
  await expect(target.locator("svg, img, [aria-hidden='true']").first()).toBeVisible();
}

test("con el menú contraído se ven los íconos de empresa, búsqueda, crear, navegación, administración y persona", async ({
  page,
}) => {
  await register(page, uniqueEmail("sidebar"));
  const panel = page.locator("aside");
  await page.getByRole("button", { name: "Contraer menú" }).click();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0), { timeout: 5_000 })
    .toBeLessThanOrEqual(MENU_COLLAPSED_WIDTH);

  // The rail: each area, and Administración at the bottom.
  const rail = page.getByRole("navigation", { name: "Áreas" }).first();
  for (const area of ["Inicio", "Documentación", "Wiki", "Administración"]) {
    await fitsBetween(rail.getByRole("link", { name: area }), 0, RAIL_WIDTH);
  }
  // The collapsed menu, right after the rail.
  const menu = [
    panel.getByRole("button", { name: /^Empresa:/ }),
    panel.getByRole("button", { name: /Buscar/ }),
    panel.getByRole("button", { name: "Crear" }),
    panel.getByRole("link", { name: "Panel" }),
    panel.getByRole("link", { name: "Mis pendientes" }),
    panel.getByRole("button", { name: "Ana E2E" }),
  ];
  for (const control of menu) {
    await fitsBetween(control, RAIL_WIDTH, RAIL_WIDTH + MENU_COLLAPSED_WIDTH);
  }
});
