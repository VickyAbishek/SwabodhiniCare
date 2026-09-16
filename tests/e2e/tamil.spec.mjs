// Language switching: the queue title (and every other data-i18n label) follows the chosen
// language. Default is Tamil; the app-bar switch flips to English and back.
import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.mjs";

test("labels switch between Tamil and English", async ({ page }) => {
  await signIn(page, "priya");
  await expect(page.locator("#queue-title")).toHaveText("உங்கள் வரிசை");
  await page.locator("[data-lang-toggle]").click();
  await expect(page.locator("#queue-title")).toHaveText("My Queue");
  await page.locator("[data-lang-toggle]").click();
  await expect(page.locator("#queue-title")).toHaveText("உங்கள் வரிசை");
});
