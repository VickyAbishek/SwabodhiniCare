// Tests scripts/prepare-deploy.mjs and the config.js deploy-override merge, on a temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployModule, writeDeployConfig, run } from "../../scripts/prepare-deploy.mjs";
import { buildConfig, CONFIG } from "../../public/js/config.js";

const EXEC = "https://script.google.com/macros/s/AKfycb-test/exec";

test("deployModule serialises the API_BASE override as an ES module", () => {
  assert.equal(
    deployModule(EXEC),
    `// scope: shared\n// Written by scripts/prepare-deploy.mjs — an uncommitted deploy-time override.\nexport const DEPLOY = { API_BASE: ${JSON.stringify(EXEC)} };\n`,
  );
});

test("writeDeployConfig writes public/js/config.deploy.js", () => {
  const root = mkdtempSync(join(tmpdir(), "sc-prepare-deploy-"));
  mkdirSync(join(root, "public", "js"), { recursive: true });
  const target = writeDeployConfig(root, EXEC);
  assert.equal(target, join(root, "public", "js", "config.deploy.js"));
  assert.match(readFileSync(target, "utf8"), /API_BASE: "https:\/\/script\.google\.com/);
});

test("buildConfig reflects the override and stays /api by default", () => {
  assert.equal(buildConfig({}).API_BASE, "/api");
  assert.equal(buildConfig({ API_BASE: EXEC }).API_BASE, EXEC);
  assert.equal(CONFIG.API_BASE, "/api"); // the committed config.deploy.js is empty
});

test("run copies shared/, verifies references, and writes config.deploy.js", () => {
  const root = mkdtempSync(join(tmpdir(), "sc-prepare-deploy-"));
  mkdirSync(join(root, "public", "js"), { recursive: true });
  mkdirSync(join(root, "shared"), { recursive: true });
  writeFileSync(join(root, "shared", "actions.js"), "// scope: shared\n");
  const result = run(root, EXEC);
  assert.deepEqual(result.copied, ["actions.js"]);
  assert.deepEqual(result.missing, []);
  assert.match(readFileSync(join(root, "public", "js", "config.deploy.js"), "utf8"), /API_BASE/);
});
