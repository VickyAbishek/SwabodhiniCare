// Shared helpers for the e2e specs. Not a test file itself: Playwright's testMatch looks for
// `*.spec.mjs`, so this module is only imported by them.
import { expect } from "@playwright/test";

export const DEMO_PASSWORD = "demo-pass-2026";

export const email = (name) => `${name}@example.com`;

// Signs in as a demo person (see poc/seed/demo-data.mjs) and waits for the home screen to render.
export async function signIn(page, name) {
  await page.goto("/index.html");
  await page.locator("#email").fill(email(name));
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.locator("#submit").click();
  await page.waitForURL("**/home.html");
  await expect(page.locator("#greeting")).not.toBeEmpty();
}
