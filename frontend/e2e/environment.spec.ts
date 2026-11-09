// The environment module end to end (docs/spec/medio-ambiente.md): turned on by the owner; the meat
// industry's waste, a waste manager, a collection and the chronological record exported as CSV; a
// discharge permit with its limits and an analysis out of them; a cooling unit with its leak check
// period; a meter.
import { readFile } from "node:fs/promises";
import { expect, register, slugOf, test, uniqueEmail } from "./helpers.ts";

test("residuos con su archivo cronológico, vertidos fuera de límite, equipos de frío y consumos", async ({
  page,
}) => {
  await register(page, uniqueEmail("ambiente"));
  const slug = slugOf(page);
  const base = `/app/${slug}/medio-ambiente`;

  // The owner turns the module on: the area appears.
  await page.goto(`/app/${slug}/admin/security`);
  const card = page.locator(".v-card", {
    has: page.getByRole("heading", { name: "Medio ambiente" }),
  });
  await card.getByRole("switch", { name: "Módulo activo" }).click();
  await expect(page.getByText("Medio ambiente activado")).toBeVisible();

  // Waste: the template, a manager and a collection.
  await page.goto(`${base}/residuos?pestana=catalogo`);
  await page.getByRole("button", { name: "Cargar residuos de la industria cárnica" }).click();
  await expect(page.getByText("Se agregaron 10 residuos.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Papel y cartón/ }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Gestores" }).click();
  await page.getByRole("button", { name: "Nuevo gestor o transportista" }).click();
  const contractor = page.getByRole("dialog", { name: "Nuevo gestor o transportista" });
  await contractor.getByLabel("Nombre", { exact: true }).fill("Reciclajes Costa SL");
  await contractor.getByLabel("NIMA").fill("1700012345");
  await contractor.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("cell", { name: /Reciclajes Costa SL/ }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Retiradas" }).click();
  await page.getByRole("button", { name: "Registrar retirada" }).click();
  const movement = page.getByRole("dialog", { name: "Registrar retirada" });
  await movement.getByRole("combobox", { name: "Residuo" }).click();
  await page.getByRole("option", { name: /Papel y cartón/ }).click();
  await movement.getByLabel("Cantidad").fill("120");
  await movement.getByRole("combobox", { name: "Gestor" }).click();
  await page.getByRole("option", { name: "Reciclajes Costa SL" }).click();
  await movement
    .getByLabel("Documento de identificación (DI) o documento comercial")
    .fill("DI-2026-0001");
  await movement.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Retirada registrada")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Papel y cartón/ }).first()).toBeVisible();

  // The chronological record of the period, as CSV.
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("Desde").fill(`${today.slice(0, 4)}-01-01`);
  await page.getByLabel("Hasta").fill(today);
  await page.getByRole("button", { name: "Exportar" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Archivo cronológico · CSV" }).click(),
  ]);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain("Papel y cartón");
  expect(csv).toContain("DI-2026-0001");
  expect(csv).toContain("1700012345");

  // Discharges: a discharge permit, its usual limits and an analysis out of them.
  await page.goto(`${base}/autorizaciones`);
  await page.getByRole("button", { name: "Nueva autorización" }).click();
  const permit = page.getByRole("dialog", { name: "Nueva autorización" });
  await permit.getByRole("combobox", { name: "Tipo" }).click();
  await page.getByRole("option", { name: "Autorización de vertido" }).click();
  await permit.getByLabel("Nombre", { exact: true }).fill("Vertido al colector");
  await permit.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("cell", { name: /Vertido al colector/ }).first()).toBeVisible();

  await page.goto(`${base}/vertidos`);
  await page.getByRole("button", { name: "Cargar límites" }).click();
  const limits = page.getByRole("dialog", { name: "Límites de la autorización" });
  await limits.getByRole("button", { name: "Agregar los parámetros habituales" }).click();
  // The first usual parameter is the COD.
  await limits.getByLabel("Máximo").first().fill("1500");
  await limits.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Límites guardados")).toBeVisible();

  await page.getByRole("button", { name: "Registrar analítica" }).click();
  const sample = page.getByRole("dialog", { name: "Registrar analítica" });
  await sample.getByLabel("DQO", { exact: true }).fill("1850");
  await sample.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Analítica registrada")).toBeVisible();
  await expect(page.getByText("Fuera de límite")).toBeVisible();

  // A cooling unit: 20 kg of R-404A is about 78 t CO2e, a leak check every 6 months.
  await page.goto(`${base}/frio`);
  await page.getByRole("button", { name: "Nuevo equipo" }).click();
  const unit = page.getByRole("dialog", { name: "Nuevo equipo" });
  await unit.getByLabel("Nombre", { exact: true }).fill("Cámara de producto fresco");
  await unit.getByLabel("Refrigerante").fill("R-404A");
  await unit.getByLabel("Carga (kg)").fill("20");
  await unit.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Control de fugas cada 6 meses")).toBeVisible();
  await expect(page.getByText(/restricciones de mantenimiento/)).toBeVisible();

  // Consumption: a meter.
  await page.goto(`${base}/consumos`);
  await page.getByRole("button", { name: "Nuevo contador" }).click();
  const meter = page.getByRole("dialog", { name: "Nuevo contador" });
  await meter.getByLabel("Nombre", { exact: true }).fill("Agua de red");
  await meter.getByLabel("Unidad").fill("m³");
  await meter.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { name: "Agua de red" })).toBeVisible();

  // The summary brings it together.
  await page.goto(`${base}/resumen`);
  await expect(page.getByText("Vertido al colector ·", { exact: false })).toBeVisible();
});
