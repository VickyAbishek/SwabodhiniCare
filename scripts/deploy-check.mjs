// scope: shared
// Deploy check for Cloudflare Pages: the dev server serves /shared/ straight from the repo's
// shared/ folder, but Pages serves only public/. So this copies every shared/*.js into
// public/shared/ (gitignored) and verifies that every <script src="shared/…"> in public/*.html
// resolves to a file that exists — drift is caught here, not on a broken page.
// Usage: node scripts/deploy-check.mjs   (also importable; exports the pieces for tests)
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Copies every shared/*.js into public/shared/, returning the names copied.
export function copyShared(root) {
  const sharedDir = join(root, "shared");
  const outDir = join(root, "public", "shared");
  const names = readdirSync(sharedDir).filter((name) => name.endsWith(".js"));
  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    writeFileSync(join(outDir, name), readFileSync(join(sharedDir, name)));
  }
  return names;
}

// Returns the list of "<html file>: shared/<ref>" whose referenced file is missing from shared/.
export function checkReferences(root) {
  const sharedDir = join(root, "shared");
  const publicDir = join(root, "public");
  const missing = [];
  for (const html of readdirSync(publicDir).filter((name) => name.endsWith(".html"))) {
    const content = readFileSync(join(publicDir, html), "utf8");
    for (const match of content.matchAll(/\bsrc\s*=\s*["']shared\/([^"']+)["']/g)) {
      const ref = match[1];
      if (!ref.endsWith(".js") || !existsSync(join(sharedDir, ref))) {
        missing.push(`${html}: shared/${ref}`);
      }
    }
  }
  return missing;
}

export function run(root) {
  const copied = copyShared(root);
  const missing = checkReferences(root);
  return { copied, missing };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { copied, missing } = run(root);
  console.log(`Copied ${copied.length} shared file(s) into public/shared/.`);
  if (missing.length > 0) {
    console.error("Missing shared/ references:");
    for (const entry of missing) console.error(`  ${entry}`);
    process.exitCode = 1;
  } else {
    console.log("Every shared/ reference resolves.");
  }
}
