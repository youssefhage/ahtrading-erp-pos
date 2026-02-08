import { test, expect } from "@playwright/test";

test("login page loads", async ({ page }) => {
  const res = await page.goto("/login");
  expect(res?.ok()).toBeTruthy();

  // Keep this smoke test resilient to copy changes.
  await expect(page.getByText("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: /login|sign in/i })).toBeVisible();
});
