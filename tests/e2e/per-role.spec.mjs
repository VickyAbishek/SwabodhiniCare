// Each role's landing screen: the greeting names them, the role line names their role, and the
// "Start a new application" button appears only for the roles the server lets create one.
import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.mjs";

const ROLES = [
  { name: "priya", fullName: "Priya Raman", role: "சிகிச்சையாளர்", canCreate: true },
  { name: "lakshmi", fullName: "Lakshmi Narayanan", role: "சிகிச்சைத் தலைவர்", canCreate: true },
  { name: "suresh", fullName: "Suresh Kumar", role: "மையத் தலைவர்", canCreate: true },
  { name: "revathi", fullName: "Revathi Menon", role: "இயக்குநர்", canCreate: false },
];

for (const who of ROLES) {
  test(`${who.name} lands with the right greeting, role and actions`, async ({ page }) => {
    await signIn(page, who.name);
    await expect(page.locator("#greeting")).toContainText(who.fullName);
    await expect(page.locator("#role-line")).toContainText(who.role);
    if (who.canCreate) {
      await expect(page.locator("#new-application")).toBeVisible();
    } else {
      await expect(page.locator("#new-application")).toBeHidden();
    }
  });
}
