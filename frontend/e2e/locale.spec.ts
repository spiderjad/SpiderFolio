// Language: with an English browser, the account is created in English and login and app show in English.
import { expect, PASSWORD, test, uniqueEmail } from "./helpers.ts";

test.use({ locale: "en-US" });

test("con el navegador en inglés, el login y la app se ven en inglés", async ({ page }) => {
  const email = uniqueEmail("en");
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Emma E2E");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Company name").fill("Fine Foods E2E");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("checkbox", { name: /^I accept the/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Current documents")).toBeVisible();

  await page.getByRole("complementary").locator('button[aria-haspopup="menu"]').last().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page
    .getByRole("alertdialog", { name: "Sign out?" })
    .getByRole("button", { name: "Sign out" })
    .click();

  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Current documents")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Documentos vigentes")).toHaveCount(0);
});
