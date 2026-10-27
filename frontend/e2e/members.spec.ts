// Módulo 2 de punta a punta: invitar, aceptar desde el email, ver y suspender a la persona; y
// departamentos y roles. Con la CSP estricta: cualquier violación hace fallar el test.
import { MAILPIT_API, E2E_WEB_URL } from "./config.ts";
import {
  expect,
  PASSWORD,
  register,
  trackCspViolations,
  uniqueEmail,
  verificationToken,
  test,
} from "./helpers.ts";

/** Token del último email de invitación para `to` (el enlace lo trae en #token=…). */
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

test("invitar, aceptar desde el email, ver y suspender a la persona", async ({ page, browser }) => {
  const violations = await trackCspViolations(page);
  const ownerEmail = uniqueEmail("duena");
  await register(page, ownerEmail);
  const slug = new URL(page.url()).pathname.split("/")[2] ?? "";

  // Sin email verificado no se puede invitar.
  await page.goto(`/app/${slug}/admin/members`);
  await expect(page.getByRole("table", { name: "Miembros" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Miembros" }).getByText("Ana E2E")).toBeVisible();
  await page.getByRole("button", { name: "Invitar personas" }).click();
  const unverified = page.getByRole("dialog", { name: "Invitar personas" });
  await unverified.getByLabel("Emails").fill(uniqueEmail("temprano"));
  await unverified.getByRole("button", { name: "Enviar invitaciones" }).click();
  await expect(unverified.getByText("Confirma tu email para poder invitar")).toBeVisible();
  await unverified.getByRole("button", { name: "Cancelar" }).click();

  // Confirma el email y vuelve.
  await page.goto(`/verify-email#token=${await verificationToken(ownerEmail)}`);
  await expect(page.getByText("Listo, tu email quedó confirmado.")).toBeVisible();
  await page.goto(`/app/${slug}/admin/members`);

  // Invita.
  const guestEmail = uniqueEmail("nueva");
  await page.getByRole("button", { name: "Invitar personas" }).click();
  const dialog = page.getByRole("dialog", { name: "Invitar personas" });
  await dialog.getByLabel("Emails").fill(guestEmail);
  await dialog.getByRole("button", { name: "Enviar invitaciones" }).click();
  await expect(page.getByText("Invitación enviada.")).toBeVisible();
  await expect(page.getByText(guestEmail)).toBeVisible();
  // Ocupa una plaza completa: el dueño y la invitación.
  await expect(page.getByText("2 de 30")).toBeVisible();

  // La persona acepta desde el enlace del email, en otro navegador.
  const invitee = await browser.newContext({ baseURL: E2E_WEB_URL });
  const guestPage = await invitee.newPage();
  const token = await invitationToken(guestEmail);
  await guestPage.goto(`/accept-invite#token=${token}`);
  await expect(
    guestPage.getByRole("heading", { name: /Te invitaron a Industrias E2E/ }),
  ).toBeVisible();
  expect(new URL(guestPage.url()).hash).toBe("");
  await guestPage.getByLabel("Nombre y apellido").fill("Nora E2E");
  await guestPage.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await guestPage.getByRole("button", { name: "Aceptar y entrar" }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/app/${slug}$`));
  await expect(guestPage.getByText("Documentos vigentes")).toBeVisible();
  // Un miembro sin capacidades no ve el menú de gestión.
  await expect(guestPage.getByText("Gestión")).toHaveCount(0);
  await guestPage.goto(`/app/${slug}/admin/members`);
  await expect(guestPage.getByText("No encontramos esta página")).toBeVisible();

  // La dueña la ve como miembro y la invitación ya no está pendiente.
  await page.reload();
  const row = page.getByRole("row", { name: /Nora E2E/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Miembro", { exact: true })).toBeVisible();
  await expect(row.getByText("Activo")).toBeVisible();
  await expect(page.getByText("No hay invitaciones pendientes.")).toBeVisible();
  await expect(page.getByText("2 de 30")).toBeVisible();

  // La suspende: pierde el acceso al instante y libera la plaza.
  await page.getByRole("button", { name: "Acciones para Nora E2E" }).click();
  await page.getByRole("menuitem", { name: "Suspender" }).click();
  await page
    .getByRole("alertdialog", { name: "¿Suspender a esta persona?" })
    .getByRole("button", { name: "Suspender" })
    .click();
  await expect(page.getByRole("row", { name: /Nora E2E/ }).getByText("Suspendido")).toBeVisible();
  await guestPage.reload();
  await expect(guestPage.getByText("No encontramos esta página")).toBeVisible();

  // Se ve bien en el celular: la tabla se desplaza dentro de su tarjeta, no la página.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  await expect(page.getByRole("table", { name: "Miembros" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  expect(await violations()).toEqual([]);
  await invitee.close();
});

test("departamentos y roles: crear, listar y borrar", async ({ page }) => {
  const violations = await trackCspViolations(page);
  await register(page, uniqueEmail("admin"));
  const slug = new URL(page.url()).pathname.split("/")[2] ?? "";

  // Departamento.
  await page.goto(`/app/${slug}/admin/departments`);
  await expect(page.getByText("Todavía no hay departamentos")).toBeVisible();
  await page.getByRole("button", { name: "Nuevo departamento" }).click();
  const department = page.getByRole("dialog", { name: "Nuevo departamento" });
  await department.getByLabel("Nombre", { exact: true }).fill("Calidad");
  await department.getByRole("button", { name: "#059669" }).click();
  await department.getByRole("button", { name: "Crear" }).click();
  await expect(page.getByRole("link", { name: "Calidad" })).toBeVisible();
  await page.getByRole("link", { name: "Calidad" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calidad" })).toBeVisible();
  await expect(page.getByText("Este departamento todavía no tiene miembros.")).toBeVisible();

  // Agrega a la dueña (única persona) como miembro y la quita.
  await page.getByRole("button", { name: "Agregar miembros" }).click();
  const add = page.getByRole("dialog", { name: "Agregar miembros" });
  await add.getByRole("checkbox", { name: /Ana E2E/ }).check();
  await add.getByRole("button", { name: "Agregar miembros" }).click();
  await expect(
    page.getByRole("button", { name: "Quitar a Ana E2E del departamento" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Quitar a Ana E2E del departamento" }).click();
  await expect(page.getByText("Este departamento todavía no tiene miembros.")).toBeVisible();

  // Borra el departamento.
  await page.getByRole("link", { name: "Volver a departamentos" }).click();
  await page.getByRole("button", { name: "Acciones: Calidad" }).click();
  await page.getByRole("menuitem", { name: "Borrar" }).click();
  await page
    .getByRole("alertdialog", { name: "¿Borrar el departamento?" })
    .getByRole("button", { name: "Borrar" })
    .click();
  await expect(page.getByText("Todavía no hay departamentos")).toBeVisible();

  // Rol personalizado.
  await page.goto(`/app/${slug}/admin/roles`);
  await expect(page.getByRole("heading", { level: 2, name: "Roles de sistema" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo rol" }).click();
  const role = page.getByRole("dialog", { name: "Nuevo rol" });
  await role.getByLabel("Nombre", { exact: true }).fill("Responsable de Calidad");
  await role.getByRole("switch", { name: /Aprobar documentos/ }).click();
  await role.getByRole("button", { name: "Crear" }).click();
  await expect(page.getByText("Responsable de Calidad")).toBeVisible();
  await page.getByRole("button", { name: "Matriz" }).click();
  await expect(
    page.getByRole("img", { name: "Responsable de Calidad: Aprobar documentos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lista" }).click();
  await page.getByRole("button", { name: "Borrar: Responsable de Calidad" }).click();
  await page
    .getByRole("alertdialog", { name: "¿Borrar el rol?" })
    .getByRole("button", { name: "Borrar" })
    .click();
  await expect(page.getByText("Todavía no hay roles personalizados.")).toBeVisible();

  expect(await violations()).toEqual([]);
});
