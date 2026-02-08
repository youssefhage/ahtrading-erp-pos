import { test, expect } from "@playwright/test";

test("can seed demo data and create a draft sales invoice", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run this test.");

  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  // Seed demo data (idempotent). This endpoint is local/dev only.
  await page.goto("/system/go-live");
  await expect(page.getByText("Go-Live Preflight")).toBeVisible();
  const seedBtn = page.getByRole("button", { name: "Seed Demo Data" });
  await expect(seedBtn).toBeEnabled({ timeout: 10_000 });
  await seedBtn.click();

  // Create a draft sales invoice with one line.
  await page.goto("/sales/invoices/new");
  await expect(page.getByText(/Create Draft Sales Invoice/i)).toBeVisible();

  // Wait for initial data load (items/customers/warehouses).
  const addLineBtn = page.getByRole("button", { name: "Add Line" });
  await expect(addLineBtn).toBeEnabled({ timeout: 15_000 });

  const picker = page.getByPlaceholder("Search SKU / name / barcode...");
  await picker.fill("DEMO-0001");
  await picker.press("Enter");
  await expect(page.getByText(/Selected:/i)).toBeVisible();

  // Qty input is in the line-add form.
  const addLineForm = page.getByRole("button", { name: "Add Line" }).locator("xpath=ancestor::form[1]");
  const usdInput = addLineForm.locator("label", { hasText: "Unit USD" }).locator("..").locator("input");
  await expect(usdInput).not.toHaveValue("", { timeout: 10_000 });
  const qtyInput = addLineForm.locator("label", { hasText: "Qty" }).locator("..").locator("input");
  await qtyInput.fill("2");

  await addLineForm.getByRole("button", { name: "Add Line" }).click();
  await expect(page.getByText(/No lines yet\\./i)).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/DEMO-0001/i)).toBeVisible();

  await page.getByRole("button", { name: /Create Draft/i }).click();
  await page.waitForURL(/\/sales\/invoices\/[0-9a-f-]+$/i, { timeout: 30_000 });

  await expect(page.getByRole("button", { name: /Post Draft/i })).toBeVisible();
});
