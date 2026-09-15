import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "../../poc/scripts/build.mjs";
import { SHARED_ORDER, sourceFiles } from "../../poc/scripts/source-order.mjs";

const require = createRequire(import.meta.url);
const fakes = require("./fakes.js");
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const rel = (file) => relative(ROOT, file).split("\\").join("/");

function buildOnce() {
  const outDir = mkdtempSync(join(tmpdir(), "sc-build-"));
  const result = build({ root: ROOT, outDir });
  return { outDir, result, code: readFileSync(join(outDir, "Code.js"), "utf8") };
}

test("shared scripts come first, in dependency order, then the server files", () => {
  const files = sourceFiles(ROOT).map(rel);
  assert.deepEqual(files.slice(0, SHARED_ORDER.length), SHARED_ORDER.map((name) => `shared/${name}.js`));
  const server = files.slice(SHARED_ORDER.length);
  assert.ok(server.length > 0 && server.every((f) => f.startsWith("poc/apps-script/") && f.endsWith(".gs")));
  assert.deepEqual(server, [...server].sort());
});

test("the build writes one Code.js holding every source in order, plus the manifest", () => {
  const { outDir, result, code } = buildOnce();
  const files = sourceFiles(ROOT).map(rel);
  assert.deepEqual(result.files, files);
  assert.ok(code.startsWith("// scope: poc"));
  let last = -1;
  for (const file of files) {
    const at = code.indexOf(`// ---- ${file} ----`);
    assert.ok(at > last, `${file} appears after the previous file`);
    last = at;
  }
  assert.ok(existsSync(join(outDir, "appsscript.json")));
  const manifest = JSON.parse(readFileSync(join(outDir, "appsscript.json"), "utf8"));
  assert.equal(manifest.timeZone, "Asia/Kolkata");
  assert.equal(manifest.runtimeVersion, "V8");
  assert.deepEqual(manifest.webapp, { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" });
});

test("the bundle runs as a single Apps Script file", () => {
  const { code } = buildOnce();
  const clock = { ms: Date.parse("2026-09-15T10:00:00Z") };
  const context = vm.createContext({
    Utilities: fakes.makeUtilities(),
    SpreadsheetApp: fakes.makeSpreadsheetApp(),
    LockService: fakes.makeLockService(),
    CacheService: fakes.makeCacheService(clock),
    PropertiesService: fakes.makePropertiesService({}),
    ContentService: fakes.makeContentService(),
    console: fakes.makeConsole({ info: [], warns: [], errors: [] }),
    Date: fakes.makeDate(clock),
  });
  vm.runInContext(code, context, { filename: "Code.js" });
  assert.equal(typeof context.doPost, "function");
  assert.equal(typeof context.setup, "function");
  const out = context.doPost({ postData: { contents: "{", type: "text/plain" } });
  assert.equal(JSON.parse(out.getContent()).error.code, "INVALID_REQUEST");
  assert.match(context.setup().setupCode, /^[0-9a-f]{12}$/);
});
