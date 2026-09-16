// Theme: picking Dark applies it to <html> and the choice survives a reload — prefs.js saves it to
// localStorage and theme-boot.js reads it back before the page draws.
import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.mjs";

test("the dark theme applies and persists across a reload", async ({ page }) => {
  await signIn(page, "priya");
  await page.goto("/settings.html");
  await page.locator('[data-set-theme="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
