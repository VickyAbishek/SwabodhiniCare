// scope: shared
// Prepares public/ for a Cloudflare Pages deploy: runs the deploy check (copy shared/ →
// public/shared/, verify the HTML references), then writes public/js/config.deploy.js so the
// deployed site's API_BASE points at the Apps Script web app's /exec URL — without editing
// config.js. Usage: SC_API_BASE=<https://script.google.com/.../exec> node scripts/prepare-deploy.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run as runDeployCheck } from "./deploy-check.mjs";

// The exact content of public/js/config.deploy.js, so tests can assert it without touching disk.
export function deployModule(apiBase) {
  return `// scope: shared\n// Written by scripts/prepare-deploy.mjs — an uncommitted deploy-time override.\nexport const DEPLOY = { API_BASE: ${JSON.stringify(apiBase)} };\n`;
}

export function writeDeployConfig(root, apiBase) {
  const target = join(root, "public", "js", "config.deploy.js");
  writeFileSync(target, deployModule(apiBase));
  return target;
}

// Deploy check first; if a shared/ reference is missing, do not write the override.
export function run(root, apiBase) {
  const { copied, missing } = runDeployCheck(root);
  const wrote = missing.length > 0 ? null : writeDeployConfig(root, apiBase);
  return { copied, missing, wrote };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const apiBase = process.env.SC_API_BASE;
  if (!apiBase) {
    console.error("Set SC_API_BASE to the Apps Script web app /exec URL, e.g.");
    console.error("  SC_API_BASE=https://script.google.com/macros/s/.../exec node scripts/prepare-deploy.mjs");
    process.exitCode = 1;
  } else {
    const { copied, missing, wrote } = run(root, apiBase);
    console.log(`Copied ${copied.length} shared file(s) into public/shared/.`);
    if (missing.length > 0) {
      console.error("Missing shared/ references:");
      for (const entry of missing) console.error(`  ${entry}`);
      process.exitCode = 1;
    } else {
      console.log(`Wrote ${wrote} with API_BASE.`);
    }
  }
}
