// Dev-only end-to-end suite (not part of `npm test`). Boots the POC dev server — a single in-memory
// instance seeded with one application per workflow stage — and drives it with one worker, because
// parallel workers would race each other on the same seeded rows. Tests that change server state
// (send-back, conflict) mutate only their own file or a fresh draft, so the shared seed stays the
// ground truth for the read-only tests.
// Run with `npm run test:e2e` (the config lives here, so a bare `npx playwright test` from the repo
// root would fall back to Playwright's defaults and sweep up the `node --test` unit suites).
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baseURL = "http://127.0.0.1:8787";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node poc/scripts/dev-server.mjs",
    cwd: root,
    url: `${baseURL}/index.html`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
