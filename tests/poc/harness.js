// Loads shared/ scripts and poc/apps-script/*.gs into one node:vm context with fake
// Apps Script services, so the POC server can be tested without a Google account.
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const fakes = require("./fakes.js");

const ROOT = path.join(__dirname, "..", "..");
// Same order as the deploy build (poc/scripts/build.mjs): dependencies first.
const SHARED_ORDER = ["dates", "numbers", "permissions", "workflow", "actions", "form-schema", "form-rules"];
const DEFAULT_START = Date.parse("2026-09-15T10:00:00Z");

function sourceFiles() {
  const shared = SHARED_ORDER.map((name) => path.join(ROOT, "shared", name + ".js"));
  const gsDir = path.join(ROOT, "poc", "apps-script");
  const gs = fs.existsSync(gsDir)
    ? fs.readdirSync(gsDir).filter((f) => f.endsWith(".gs")).sort().map((f) => path.join(gsDir, f))
    : [];
  return shared.concat(gs);
}

function createContext(options = {}) {
  const clock = options.clock || { ms: DEFAULT_START };
  const logs = { info: [], warns: [], errors: [] };
  const context = vm.createContext({
    Utilities: fakes.makeUtilities(),
    SpreadsheetApp: fakes.makeSpreadsheetApp(),
    LockService: fakes.makeLockService(),
    CacheService: fakes.makeCacheService(clock),
    PropertiesService: fakes.makePropertiesService(Object.assign({ SHEET_ID: "test-sheet" }, options.properties)),
    ContentService: fakes.makeContentService(),
    console: fakes.makeConsole(logs),
    Date: fakes.makeDate(clock),
  });
  for (const file of sourceFiles()) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  context.clock = clock;
  context.logs = logs;
  context.run = (code) => vm.runInContext(code, context);
  return context;
}

// Objects made inside the vm have a different Array/Object prototype; compare plain copies.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { createContext, plain };
