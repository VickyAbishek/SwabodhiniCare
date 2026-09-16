// scope: shared
// Dev-only: enforces docs/architecture/scope-map.md §1 (scope headers + dependency rules).
// Usage: node scripts/check-scope.mjs   (also runs as part of `npm test`)
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_DIRS = ["public", "shared", "poc", "prod", "scripts"];
const SOURCE_FILE = /\.(?:m?js|gs|html|css)$/;
const HEADER = /^\s*(?:\/\/|<!--|\/\*)\s*scope:\s*(shared|poc|prod)\b/;
const APPS_SCRIPT_HOST = "script.google.com";
const PLATFORM_APIS = [
  "fetch(", "document.", "window.", "localStorage", "sessionStorage",
  "SpreadsheetApp", "DriveApp", "UrlFetchApp", "ScriptApp", "MailApp", "LockService", "CacheService",
  "env.DB", "env.FILES",
];

export function toPosix(p) {
  return p.split(sep).join("/");
}

export function expectedScope(relPath) {
  const p = toPosix(relPath);
  if (p.startsWith("poc/") || p === "public/js/backends/poc.js") return "poc";
  if (p.startsWith("prod/") || p === "public/js/backends/prod.js") return "prod";
  return "shared";
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

export function referencedPaths(content, isHtml) {
  const patterns = [/\b(?:from|import|require)\s*\(?\s*["'`]([^"'`]+)["'`]/g];
  if (isHtml) patterns.push(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g);
  const found = [];
  for (const re of patterns) {
    for (const match of content.matchAll(re)) found.push(match[1]);
  }
  return found;
}

function headerErrors(p, content, scope) {
  const header = content.match(HEADER);
  if (!header) return [`${p}: missing "scope: ${scope}" header on the first line`];
  if (header[1] !== scope) return [`${p}: header says "${header[1]}" but its folder means "${scope}"`];
  return [];
}

function dependencyErrors(p, scope, refs) {
  const pocRef = refs.find((r) => /(^|\/)poc\/|backends\/poc/.test(r));
  const prodRef = refs.find((r) => /(^|\/)prod\/|backends\/prod/.test(r));
  const errors = [];
  if (scope === "shared" && pocRef) errors.push(`${p}: shared code must not reference POC code (${pocRef})`);
  if (scope === "shared" && prodRef) errors.push(`${p}: shared code must not reference production code (${prodRef})`);
  if (scope === "poc" && prodRef) errors.push(`${p}: POC code must not reference production code (${prodRef})`);
  if (scope === "prod" && pocRef) errors.push(`${p}: production code must not reference POC code (${pocRef})`);
  return errors;
}

function sharedFolderErrors(p, code, refs) {
  if (!p.startsWith("shared/")) return [];
  const errors = [];
  if (refs.length > 0) {
    errors.push(`${p}: shared/ files are plain scripts and must not import anything (${refs.join(", ")})`);
  }
  for (const api of PLATFORM_APIS) {
    if (code.includes(api)) errors.push(`${p}: shared/ must not use platform API "${api}"`);
  }
  return errors;
}

export function checkFile(relPath, content) {
  const p = toPosix(relPath);
  const scope = expectedScope(p);
  const code = stripComments(content);
  const refs = referencedPaths(code, p.endsWith(".html"));
  const errors = [
    ...headerErrors(p, content, scope),
    ...dependencyErrors(p, scope, refs),
    ...sharedFolderErrors(p, code, refs),
  ];
  const mayHoldApiUrl = p === "public/js/config.js" || scope !== "shared";
  if (p.startsWith("public/") && !mayHoldApiUrl && code.includes(APPS_SCRIPT_HOST)) {
    errors.push(`${p}: the Apps Script URL belongs only in public/js/config.js or a back-end adapter`);
  }
  return errors;
}

export function listSourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_FILE.test(entry.name)) files.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) walk(join(root, dir));
  return files;
}

export function run(root) {
  return listSourceFiles(root).flatMap((file) => checkFile(relative(root, file), readFileSync(file, "utf8")));
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const errors = run(fileURLToPath(new URL("..", import.meta.url)));
  if (errors.length > 0) {
    console.error(`Scope check failed (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("Scope check passed.");
}
