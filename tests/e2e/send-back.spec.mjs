// The full send-back loop (main spec §5, §12): the therapist fixes the required gap a reviewer
// cleared, resends through the confirmation sheet, and the file reappears in the Therapy Head's
// queue stamped "Your turn".
import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.mjs";

test("a returned file is fixed, resent, and reaches the Therapy Head", async ({ browser }) => {
  // Deepa owns Meena R's file, which the seed leaves RETURNED with the diagnosis answer cleared.
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, "deepa");

  const card = ownerPage.locator(".app-card", { hasText: "Meena R" });
  await expect(card).toBeVisible();
  await expect(card.locator(".stamp-turn")).toContainText("உங்கள் முறை");
  await card.click();
  await ownerPage.waitForURL(/application\.html\?id=/);
  const id = new URL(ownerPage.url()).searchParams.get("id");

  // Step 4 holds the required answer the reviewer took out (see poc/seed/demo-data.mjs, Meena R).
  await ownerPage.goto(`/application.html?id=${id}&step=s4`);
  await ownerPage.locator("#s4_asd_diagnosed-YES").click();
  await expect(ownerPage.locator("#s4_asd_diagnosed-YES")).toHaveAttribute("aria-pressed", "true");
  await expect(ownerPage.locator("#next-btn")).toHaveText("சரிசெய்து மீண்டும் அனுப்பு");

  await ownerPage.locator("#next-btn").click();
  await expect(ownerPage.locator("#confirm-title")).toHaveText("சிகிச்சைத் தலைவருக்கு அனுப்பவா?");
  await ownerPage.locator("#confirm-yes").click();
  await ownerPage.waitForURL("**/home.html");
  await owner.close();

  // Lakshmi is the Therapy Head the file was sent to.
  const reviewer = await browser.newContext();
  const reviewerPage = await reviewer.newPage();
  await signIn(reviewerPage, "lakshmi");
  const meena = reviewerPage.locator(".app-card", { hasText: "Meena R" });
  await expect(meena).toBeVisible();
  await expect(meena.locator(".stamp-turn")).toContainText("உங்கள் முறை");
  await reviewer.close();
});
