// Tests scripts/deploy-check.mjs against a throwaway directory, so nothing touches the real repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyShared, checkReferences, run } from "../../scripts/deploy-check.mjs";

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "sc-deploy-check-"));
  mkdirSync(join(root, "shared"), { recursive: true });
  mkdirSync(join(root, "public"), { recursive: true });
  return root;
}

test("copyShared copies every shared/*.js into public/shared/ and skips non-JS", () => {
  const root = makeRepo();
  writeFileSync(join(root, "shared", "a.js"), "// scope: shared\nvar A = 1;\n");
  writeFileSync(join(root, "shared", "b.js"), "// scope: shared\nvar B = 2;\n");
  writeFileSync(join(root, "shared", "notes.txt"), "not js");
  const copied = copyShared(root);
  assert.deepEqual(copied.sort(), ["a.js", "b.js"]);
  assert.equal(readFileSync(join(root, "public", "shared", "a.js"), "utf8"), "// scope: shared\nvar A = 1;\n");
});

test("checkReferences reports a missing shared/ reference and passes a present one", () => {
  const root = makeRepo();
  writeFileSync(join(root, "shared", "actions.js"), "// scope: shared\n");
  writeFileSync(join(root, "public", "home.html"),
    '<!-- scope: shared --><script src="shared/actions.js"></script><script src="shared/missing.js"></script>');
  assert.deepEqual(checkReferences(root), ["home.html: shared/missing.js"]);
});

test("run copies and returns the missing references together", () => {
  const root = makeRepo();
  writeFileSync(join(root, "shared", "a.js"), "// scope: shared\n");
  writeFileSync(join(root, "public", "x.html"),
    '<script src="shared/a.js"></script><script src="shared/nope.js"></script>');
  const result = run(root);
  assert.deepEqual(result.copied, ["a.js"]);
  assert.deepEqual(result.missing, ["x.html: shared/nope.js"]);
});
