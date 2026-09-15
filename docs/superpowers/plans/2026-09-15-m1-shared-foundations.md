# M1: Shared Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tooling and the pure `[SHARED]` logic that every later milestone (POC and production) depends on: scope checking, number and date formats, roles and permissions, the application workflow, and the API contract.

**Architecture:** Every `shared/` file is a **plain script** (no imports) that defines one frozen global (`SC_Numbers`, `SC_Dates`, `SC_Permissions`, `SC_Workflow`, `SC_Actions`) and ends with a `module.exports` line. The same file therefore runs unchanged in the browser (`<script src>`), in Google Apps Script (global scope) and in Node's test runner (`require`). `scripts/check-scope.mjs` enforces the folder rules from `docs/architecture/scope-map.md`.

**Tech Stack:** Plain JavaScript (ES2019+, V8), Node.js ≥ 20 built-in test runner (`node --test`), **no npm dependencies**.

**Spec:** `docs/superpowers/specs/2026-09-15-swabodhinicare-design.md` (§4 roles, §5 workflow, §9 API envelope), `docs/superpowers/specs/2026-09-15-swabodhinicare-poc-sheets-design.md` (§5 actions), `docs/architecture/scope-map.md` (§1 rules, F3–F5, F13).

## Global Constraints

- No runtime dependencies. `package.json` has **no `dependencies`** and, for M1, no `devDependencies`.
- Every source file's first line is a scope header: `// scope: shared` (or `poc` / `prod`; `<!-- scope: … -->` in HTML, `/* scope: … */` in CSS).
- `shared/` files: no `import`/`require`, no network, DOM, storage, Google or Cloudflare APIs.
- Exported objects are frozen (`Object.freeze`); functions never mutate their inputs.
- Errors that reach users are **codes** from `SC_Actions.ERRORS`, each with English and Tamil text.
- Functions under 50 lines; files under 400 lines.
- Application number `APP-<YYYY>-<NNNN>`; registration number `SWB/<CENTRE>/<YYYY>/<NNNN>`; centre codes `TVM`, `VLC`, `TDP`, `SLR`.
- Run everything with `npm test` (scope check + all tests). Coverage: `npm run coverage` (target 80%+ on `shared/`).

---

## File map

| File | Scope | Responsibility |
|---|---|---|
| `package.json` | shared | Scripts: `test`, `check:scope`, `coverage`; `engines.node >= 20` |
| `scripts/check-scope.mjs` | shared (dev-only) | Scope headers + dependency rules |
| `shared/numbers.js` | shared | `formatAppNo`, `formatRegNo`, `CENTRE_CODES` |
| `shared/dates.js` | shared | `parseIsoDate`, `toIsoDate`, `isValidDateParts`, `ageFrom`, `daysBetween` |
| `shared/permissions.js` | shared | `ROLES`, `CAPABILITIES`, `can`, `canViewApplication`, `canEditApplication` |
| `shared/workflow.js` | shared | `STATUS`, `ACTION`, `next`, `availableActions`, `isEditable`, `reviewerRole` |
| `shared/actions.js` | shared | `ACTIONS` contract, `ERRORS` (EN/TA), `ok()`, `fail()`, `describe()` |
| `tests/shared/*.test.{js,mjs}` | — | One test file per module |

---

### Task 1: Tooling and the scope check

**Files:**
- Create: `package.json`
- Create: `scripts/check-scope.mjs`
- Test: `tests/shared/check-scope.test.mjs`

**Interfaces:**
- Produces: `expectedScope(relPath) → "shared"|"poc"|"prod"`, `checkFile(relPath, content) → string[]`, `run(root) → string[]`; CLI `node scripts/check-scope.mjs` exits 1 on problems.

- [ ] **Step 1: Write the failing test** — `tests/shared/check-scope.test.mjs`

```js
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

test("the repository passes its own scope check", () => {
  assert.deepEqual(run(ROOT), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared/check-scope.test.mjs`
Expected: FAIL — `Cannot find module …/scripts/check-scope.mjs`

- [ ] **Step 3: Write the implementation** — `scripts/check-scope.mjs`

```js
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
```

- [ ] **Step 4: Create `package.json`**

```json
{
  "name": "swabodhinicare",
  "version": "0.1.0",
  "private": true,
  "description": "Registration and admission app for Swabodhini Autism",
  "engines": { "node": ">=20" },
  "scripts": {
    "check:scope": "node scripts/check-scope.mjs",
    "test": "node scripts/check-scope.mjs && node --test",
    "coverage": "node --test --experimental-test-coverage"
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `Scope check passed.` then all 11 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/check-scope.mjs tests/shared/check-scope.test.mjs
git commit -m "feat: add scope check and test tooling"
```

---

### Task 2: Number and date formats

**Files:**
- Create: `shared/numbers.js`, `shared/dates.js`
- Test: `tests/shared/numbers.test.js`, `tests/shared/dates.test.js`

**Interfaces:**
- Produces: `SC_Numbers.formatAppNo(year:int, seq:int) → string`, `SC_Numbers.formatRegNo(centreCode:string, year:int, seq:int) → string`, `SC_Numbers.CENTRE_CODES`; `SC_Dates.parseIsoDate(text) → {year,month,day}`, `SC_Dates.toIsoDate(y,m,d) → "YYYY-MM-DD"`, `SC_Dates.isValidDateParts(y,m,d) → boolean`, `SC_Dates.ageFrom(dobIso, onIso) → {years, months}`, `SC_Dates.daysBetween(fromIso, toIso) → int`. Invalid input throws `RangeError`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/numbers.test.js`
```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const N = require("../../shared/numbers.js");

test("formatAppNo pads the sequence to four digits", () => {
  assert.equal(N.formatAppNo(2026, 42), "APP-2026-0042");
  assert.equal(N.formatAppNo(2026, 9999), "APP-2026-9999");
});

test("formatRegNo builds SWB/<centre>/<year>/<seq>", () => {
  assert.equal(N.formatRegNo("VLC", 2026, 13), "SWB/VLC/2026/0013");
});

test("the four centre codes are known", () => {
  assert.deepEqual([...N.CENTRE_CODES], ["TVM", "VLC", "TDP", "SLR"]);
  assert.ok(Object.isFrozen(N.CENTRE_CODES));
});

test("unknown centres, bad sequences and bad years are rejected", () => {
  assert.throws(() => N.formatRegNo("XYZ", 2026, 1), RangeError);
  assert.throws(() => N.formatAppNo(2026, 0), RangeError);
  assert.throws(() => N.formatAppNo(2026, 10000), RangeError);
  assert.throws(() => N.formatAppNo(2026, 1.5), RangeError);
  assert.throws(() => N.formatAppNo(26, 1), RangeError);
});
```

`tests/shared/dates.test.js`
```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../shared/dates.js");

test("ageFrom counts whole years and months", () => {
  assert.deepEqual(D.ageFrom("2020-03-14", "2026-09-15"), { years: 6, months: 6 });
  assert.deepEqual(D.ageFrom("2020-03-14", "2026-09-13"), { years: 6, months: 5 });
  assert.deepEqual(D.ageFrom("2020-03-14", "2026-03-14"), { years: 6, months: 0 });
  assert.deepEqual(D.ageFrom("2026-09-15", "2026-09-15"), { years: 0, months: 0 });
});

test("ageFrom rejects a birth date in the future", () => {
  assert.throws(() => D.ageFrom("2026-09-16", "2026-09-15"), RangeError);
});

test("isValidDateParts knows month lengths and leap years", () => {
  assert.equal(D.isValidDateParts(2024, 2, 29), true);
  assert.equal(D.isValidDateParts(2023, 2, 29), false);
  assert.equal(D.isValidDateParts(2026, 4, 31), false);
  assert.equal(D.isValidDateParts(2026, 13, 1), false);
  assert.equal(D.isValidDateParts(2026, 1, 0), false);
});

test("parseIsoDate accepts only real YYYY-MM-DD dates", () => {
  assert.deepEqual(D.parseIsoDate("2020-03-14"), { year: 2020, month: 3, day: 14 });
  assert.throws(() => D.parseIsoDate("2026-9-1"), RangeError);
  assert.throws(() => D.parseIsoDate("2026-02-30"), RangeError);
});

test("toIsoDate pads month and day", () => {
  assert.equal(D.toIsoDate(2020, 3, 4), "2020-03-04");
  assert.throws(() => D.toIsoDate(2023, 2, 29), RangeError);
});

test("daysBetween counts calendar days", () => {
  assert.equal(D.daysBetween("2026-09-06", "2026-09-15"), 9);
  assert.equal(D.daysBetween("2026-08-31", "2026-09-01"), 1);
  assert.equal(D.daysBetween("2026-09-15", "2026-09-15"), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/shared/numbers.test.js tests/shared/dates.test.js`
Expected: FAIL — `Cannot find module '../../shared/numbers.js'`

- [ ] **Step 3: Write the implementation**

`shared/numbers.js`
```js
// scope: shared
/* Application and registration number formats (main spec §5, scope map F13). */
var SC_Numbers = (function () {
  "use strict";

  var CENTRE_CODES = Object.freeze(["TVM", "VLC", "TDP", "SLR"]);

  function pad4(seq) {
    if (!Number.isInteger(seq) || seq < 1 || seq > 9999) {
      throw new RangeError("Sequence must be a whole number from 1 to 9999, got " + seq);
    }
    return String(seq).padStart(4, "0");
  }

  function checkYear(year) {
    if (!Number.isInteger(year) || year < 2000 || year > 2999) {
      throw new RangeError("Year must be a four-digit number, got " + year);
    }
  }

  function formatAppNo(year, seq) {
    checkYear(year);
    return "APP-" + year + "-" + pad4(seq);
  }

  function formatRegNo(centreCode, year, seq) {
    if (CENTRE_CODES.indexOf(centreCode) === -1) {
      throw new RangeError("Unknown centre code: " + centreCode);
    }
    checkYear(year);
    return "SWB/" + centreCode + "/" + year + "/" + pad4(seq);
  }

  return Object.freeze({ CENTRE_CODES: CENTRE_CODES, formatAppNo: formatAppNo, formatRegNo: formatRegNo });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Numbers;
}
```

`shared/dates.js`
```js
// scope: shared
/* Date helpers on plain "YYYY-MM-DD" strings, so no time zone can shift a date. */
var SC_Dates = (function () {
  "use strict";

  var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY_MS = 86400000;

  function isValidDateParts(year, month, day) {
    if (![year, month, day].every(Number.isInteger)) return false;
    if (month < 1 || month > 12 || day < 1) return false;
    var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= daysInMonth;
  }

  function parseIsoDate(text) {
    var match = ISO_DATE.exec(String(text));
    if (!match) throw new RangeError("Expected a date like 2020-03-14, got " + text);
    var parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    if (!isValidDateParts(parts.year, parts.month, parts.day)) {
      throw new RangeError("Not a real calendar date: " + text);
    }
    return parts;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toIsoDate(year, month, day) {
    if (!isValidDateParts(year, month, day)) {
      throw new RangeError("Not a real calendar date: " + [year, month, day].join("-"));
    }
    return year + "-" + pad2(month) + "-" + pad2(day);
  }

  function ageFrom(dobIso, onIso) {
    var dob = parseIsoDate(dobIso);
    var on = parseIsoDate(onIso);
    var months = (on.year - dob.year) * 12 + (on.month - dob.month);
    if (on.day < dob.day) months -= 1;
    if (months < 0) throw new RangeError("Date of birth " + dobIso + " is after " + onIso);
    return { years: Math.floor(months / 12), months: months % 12 };
  }

  function daysBetween(fromIso, toIso) {
    var a = parseIsoDate(fromIso);
    var b = parseIsoDate(toIso);
    var diff = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
    return Math.round(diff / DAY_MS);
  }

  return Object.freeze({
    isValidDateParts: isValidDateParts,
    parseIsoDate: parseIsoDate,
    toIsoDate: toIsoDate,
    ageFrom: ageFrom,
    daysBetween: daysBetween,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Dates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: scope check passes; numbers and dates tests PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/numbers.js shared/dates.js tests/shared/numbers.test.js tests/shared/dates.test.js
git commit -m "feat: add shared number and date formats"
```

---

### Task 3: Roles and permissions

**Files:**
- Create: `shared/permissions.js`
- Test: `tests/shared/permissions.test.js`

**Interfaces:**
- Produces: `SC_Permissions.ROLES` (frozen array), `SC_Permissions.CAPABILITIES` (frozen map capability → roles), `can(roles:string[], capability:string) → boolean` (throws `Error` on an unknown capability), `canViewApplication(user:{id, roles}, application:{createdBy}) → boolean`, `canEditApplication(user, application) → boolean` (owner only; status is checked by `SC_Workflow.isEditable`).

- [ ] **Step 1: Write the failing test** — `tests/shared/permissions.test.js`

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../shared/permissions.js");

test("the five roles exist", () => {
  assert.deepEqual([...P.ROLES], ["ADMIN", "THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);
});

test("capabilities follow the main spec §4 table", () => {
  assert.equal(P.can(["THERAPIST"], "application.create"), true);
  assert.equal(P.can(["DIRECTOR"], "application.create"), false);
  assert.equal(P.can(["THERAPIST"], "application.viewAll"), false);
  assert.equal(P.can(["THERAPY_HEAD"], "review.therapyHead"), true);
  assert.equal(P.can(["CENTRE_HEAD"], "review.therapyHead"), false);
  assert.equal(P.can(["DIRECTOR"], "decision.final"), true);
  assert.equal(P.can(["ADMIN"], "decision.final"), false);
  assert.equal(P.can(["ADMIN"], "users.manage"), true);
  assert.equal(P.can(["DIRECTOR"], "backups.view"), true);
  assert.equal(P.can(["DIRECTOR"], "backups.run"), false);
  assert.equal(P.can(["THERAPIST"], "reports.view"), false);
});

test("a person with two roles gets both sets of capabilities", () => {
  const roles = ["CENTRE_HEAD", "THERAPIST"];
  assert.equal(P.can(roles, "application.create"), true);
  assert.equal(P.can(roles, "review.centreHead"), true);
});

test("no roles means no capabilities", () => {
  assert.equal(P.can([], "application.create"), false);
  assert.equal(P.can(undefined, "application.create"), false);
});

test("an unknown capability is a programming error", () => {
  assert.throws(() => P.can(["ADMIN"], "application.fly"), /Unknown capability/);
});

test("therapists see only their own applications; heads see all", () => {
  const app = { createdBy: "u-priya" };
  assert.equal(P.canViewApplication({ id: "u-priya", roles: ["THERAPIST"] }, app), true);
  assert.equal(P.canViewApplication({ id: "u-deepa", roles: ["THERAPIST"] }, app), false);
  assert.equal(P.canViewApplication({ id: "u-lakshmi", roles: ["THERAPY_HEAD"] }, app), true);
});

test("only the person who filled in an application may edit it", () => {
  const app = { createdBy: "u-priya" };
  assert.equal(P.canEditApplication({ id: "u-priya", roles: ["THERAPIST"] }, app), true);
  assert.equal(P.canEditApplication({ id: "u-anand", roles: ["ADMIN"] }, app), false);
});

test("the permission tables are frozen", () => {
  assert.ok(Object.isFrozen(P.CAPABILITIES));
  assert.ok(Object.isFrozen(P.CAPABILITIES["users.manage"]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared/permissions.test.js`
Expected: FAIL — `Cannot find module '../../shared/permissions.js'`

- [ ] **Step 3: Write the implementation** — `shared/permissions.js`

```js
// scope: shared
/* Roles and what each role may do (main spec §4). Pure data and checks. */
var SC_Permissions = (function () {
  "use strict";

  var ROLES = Object.freeze(["ADMIN", "THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR"]);

  var TABLE = {
    "application.create": ["THERAPIST", "THERAPY_HEAD", "CENTRE_HEAD", "ADMIN"],
    "application.viewAll": ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR", "ADMIN"],
    "application.reopen": ["DIRECTOR", "ADMIN"],
    "review.therapyHead": ["THERAPY_HEAD"],
    "review.centreHead": ["CENTRE_HEAD"],
    "decision.final": ["DIRECTOR"],
    "reports.view": ["THERAPY_HEAD", "CENTRE_HEAD", "DIRECTOR", "ADMIN"],
    "users.manage": ["ADMIN"],
    "backups.view": ["DIRECTOR", "ADMIN"],
    "backups.run": ["ADMIN"],
    "audit.view": ["DIRECTOR", "ADMIN"],
  };

  var CAPABILITIES = Object.freeze(
    Object.keys(TABLE).reduce(function (acc, key) {
      acc[key] = Object.freeze(TABLE[key].slice());
      return acc;
    }, {})
  );

  function can(roles, capability) {
    var allowed = CAPABILITIES[capability];
    if (!allowed) throw new Error("Unknown capability: " + capability);
    return (roles || []).some(function (role) {
      return allowed.indexOf(role) !== -1;
    });
  }

  function canViewApplication(user, application) {
    return can(user.roles, "application.viewAll") || application.createdBy === user.id;
  }

  function canEditApplication(user, application) {
    return application.createdBy === user.id;
  }

  return Object.freeze({
    ROLES: ROLES,
    CAPABILITIES: CAPABILITIES,
    can: can,
    canViewApplication: canViewApplication,
    canEditApplication: canEditApplication,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Permissions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/permissions.js tests/shared/permissions.test.js
git commit -m "feat: add shared roles and permissions"
```

---

### Task 4: Application workflow

**Files:**
- Create: `shared/workflow.js`
- Test: `tests/shared/workflow.test.js`

**Interfaces:**
- Produces: `SC_Workflow.STATUS`, `SC_Workflow.ACTION` (frozen string maps), `next(status, action, ctx) → { ok, status, error }` where `error` is one of `INVALID_TRANSITION`, `NOT_ALLOWED`, `OWN_APPLICATION`, `ALREADY_APPROVED_STAGE`, `COMMENT_REQUIRED`; `availableActions(status, ctx) → string[]`; `isEditable(status) → boolean`; `reviewerRole(status) → role | null`.
- `ctx = { actorId, actorRoles: string[], createdBy, approvedThisRound: string[] /* ids that approved an earlier stage since the last (re)submission */, comment }`.

- [ ] **Step 1: Write the failing test** — `tests/shared/workflow.test.js`

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../shared/workflow.js");

const S = W.STATUS;
const owner = { actorId: "u-priya", actorRoles: ["THERAPIST"], createdBy: "u-priya" };
const actor = (id, roles, extra) =>
  Object.assign({ actorId: id, actorRoles: roles, createdBy: "u-priya", approvedThisRound: [] }, extra);
const therapyHead = (extra) => actor("u-lakshmi", ["THERAPY_HEAD"], extra);
const centreHead = (extra) => actor("u-suresh", ["CENTRE_HEAD"], Object.assign({ approvedThisRound: ["u-lakshmi"] }, extra));
const director = (extra) =>
  actor("u-revathi", ["DIRECTOR"], Object.assign({ approvedThisRound: ["u-lakshmi", "u-suresh"] }, extra));

test("main path: draft to admitted", () => {
  assert.equal(W.next(S.DRAFT, "SUBMIT", owner).status, S.PENDING_THERAPY_HEAD);
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", therapyHead()).status, S.PENDING_CENTRE_HEAD);
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "APPROVE", centreHead()).status, S.PENDING_DIRECTOR);
  assert.equal(W.next(S.PENDING_DIRECTOR, "ADMIT", director()).status, S.ADMITTED);
});

test("any reviewer can send back; resubmitting restarts at the Therapy Head", () => {
  const comment = { comment: "Please add the diagnosis report." };
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "SEND_BACK", therapyHead(comment)).status, S.RETURNED);
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "SEND_BACK", centreHead(comment)).status, S.RETURNED);
  assert.equal(W.next(S.PENDING_DIRECTOR, "SEND_BACK", director(comment)).status, S.RETURNED);
  assert.equal(W.next(S.RETURNED, "SUBMIT", owner).status, S.PENDING_THERAPY_HEAD);
});

test("send back and reject need a real comment", () => {
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "SEND_BACK", centreHead()).error, "COMMENT_REQUIRED");
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "REJECT", centreHead({ comment: "   " })).error, "COMMENT_REQUIRED");
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "REJECT", centreHead({ comment: "No seat." })).status, S.REJECTED);
});

test("rejected and withdrawn applications cannot move again", () => {
  assert.equal(W.next(S.REJECTED, "SUBMIT", owner).error, "INVALID_TRANSITION");
  assert.equal(W.next(S.WITHDRAWN, "SUBMIT", owner).error, "INVALID_TRANSITION");
});

test("waitlisted applications can be admitted later by the Director", () => {
  assert.equal(W.next(S.PENDING_DIRECTOR, "WAITLIST", director()).status, S.WAITLISTED);
  assert.equal(W.next(S.WAITLISTED, "ADMIT", director()).status, S.ADMITTED);
});

test("only the role for the current stage can decide", () => {
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", actor("u-suresh", ["CENTRE_HEAD"])).error, "NOT_ALLOWED");
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", actor("u-anand", ["ADMIN"])).error, "NOT_ALLOWED");
});

test("nobody reviews an application they filled in", () => {
  const selfReview = actor("u-lakshmi", ["THERAPY_HEAD"], { createdBy: "u-lakshmi" });
  assert.equal(W.next(S.PENDING_THERAPY_HEAD, "APPROVE", selfReview).error, "OWN_APPLICATION");
});

test("one person cannot approve two stages in the same round", () => {
  const both = actor("u-mala", ["THERAPY_HEAD", "CENTRE_HEAD"], { approvedThisRound: ["u-mala"] });
  assert.equal(W.next(S.PENDING_CENTRE_HEAD, "APPROVE", both).error, "ALREADY_APPROVED_STAGE");
});

test("only the owner submits; the owner or Admin withdraws", () => {
  assert.equal(W.next(S.DRAFT, "SUBMIT", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
  assert.equal(W.next(S.DRAFT, "WITHDRAW", owner).status, S.WITHDRAWN);
  assert.equal(W.next(S.RETURNED, "WITHDRAW", actor("u-anand", ["ADMIN"])).status, S.WITHDRAWN);
  assert.equal(W.next(S.DRAFT, "WITHDRAW", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
});

test("reopening needs the Director or Admin and a reason", () => {
  assert.equal(W.next(S.ADMITTED, "REOPEN", actor("u-anand", ["ADMIN"], { comment: "Wrong DOB." })).status, S.RETURNED);
  assert.equal(W.next(S.ADMITTED, "REOPEN", actor("u-anand", ["ADMIN"])).error, "COMMENT_REQUIRED");
  assert.equal(W.next(S.ADMITTED, "REOPEN", therapyHead({ comment: "x" })).error, "NOT_ALLOWED");
});

test("a person without permission is told so before being asked for a comment", () => {
  assert.equal(W.next(S.PENDING_DIRECTOR, "REJECT", actor("u-deepa", ["THERAPIST"])).error, "NOT_ALLOWED");
});

test("unknown statuses and actions are invalid transitions", () => {
  assert.equal(W.next("FLYING", "SUBMIT", owner).error, "INVALID_TRANSITION");
  assert.equal(W.next(S.DRAFT, "FLY", owner).error, "INVALID_TRANSITION");
});

test("availableActions lists the buttons each person sees", () => {
  assert.deepEqual(W.availableActions(S.DRAFT, owner), ["SUBMIT", "WITHDRAW"]);
  assert.deepEqual(W.availableActions(S.PENDING_THERAPY_HEAD, therapyHead()), ["APPROVE", "SEND_BACK", "REJECT"]);
  assert.deepEqual(W.availableActions(S.PENDING_THERAPY_HEAD, owner), []);
  assert.deepEqual(W.availableActions(S.PENDING_DIRECTOR, director()), ["ADMIT", "WAITLIST", "SEND_BACK", "REJECT"]);
  assert.deepEqual(W.availableActions(S.REJECTED, director()), []);
});

test("only drafts and returned applications are editable", () => {
  assert.equal(W.isEditable(S.DRAFT), true);
  assert.equal(W.isEditable(S.RETURNED), true);
  assert.equal(W.isEditable(S.PENDING_THERAPY_HEAD), false);
  assert.equal(W.isEditable(S.ADMITTED), false);
});

test("reviewerRole names who decides at each waiting status", () => {
  assert.equal(W.reviewerRole(S.PENDING_THERAPY_HEAD), "THERAPY_HEAD");
  assert.equal(W.reviewerRole(S.PENDING_CENTRE_HEAD), "CENTRE_HEAD");
  assert.equal(W.reviewerRole(S.PENDING_DIRECTOR), "DIRECTOR");
  assert.equal(W.reviewerRole(S.WAITLISTED), "DIRECTOR");
  assert.equal(W.reviewerRole(S.DRAFT), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared/workflow.test.js`
Expected: FAIL — `Cannot find module '../../shared/workflow.js'`

- [ ] **Step 3: Write the implementation** — `shared/workflow.js`

```js
// scope: shared
/* Application status machine (main spec §5). Pure: callers load the data, this decides. */
var SC_Workflow = (function () {
  "use strict";

  var STATUS = Object.freeze({
    DRAFT: "DRAFT",
    PENDING_THERAPY_HEAD: "PENDING_THERAPY_HEAD",
    PENDING_CENTRE_HEAD: "PENDING_CENTRE_HEAD",
    PENDING_DIRECTOR: "PENDING_DIRECTOR",
    RETURNED: "RETURNED",
    WAITLISTED: "WAITLISTED",
    ADMITTED: "ADMITTED",
    REJECTED: "REJECTED",
    WITHDRAWN: "WITHDRAWN",
  });

  var ACTION = Object.freeze({
    SUBMIT: "SUBMIT",
    APPROVE: "APPROVE",
    SEND_BACK: "SEND_BACK",
    REJECT: "REJECT",
    ADMIT: "ADMIT",
    WAITLIST: "WAITLIST",
    WITHDRAW: "WITHDRAW",
    REOPEN: "REOPEN",
  });

  // Who decides while an application waits in each status.
  var REVIEWER = Object.freeze({
    PENDING_THERAPY_HEAD: "THERAPY_HEAD",
    PENDING_CENTRE_HEAD: "CENTRE_HEAD",
    PENDING_DIRECTOR: "DIRECTOR",
    WAITLISTED: "DIRECTOR",
  });

  // status -> action -> next status. Key order is the button order on screen.
  var TRANSITIONS = Object.freeze({
    DRAFT: Object.freeze({ SUBMIT: "PENDING_THERAPY_HEAD", WITHDRAW: "WITHDRAWN" }),
    RETURNED: Object.freeze({ SUBMIT: "PENDING_THERAPY_HEAD", WITHDRAW: "WITHDRAWN" }),
    PENDING_THERAPY_HEAD: Object.freeze({ APPROVE: "PENDING_CENTRE_HEAD", SEND_BACK: "RETURNED", REJECT: "REJECTED" }),
    PENDING_CENTRE_HEAD: Object.freeze({ APPROVE: "PENDING_DIRECTOR", SEND_BACK: "RETURNED", REJECT: "REJECTED" }),
    PENDING_DIRECTOR: Object.freeze({ ADMIT: "ADMITTED", WAITLIST: "WAITLISTED", SEND_BACK: "RETURNED", REJECT: "REJECTED" }),
    WAITLISTED: Object.freeze({ ADMIT: "ADMITTED" }),
    ADMITTED: Object.freeze({ REOPEN: "RETURNED" }),
  });

  var NEEDS_COMMENT = Object.freeze({ SEND_BACK: true, REJECT: true, REOPEN: true });

  function hasRole(roles, role) {
    return (roles || []).indexOf(role) !== -1;
  }

  // Returns null when the actor may take the action, otherwise an error code.
  function actorError(status, action, ctx) {
    var roles = ctx.actorRoles || [];
    var isOwner = ctx.actorId === ctx.createdBy;
    if (action === "SUBMIT") return isOwner ? null : "NOT_ALLOWED";
    if (action === "WITHDRAW") return isOwner || hasRole(roles, "ADMIN") ? null : "NOT_ALLOWED";
    if (action === "REOPEN") return hasRole(roles, "DIRECTOR") || hasRole(roles, "ADMIN") ? null : "NOT_ALLOWED";
    if (!hasRole(roles, REVIEWER[status])) return "NOT_ALLOWED";
    if (isOwner) return "OWN_APPLICATION";
    if ((ctx.approvedThisRound || []).indexOf(ctx.actorId) !== -1) return "ALREADY_APPROVED_STAGE";
    return null;
  }

  function next(status, action, ctx) {
    var row = TRANSITIONS[status];
    var target = row && Object.prototype.hasOwnProperty.call(row, action) ? row[action] : null;
    if (!target) return { ok: false, status: null, error: "INVALID_TRANSITION" };
    var error = actorError(status, action, ctx);
    if (!error && NEEDS_COMMENT[action] && !String(ctx.comment || "").trim()) error = "COMMENT_REQUIRED";
    return error ? { ok: false, status: null, error: error } : { ok: true, status: target, error: null };
  }

  function availableActions(status, ctx) {
    var row = TRANSITIONS[status] || {};
    return Object.keys(row).filter(function (action) {
      return actorError(status, action, ctx) === null;
    });
  }

  function isEditable(status) {
    return status === STATUS.DRAFT || status === STATUS.RETURNED;
  }

  function reviewerRole(status) {
    return REVIEWER[status] || null;
  }

  return Object.freeze({
    STATUS: STATUS,
    ACTION: ACTION,
    next: next,
    availableActions: availableActions,
    isEditable: isEditable,
    reviewerRole: reviewerRole,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Workflow;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/workflow.js tests/shared/workflow.test.js
git commit -m "feat: add shared application workflow"
```

---

### Task 5: API contract, error messages and envelope

**Files:**
- Create: `shared/actions.js`
- Test: `tests/shared/actions.test.js`

**Interfaces:**
- Consumes: capability names from `SC_Permissions.CAPABILITIES` (Task 3), error codes from `SC_Workflow.next` (Task 4).
- Produces: `SC_Actions.ACTIONS` (frozen map action → `{ auth: "public"|"user", capability?: string }`), `SC_Actions.ERRORS` (frozen map code → `{ en, ta }`), `ok(data) → {ok:true, data, error:null}`, `fail(code, details?) → {ok:false, data:null, error:{code, message_en, message_ta, details}}` (unknown codes become `SERVER_ERROR`), `describe(action) → entry | null`.

- [ ] **Step 1: Write the failing test** — `tests/shared/actions.test.js`

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../shared/actions.js");
const P = require("../../shared/permissions.js");

test("only prelogin and login work without signing in", () => {
  const publicActions = Object.keys(A.ACTIONS).filter((name) => A.ACTIONS[name].auth === "public");
  assert.deepEqual(publicActions.sort(), ["auth.login", "auth.prelogin"]);
});

test("every action declares auth, and every capability exists", () => {
  for (const [name, entry] of Object.entries(A.ACTIONS)) {
    assert.ok(entry.auth === "public" || entry.auth === "user", name + " has a valid auth");
    if (entry.capability) assert.ok(P.CAPABILITIES[entry.capability], name + " uses a known capability");
  }
});

test("the contract covers the POC spec §5 action list", () => {
  const expected = [
    "auth.prelogin", "auth.login", "auth.logout", "auth.changePassword", "me.get", "me.update",
    "users.list", "users.create", "users.update", "users.resetPassword",
    "applications.list", "applications.create", "applications.get", "applications.save",
    "applications.submit", "applications.review", "applications.decide", "applications.reopen",
    "applications.withdraw", "attachments.upload", "attachments.get", "attachments.delete",
    "signature.upload", "reports.get", "admin.backups.list", "admin.backups.runNow", "admin.audit.list",
  ];
  assert.deepEqual(Object.keys(A.ACTIONS).sort(), expected.sort());
});

test("every workflow error has an English and Tamil message", () => {
  const workflowErrors = ["INVALID_TRANSITION", "NOT_ALLOWED", "OWN_APPLICATION", "ALREADY_APPROVED_STAGE", "COMMENT_REQUIRED"];
  for (const code of workflowErrors) assert.ok(A.ERRORS[code], code + " is defined");
});

test("every error message exists in both languages", () => {
  for (const [code, msg] of Object.entries(A.ERRORS)) {
    assert.ok(msg.en && msg.en.trim(), code + " has English text");
    assert.ok(msg.ta && msg.ta.trim(), code + " has Tamil text");
  }
});

test("ok() and fail() build the shared envelope", () => {
  assert.deepEqual(A.ok({ id: 1 }), { ok: true, data: { id: 1 }, error: null });
  assert.deepEqual(A.ok(), { ok: true, data: null, error: null });
  const f = A.fail("VERSION_CONFLICT", { current: 8 });
  assert.equal(f.ok, false);
  assert.equal(f.data, null);
  assert.equal(f.error.code, "VERSION_CONFLICT");
  assert.equal(f.error.message_en, A.ERRORS.VERSION_CONFLICT.en);
  assert.equal(f.error.message_ta, A.ERRORS.VERSION_CONFLICT.ta);
  assert.deepEqual(f.error.details, { current: 8 });
});

test("an unknown error code becomes SERVER_ERROR", () => {
  assert.equal(A.fail("NO_SUCH_CODE").error.code, "SERVER_ERROR");
});

test("describe() returns the contract entry or null", () => {
  assert.deepEqual(A.describe("reports.get"), { auth: "user", capability: "reports.view" });
  assert.equal(A.describe("nope"), null);
});

test("the contract cannot be changed at runtime", () => {
  assert.ok(Object.isFrozen(A.ACTIONS));
  assert.ok(Object.isFrozen(A.ACTIONS["auth.login"]));
  assert.ok(Object.isFrozen(A.ERRORS));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared/actions.test.js`
Expected: FAIL — `Cannot find module '../../shared/actions.js'`

- [ ] **Step 3: Write the implementation** — `shared/actions.js`

```js
// scope: shared
/* The API contract used by the screens and by both back ends (scope map F5, POC spec §5). */
var SC_Actions = (function () {
  "use strict";

  // auth "public" = no sign-in needed; "user" = signed in. A capability must also pass SC_Permissions.can().
  // Finer checks (owner, workflow stage) happen inside each handler.
  var CONTRACT = {
    "auth.prelogin": { auth: "public" },
    "auth.login": { auth: "public" },
    "auth.logout": { auth: "user" },
    "auth.changePassword": { auth: "user" },
    "me.get": { auth: "user" },
    "me.update": { auth: "user" },
    "users.list": { auth: "user", capability: "users.manage" },
    "users.create": { auth: "user", capability: "users.manage" },
    "users.update": { auth: "user", capability: "users.manage" },
    "users.resetPassword": { auth: "user", capability: "users.manage" },
    "applications.list": { auth: "user" },
    "applications.create": { auth: "user", capability: "application.create" },
    "applications.get": { auth: "user" },
    "applications.save": { auth: "user" },
    "applications.submit": { auth: "user" },
    "applications.review": { auth: "user" },
    "applications.decide": { auth: "user", capability: "decision.final" },
    "applications.reopen": { auth: "user", capability: "application.reopen" },
    "applications.withdraw": { auth: "user" },
    "attachments.upload": { auth: "user" },
    "attachments.get": { auth: "user" },
    "attachments.delete": { auth: "user" },
    "signature.upload": { auth: "user", capability: "decision.final" },
    "reports.get": { auth: "user", capability: "reports.view" },
    "admin.backups.list": { auth: "user", capability: "backups.view" },
    "admin.backups.runNow": { auth: "user", capability: "backups.run" },
    "admin.audit.list": { auth: "user", capability: "audit.view" },
  };

  var MESSAGES = {
    INVALID_REQUEST: ["Something in the request was wrong. Please try again.", "கோரிக்கையில் பிழை உள்ளது. மீண்டும் முயற்சிக்கவும்."],
    UNKNOWN_ACTION: ["This action isn't available.", "இந்தச் செயல் கிடைக்கவில்லை."],
    NOT_SIGNED_IN: ["Please sign in.", "தயவுசெய்து உள்நுழையவும்."],
    SESSION_EXPIRED: ["You were signed out after a period of no use. Please sign in again.", "நீண்ட நேரம் பயன்படுத்தாததால் வெளியேற்றப்பட்டீர்கள். மீண்டும் உள்நுழையவும்."],
    NOT_ALLOWED: ["Your role can't do this.", "உங்கள் பணிப் பொறுப்பில் இதைச் செய்ய முடியாது."],
    INVALID_CREDENTIALS: ["Email or password is not correct. Try again, or ask your Admin.", "மின்னஞ்சல் அல்லது கடவுச்சொல் தவறு. மீண்டும் முயற்சிக்கவும் அல்லது நிர்வாகியிடம் கேளுங்கள்."],
    ACCOUNT_LOCKED: ["Too many wrong tries. Try again in 15 minutes, or ask your Admin.", "பல முறை தவறாக முயன்றீர்கள். 15 நிமிடங்கள் கழித்து முயற்சிக்கவும் அல்லது நிர்வாகியிடம் கேளுங்கள்."],
    VERSION_CONFLICT: ["Someone else updated this form. Tap to reload.", "வேறொருவர் இந்தப் படிவத்தைப் புதுப்பித்துள்ளார். மீண்டும் ஏற்றத் தட்டவும்."],
    BUSY: ["Busy, trying again…", "பரபரப்பாக உள்ளது, மீண்டும் முயல்கிறது…"],
    INVALID_TRANSITION: ["This application can't be moved that way now. Reload to see its latest status.", "இந்த விண்ணப்பத்தை இப்போது அப்படி நகர்த்த முடியாது. சமீபத்திய நிலையைப் பார்க்க மீண்டும் ஏற்றவும்."],
    COMMENT_REQUIRED: ["Please write a comment explaining why.", "காரணத்தை விளக்கி ஒரு கருத்தை எழுதவும்."],
    OWN_APPLICATION: ["You can't review an application you filled in.", "நீங்கள் நிரப்பிய விண்ணப்பத்தை நீங்களே பரிசீலிக்க முடியாது."],
    ALREADY_APPROVED_STAGE: ["You already approved an earlier step of this application. Another person must review this step.", "இந்த விண்ணப்பத்தின் முந்தைய படியில் நீங்கள் ஏற்கனவே ஒப்புதல் அளித்துள்ளீர்கள். இந்தப் படியை வேறொருவர் பரிசீலிக்க வேண்டும்."],
    VALIDATION_FAILED: ["Some answers need attention. They're marked in red.", "சில பதில்களைச் சரிபார்க்க வேண்டும். அவை சிவப்பில் குறிக்கப்பட்டுள்ளன."],
    FILE_TYPE_NOT_ALLOWED: ["Only photos (JPG, PNG) and PDF files can be added.", "புகைப்படங்கள் (JPG, PNG) மற்றும் PDF கோப்புகளை மட்டுமே சேர்க்க முடியும்."],
    FILE_TOO_LARGE: ["This file is larger than 5 MB. Please choose a smaller one.", "இந்தக் கோப்பு 5 MB-ஐ விடப் பெரியது. சிறிய கோப்பைத் தேர்ந்தெடுக்கவும்."],
    NOT_FOUND: ["We couldn't find that. It may have been removed.", "அதைக் கண்டுபிடிக்க முடியவில்லை. அது நீக்கப்பட்டிருக்கலாம்."],
    SERVER_ERROR: ["Something went wrong on our side. Please try again.", "எங்கள் பக்கத்தில் ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்."],
  };

  function freezeMap(source, mapEntry) {
    return Object.freeze(
      Object.keys(source).reduce(function (acc, key) {
        acc[key] = Object.freeze(mapEntry(source[key]));
        return acc;
      }, {})
    );
  }

  var ACTIONS = freezeMap(CONTRACT, function (entry) {
    return Object.assign({}, entry);
  });

  var ERRORS = freezeMap(MESSAGES, function (pair) {
    return { en: pair[0], ta: pair[1] };
  });

  function ok(data) {
    return { ok: true, data: data === undefined ? null : data, error: null };
  }

  function fail(code, details) {
    var known = Object.prototype.hasOwnProperty.call(ERRORS, code) ? code : "SERVER_ERROR";
    var message = ERRORS[known];
    return {
      ok: false,
      data: null,
      error: { code: known, message_en: message.en, message_ta: message.ta, details: details === undefined ? null : details },
    };
  }

  function describe(action) {
    return Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  }

  return Object.freeze({ ACTIONS: ACTIONS, ERRORS: ERRORS, ok: ok, fail: fail, describe: describe });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Actions;
}
```

- [ ] **Step 4: Run tests and coverage**

Run: `npm test && npm run coverage`
Expected: all tests PASS; coverage for `shared/*.js` ≥ 80% lines.

- [ ] **Step 5: Commit**

```bash
git add shared/actions.js tests/shared/actions.test.js
git commit -m "feat: add shared API contract and bilingual error messages"
```

---

## Self-review (done while writing)

- **Spec coverage:** §4 roles → Task 3; §5 workflow incl. send back, reject, waitlist, withdraw, reopen and separation of duties → Task 4; §9 envelope + POC §5 actions → Task 5; F13 numbers → Task 2; scope map §1 rules → Task 1. The form schema, validation and report maths are **M2**, not this plan.
- **Placeholders:** none. Every code step has full code.
- **Type consistency:** error codes returned by `SC_Workflow.next` are all present in `SC_Actions.ERRORS` (tested in Task 5); capabilities used in `ACTIONS` are checked against `SC_Permissions.CAPABILITIES` (tested).
- **Open assumption carried from the flow page:** `ADMITTED → REOPEN → RETURNED` (reopened applications go through all approvals again). This is flagged "to confirm" in `TODO.md`.
