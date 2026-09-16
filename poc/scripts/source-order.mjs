// scope: poc
// The order the POC server's files load in: shared scripts first (each after the scripts it uses),
// then the Apps Script files alphabetically. The build and the tests both use this list.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SHARED_ORDER = Object.freeze([
  "dates", "numbers", "permissions", "workflow", "actions", "form-schema", "form-rules",
]);

export function sourceFiles(root) {
  const shared = SHARED_ORDER.map((name) => join(root, "shared", `${name}.js`));
  const gsDir = join(root, "poc", "apps-script");
  const gs = existsSync(gsDir)
    ? readdirSync(gsDir).filter((file) => file.endsWith(".gs")).sort().map((file) => join(gsDir, file))
    : [];
  return [...shared, ...gs];
}
