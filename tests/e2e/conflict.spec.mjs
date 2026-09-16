// Two devices on the same draft (main spec §12): the second save lands, the first device's stale
// save is refused, and the screen shows the version-conflict state.
import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.mjs";

test("a stale save is refused with the version-conflict state", async ({ browser }) => {
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await signIn(firstPage, "priya");
  await firstPage.locator("#new-application").click();
  await firstPage.waitForURL(/application\.html\?id=/);
  const id = new URL(firstPage.url()).searchParams.get("id");
  await firstPage.goto(`/application.html?id=${id}&step=s2`);

  // The second device opens the same draft and will save first, bumping its version.
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await signIn(secondPage, "priya");
  await secondPage.goto(`/application.html?id=${id}&step=s2`);

  await firstPage.locator("#s2_full_name").fill("First device");
  await secondPage.locator("#s2_full_name").fill("Second device");

  // The second device saves first (the overview button flushes autosave, then shows the overview).
  await secondPage.locator("#overview-btn").click();
  await expect(secondPage.locator("#save-status")).toHaveAttribute("data-state", "saved");

  // The first device's save is based on the now-stale version.
  await firstPage.locator("#overview-btn").click();
  await expect(firstPage.locator("#save-status")).toHaveAttribute("data-state", "conflict");
  await expect(firstPage.locator("#message")).toBeVisible();
  await expect(firstPage.locator("#message")).toContainText("மீண்டும் ஏற்றத் தட்டவும்");

  await first.close();
  await second.close();
});
