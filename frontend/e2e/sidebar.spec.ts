// Menú lateral contraído (72 px): cada ícono tiene que verse dentro del panel. Una regresión repetida
// dejaba las filas centradas fuera de los 72 px visibles (el panel recorta lo que se sale).
import { expect, register, test, uniqueEmail } from "./helpers.ts";

const PANEL_WIDTH = 72;

test("con el menú contraído se ven los íconos de empresa, búsqueda, crear, navegación, administración y persona", async ({
  page,
}) => {
  await register(page, uniqueEmail("sidebar"));
  const panel = page.locator("aside");
  await page.getByRole("button", { name: "Contraer menú" }).click();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0), { timeout: 5_000 })
    .toBeLessThanOrEqual(PANEL_WIDTH);

  const controls = [
    panel.getByRole("button", { name: /^Empresa:/ }),
    panel
      .getByRole("button", { name: "Buscar (Ctrl+K)" })
      .or(panel.getByRole("button", { name: /Buscar/ })),
    panel.getByRole("button", { name: "Crear" }),
    panel.getByRole("link", { name: "Inicio" }),
    panel.getByRole("link", { name: "Mis documentos" }),
    panel.getByRole("link", { name: "Archivos" }),
    panel.getByRole("link", { name: "Compartidos" }),
    panel.getByRole("link", { name: "Administración" }),
    panel.getByRole("button", { name: "Ana E2E" }),
  ];
  for (const control of controls) {
    const target = control.first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PANEL_WIDTH);
    // Dentro del control hay un ícono o una marca visible (no solo el recuadro vacío).
    const mark = target.locator("svg, img, [aria-hidden='true']").first();
    await expect(mark).toBeVisible();
  }
});
