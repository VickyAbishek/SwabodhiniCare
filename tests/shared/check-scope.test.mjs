import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { expectedScope, checkFile, run } from "../../scripts/check-scope.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("expectedScope maps folders to scopes", () => {
  assert.equal(expectedScope("shared/workflow.js"), "shared");
  assert.equal(expectedScope("public/js/api.js"), "shared");
  assert.equal(expectedScope("poc/apps-script/Api.gs"), "poc");
  assert.equal(expectedScope("public/js/backends/poc.js"), "poc");
  assert.equal(expectedScope("public/js/seed/sample-applications.js"), "poc");
  assert.equal(expectedScope("prod/worker/src/index.js"), "prod");
  assert.equal(expectedScope("public/js/backends/prod.js"), "prod");
});

test("a file with the right header passes", () => {
  assert.deepEqual(checkFile("shared/a.js", "// scope: shared\nvar A = 1;\n"), []);
});

test("a missing header is reported", () => {
  const errors = checkFile("shared/a.js", "var A = 1;\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing "scope: shared" header/);
});

test("a header that does not match the folder is reported", () => {
  const errors = checkFile("poc/apps-script/Api.gs", "// scope: shared\n");
  assert.match(errors[0], /says "shared" but its folder means "poc"/);
});

test("HTML and CSS headers are recognised", () => {
  assert.deepEqual(checkFile("public/index.html", "<!-- scope: shared -->\n<p>Hi</p>"), []);
  assert.deepEqual(checkFile("public/css/app.css", "/* scope: shared */\nbody {}"), []);
});

test("shared code may not reference POC or production code", () => {
  const js = checkFile("public/js/ui.js", '// scope: shared\nimport { x } from "./backends/poc.js";\n');
  assert.match(js.join("\n"), /must not reference POC code/);
  const html = checkFile("public/index.html", '<!-- scope: shared -->\n<script src="js/backends/prod.js"></script>');
  assert.match(html.join("\n"), /must not reference production code/);
  const seed = checkFile("public/js/ui.js", '// scope: shared\nimport { S } from "./seed/sample-applications.js";\n');
  assert.match(seed.join("\n"), /must not reference POC code/);
});

test("POC and production code may not reference each other", () => {
  const poc = checkFile("poc/apps-script/A.gs", '// scope: poc\nconst w = require("../../prod/worker/x.js");\n');
  assert.match(poc.join("\n"), /POC code must not reference production code/);
  const prod = checkFile("prod/worker/src/a.js", '// scope: prod\nimport y from "../../../poc/seed/y.js";\n');
  assert.match(prod.join("\n"), /production code must not reference POC code/);
});

test("shared/ files are plain scripts without imports or platform APIs", () => {
  const withImport = checkFile("shared/a.js", '// scope: shared\nconst fs = require("node:fs");\n');
  assert.match(withImport.join("\n"), /plain scripts/);
  const withApi = checkFile("shared/a.js", "// scope: shared\nvar x = document.title;\n");
  assert.match(withApi.join("\n"), /platform API "document\."/);
});

test("platform API names inside comments are ignored", () => {
  const content = "// scope: shared\n// see the design document.\n/* fetch( is not called */\nvar a = 1;\n";
  assert.deepEqual(checkFile("shared/a.js", content), []);
});

test("only config.js and back-end adapters may hold the Apps Script URL", () => {
  const url = 'var u = "https://script.google.com/macros/s/abc/exec";';
  assert.deepEqual(checkFile("public/js/config.js", "// scope: shared\n" + url), []);
  assert.deepEqual(checkFile("public/js/backends/poc.js", "// scope: poc\n" + url), []);
  assert.match(checkFile("public/js/ui.js", "// scope: shared\n" + url).join("\n"), /Apps Script URL/);
});

test("shared/ files may load sibling shared files, and nothing else", () => {
  const sibling = '// scope: shared\nvar S = typeof SC_X !== "undefined" ? SC_X : require("./form-schema.js");\n';
  assert.deepEqual(checkFile("shared/form-rules.js", sibling), []);
  const parent = checkFile("shared/a.js", '// scope: shared\nvar P = require("../public/js/api.js");\n');
  assert.match(parent.join("\n"), /plain scripts/);
  const nested = checkFile("shared/a.js", '// scope: shared\nvar N = require("./lib/b.js");\n');
  assert.match(nested.join("\n"), /plain scripts/);
});

test("the repository passes its own scope check", () => {
  assert.deepEqual(run(ROOT), []);
});
