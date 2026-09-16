# M7a — Parent's Consent Signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent sign the consent step on screen, store that signature in Drive, and refuse to submit an application whose signature is missing or no longer matches what was consented to.

**Architecture:** `shared/consent.js` defines the five consented fields and their normalized serialization; it never hashes, because `scripts/check-scope.mjs` forbids platform APIs in `shared/` and hashing needs `SC_Crypto` on Apps Script and `crypto.subtle` in the browser. `Attachments.gs` stores the PNG in Drive with that payload's hash on its row. `applications.get` compares the stored hash against the answers now and ships `consentSigned`/`consentStale`, so the browser renders an answer it never computes — the same correction M6's final review applied to `review.js`.

**Tech Stack:** No dependencies. Node's built-in test runner (`node --test`), Apps Script (`.gs`) run under the fake-services harness in `tests/poc/`, ES modules in `public/js/`, IIFE + `module.exports` tail in `shared/`.

**Spec:** `docs/superpowers/specs/2026-09-16-m7a-consent-signature-design.md`

## Global Constraints

- **Scope headers are mandatory.** Every source file starts with `// scope: shared`, `// scope: poc` or `// scope: prod`. `scripts/check-scope.mjs` runs as part of `npm test` and fails the build otherwise. `expectedScope()` maps `poc/**` → `poc`, everything else in this plan → `shared`.
- **`shared/` may not touch platform APIs.** Banned substrings include `document.`, `window.`, `localStorage`, `fetch(`, `DriveApp`, `SpreadsheetApp`, `LockService`, `Utilities`. This is enforced, not advisory.
- **`shared/` files are IIFEs**, not ES modules: `var SC_Name = (function () { "use strict"; … })();` with `if (typeof module !== "undefined" && module.exports) { module.exports = SC_Name; }` as the last lines. `public/js/` files are ES modules with `export`.
- **Every user-visible string is a key in both `public/i18n/en.json` and `public/i18n/ta.json`.** `tests/public/i18n.test.mjs` asserts exact key parity and matching `{placeholders}`. Adding a key to one file only fails the suite.
- **Tamil default.** `prefs.js` defaults to `ta`; every screen must be checked in both languages.
- **Allowed upload types (main spec §10.3):** JPEG, PNG, PDF — checked by magic bytes, never by filename or a client-supplied MIME type.
- **Errors reuse `shared/actions.js`.** `FILE_TYPE_NOT_ALLOWED` (line 54) and `FILE_TOO_LARGE` (line 55) already exist and are currently unused. Do not add error codes in this plan; new ones need new Tamil and a staff review.
- **The test suite must be green at every commit.** `npm test` runs the scope check then `node --test`. Baseline entering this plan: **293 passing, 0 failing.**
- **One task, one commit.** Conventional commit subjects (`feat:`, `fix:`, `test:`, `docs:`), body explaining *why*, and the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `shared/consent.js` — what was consented to

**Files:**
- Create: `shared/consent.js`
- Create: `tests/shared/consent.test.js`
- Modify: `poc/scripts/source-order.mjs:8` (add `"consent"` to `SHARED_ORDER`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SC_Consent.FIELDS` → frozen array of 5 field-id strings, fixed order
  - `SC_Consent.payload(values)` → `string` (JSON of the non-empty consented fields, keys in `FIELDS` order)

**Why these five and not the whole form:** the consent statement (`shared/form-schema.js:179`) is a permission to *keep* data under the DPDP Act, not an attestation that the answers are accurate. Correcting a medicine does not withdraw a permission to store data. See spec §2.

**`s11_signature` is deliberately absent from the list.** Its value is the attachment id (`form-rules.js:112` validates `signature` as a non-empty string). Including it would make the hash depend on the act of signing, so no signature could ever match its own payload.

- [x] **Step 1: Write the failing test**

Create `tests/shared/consent.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SC_Consent = require("../../shared/consent.js");

const signed = {
  s2_full_name: "Kavya Selvam",
  s2_dob: "2025-11-16",
  s11_consent: true,
  s11_parent_name: "Selvam R",
  s11_relationship: "FATHER",
  s4_current_medicines: "None",
  s11_signature: "att-1",
};

test("the consent covers five fields, in a fixed order", () => {
  assert.deepEqual(SC_Consent.FIELDS, [
    "s11_consent", "s11_parent_name", "s11_relationship", "s2_full_name", "s2_dob",
  ]);
  assert.ok(Object.isFrozen(SC_Consent.FIELDS));
});

test("a change to any consented fact changes the payload", () => {
  const before = SC_Consent.payload(signed);
  for (const field of SC_Consent.FIELDS) {
    const after = SC_Consent.payload({ ...signed, [field]: "something else" });
    assert.notEqual(after, before, field);
  }
});

test("a change to anything else leaves the payload alone", () => {
  const before = SC_Consent.payload(signed);
  // A medicine corrected, a safety note added, and the signature itself replaced:
  // none of these is something the parent agreed to, so none may stale their signature.
  assert.equal(SC_Consent.payload({ ...signed, s4_current_medicines: "Risperidone" }), before);
  assert.equal(SC_Consent.payload({ ...signed, s5_notes: "added later" }), before);
  assert.equal(SC_Consent.payload({ ...signed, s11_signature: "att-2" }), before);
});

test("an answer cleared and an answer never given are the same thing", () => {
  // Otherwise clearing a field and never filling it would fingerprint differently, and a
  // signature would go stale over a distinction the parent cannot see.
  const { s11_parent_name, ...noParent } = signed;
  assert.equal(SC_Consent.payload({ ...signed, s11_parent_name: "" }), SC_Consent.payload(noParent));

  const { s11_consent, ...noConsent } = signed;
  assert.equal(SC_Consent.payload({ ...signed, s11_consent: false }), SC_Consent.payload(noConsent));
});

test("key order does not depend on the caller's object", () => {
  const reversed = {
    s2_dob: signed.s2_dob, s2_full_name: signed.s2_full_name,
    s11_relationship: signed.s11_relationship, s11_parent_name: signed.s11_parent_name,
    s11_consent: signed.s11_consent,
  };
  assert.equal(SC_Consent.payload(reversed), SC_Consent.payload(signed));
});
```

- [x] **Step 2: Run the test and watch it fail**

Run: `node --test tests/shared/consent.test.js`
Expected: FAIL — `Cannot find module '../../shared/consent.js'`.

- [x] **Step 3: Write the minimal implementation**

Create `shared/consent.js`:

```javascript
// scope: shared
/* What the parent's signature covers (main spec §6 step 11, DPDP Act 2023).
   The consent statement is a permission to KEEP the applicant's data, not a claim that the
   clinical answers are right — so correcting a medicine must not stale a signature, while
   changing who the data is about, who gave the permission, or what they agreed to must.
   Pure, and it deliberately does not hash: check-scope.mjs keeps platform APIs out of shared/,
   and hashing needs SC_Crypto on Apps Script and crypto.subtle in the browser. Both sides hash
   this one payload, so a fingerprint taken on either side means the same thing. */
var SC_Consent = (function () {
  "use strict";

  var FIELDS = Object.freeze([
    "s11_consent",       // the statement agreed to
    "s11_parent_name",   // who gave the permission
    "s11_relationship",  // the authority they gave it under
    "s2_full_name",      // who the data is about
    "s2_dob",            // identity, and the basis for parental consent at all
  ]);

  // Empty and missing are the same, as SC_Applications.formValues already treats them, so a
  // field cleared and a field never filled cannot produce two different fingerprints.
  function payload(values) {
    var source = values || {};
    var out = {};
    FIELDS.forEach(function (id) {
      var value = source[id];
      var empty = value === null || value === undefined || value === "" || value === false;
      if (!empty) out[id] = value;
    });
    return JSON.stringify(out);
  }

  return Object.freeze({ FIELDS: FIELDS, payload: payload });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SC_Consent;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `node --test tests/shared/consent.test.js`
Expected: PASS, 5 tests.

- [x] **Step 5: Load it into the POC server**

`shared/consent.js` must be in the bundle or `Attachments.gs` cannot call it. In `poc/scripts/source-order.mjs`, change line 8 from:

```javascript
  "dates", "numbers", "permissions", "workflow", "actions", "form-schema", "form-rules",
```

to:

```javascript
  "dates", "numbers", "permissions", "workflow", "actions", "consent", "form-schema", "form-rules",
```

(`consent` has no dependencies, so it may sit anywhere; placing it before the form modules keeps the answer-shaped files together.)

- [x] **Step 6: Run the whole suite**

Run: `npm test`
Expected: 298 passing, 0 failing. The scope check must pass — if it reports `shared/consent.js`, the header or a banned API is wrong.

- [x] **Step 7: Commit**

```bash
git add shared/consent.js tests/shared/consent.test.js poc/scripts/source-order.mjs
git commit -F - <<'MSG'
feat: say which five facts a parent's signature covers

The consent statement is a permission to keep the applicant's data, not a
claim that the clinical answers are right. So correcting a medicine must not
stale a signature, while changing who the data is about, who gave the
permission, or what they agreed to must.

Five fields carry it: the statement, the parent's name, their relationship,
the applicant's name and their date of birth. s11_signature is not among them
— its value is the attachment id, so including it would make the fingerprint
depend on the act of signing and no signature could match its own payload.

consent.js serializes and does not hash. check-scope.mjs keeps platform APIs
out of shared/, and hashing needs SC_Crypto on Apps Script and crypto.subtle
in the browser. One payload, two hashers, is also what the M6 plan's [PROD]
carry-forward 3 asks for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: A fake `DriveApp` for the test harness

**Files:**
- Modify: `tests/poc/fakes.js` (add `makeDriveApp`, export it)
- Modify: `tests/poc/harness.js` (install `DriveApp` into the sandbox globals)
- Test: `tests/poc/fakes.test.js` — extend if it exists, otherwise assert through Task 3

**Interfaces:**
- Consumes: nothing.
- Produces: a `DriveApp` global inside the harness with the subset `Attachments.gs` uses:
  - `DriveApp.getRootFolder()` → folder
  - `folder.getFoldersByName(name)` → `{ hasNext(), next() }`
  - `folder.createFolder(name)` → folder
  - `folder.createFile(blob)` → `{ getId(), getName(), getSize(), getBlob() }`
  - `DriveApp.getFileById(id)` → file, or throws when unknown
  - `Utilities.newBlob(bytes, mime, name)` → blob

**Why this task is separate:** `tests/poc/fakes.js:14-23` fakes `Utilities` but there is no `DriveApp` at all, so Task 3 cannot run a single test without it. Splitting it means a reviewer can reject the fake's shape without rejecting the upload logic built on it.

- [x] **Step 1: Read the existing fakes to match their style**

Run: `sed -n '1,40p' tests/poc/fakes.js` and `grep -n "makeUtilities\|globals\|sandbox" tests/poc/harness.js`

The fakes are plain closures returning frozen objects, and `harness.js` installs them as globals before evaluating the `.gs` sources. Follow that exactly; do not introduce a mocking library.

- [x] **Step 2: Write the failing test**

Add to `tests/poc/fakes.test.js` (create it if absent, with the same imports the other `tests/poc/*.test.js` files use):

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDriveApp, makeUtilities } from "./fakes.js";

test("a fake Drive stores a file in a folder and hands it back by id", () => {
  const Drive = makeDriveApp();
  const Utilities = makeUtilities();
  const root = Drive.getRootFolder();
  const folder = root.createFolder("attachments");
  const blob = Utilities.newBlob([137, 80, 78, 71], "image/png", "sig.png");

  const file = folder.createFile(blob);
  assert.equal(file.getName(), "sig.png");
  assert.equal(file.getSize(), 4);
  assert.deepEqual(Drive.getFileById(file.getId()).getBlob().getBytes(), [137, 80, 78, 71]);
});

test("a folder is found again rather than made twice", () => {
  const Drive = makeDriveApp();
  const root = Drive.getRootFolder();
  const first = root.createFolder("attachments");
  const found = root.getFoldersByName("attachments");
  assert.equal(found.hasNext(), true);
  assert.equal(found.next().getId(), first.getId());
  assert.equal(root.getFoldersByName("nothing").hasNext(), false);
});

test("an unknown file id is an error, not a silent null", () => {
  const Drive = makeDriveApp();
  assert.throws(() => Drive.getFileById("no-such-file"), /no-such-file/);
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `node --test tests/poc/fakes.test.js`
Expected: FAIL — `makeDriveApp` is not exported.

- [x] **Step 4: Implement the fake**

In `tests/poc/fakes.js`, add before the export block, and extend `makeUtilities` with `newBlob`:

```javascript
// The slice of DriveApp that Attachments.gs uses. Files live in memory and are handed back by
// id, so a test can assert what was really written rather than that a method was called.
export function makeDriveApp() {
  const files = new Map();
  const folders = new Map();
  let seq = 0;

  function makeFolder(id, name) {
    const folder = {
      getId: () => id,
      getName: () => name,
      createFolder(childName) {
        const child = makeFolder(`folder-${++seq}`, childName);
        folders.set(`${id}/${childName}`, child);
        return child;
      },
      getFoldersByName(childName) {
        const found = folders.get(`${id}/${childName}`);
        let taken = false;
        return {
          hasNext: () => Boolean(found) && !taken,
          next() {
            if (!found || taken) throw new Error(`no folder named ${childName}`);
            taken = true;
            return found;
          },
        };
      },
      createFile(blob) {
        const fileId = `file-${++seq}`;
        const file = {
          getId: () => fileId,
          getName: () => blob.getName(),
          getSize: () => blob.getBytes().length,
          getBlob: () => blob,
          setTrashed: () => file,
        };
        files.set(fileId, file);
        return file;
      },
    };
    return folder;
  }

  const root = makeFolder("root", "root");
  return Object.freeze({
    getRootFolder: () => root,
    getFileById(id) {
      const file = files.get(id);
      if (!file) throw new Error(`no file with id ${id}`);
      return file;
    },
  });
}
```

In `makeUtilities`, add to the returned object:

```javascript
    newBlob: (bytes, mime, name) => Object.freeze({
      getBytes: () => bytes.slice(),
      getContentType: () => mime,
      getName: () => name,
    }),
```

Add `makeDriveApp` to the module's export list at the bottom of `fakes.js`, alongside `makeUtilities`.

- [x] **Step 5: Install it in the harness**

In `tests/poc/harness.js`, find where `Utilities` is put into the sandbox globals and add `DriveApp` the same way, importing `makeDriveApp` at the top. Each harness instance must get its own `makeDriveApp()` so tests cannot leak files into one another.

- [x] **Step 6: Run the suite**

Run: `npm test`
Expected: 301 passing, 0 failing.

- [x] **Step 7: Commit**

```bash
git add tests/poc/fakes.js tests/poc/harness.js tests/poc/fakes.test.js
git commit -F - <<'MSG'
test: fake the slice of Drive that attachments need

fakes.js fakes Utilities but had no DriveApp at all, so nothing that writes a
file could be tested. The fake keeps files in memory and hands them back by
id, so a test can assert what was actually written rather than that a method
was called. Each harness gets its own, so files cannot leak between tests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: `Attachments.gs` — upload, with the type read from the bytes

**Files:**
- Create: `poc/apps-script/Attachments.gs`
- Create: `tests/poc/attachments.test.js`

**Interfaces:**
- Consumes: `SC_Consent.payload` (Task 1); `DriveApp` fake (Task 2); existing `SC_Store.insert/find/all/newId/nowIso`, `SC_Crypto.sha256Hex`, `SC_Actions.ok/fail`, `SC_Api.register`, `SC_Permissions`.
- Produces:
  - action `attachments.upload`, data `{ applicationId, kind, filename, base64 }` → `ok({ id, kind, filename, mime, size })`
  - `SC_Attachments.sniff(bytes)` → `"image/png" | "image/jpeg" | "application/pdf" | null`
  - `SC_Attachments.liveFor(applicationId, kind)` → the newest non-deleted row, or `null`

**Store columns** already exist (`poc/apps-script/Store.gs:19-20`): `id, application_id, kind, drive_file_id, filename, mime, size:number, uploaded_by, created_at, deleted_at`. This task **adds `consent_hash`** to that list, per spec §4.

**M7a restricts `kind` to `CONSENT_SIGNATURE`.** M7b opens it to `PHOTO`, `DIAGNOSIS`, `UDID`.

- [x] **Step 1: Add the column**

In `poc/apps-script/Store.gs`, change the `Attachments` entry to:

```javascript
    Attachments: ["id", "application_id", "kind", "drive_file_id", "filename", "mime", "size:number",
      "uploaded_by", "created_at", "deleted_at", "consent_hash", "consent_payload"],
```

**Two columns, not one.** `consent_hash` is the cheap equality check that runs on every `applications.get`, and it is the column the Phase 1 port must reproduce byte-for-byte. `consent_payload` is the serialized text it was made from, kept so Task 5 can say *which* fact changed by comparing values directly instead of searching for a hash that matches. A hash can only answer "same or different"; naming the field that moved needs the values themselves.

- [x] **Step 2: Write the failing test**

Create `tests/poc/attachments.test.js`, following the shape of `tests/poc/applications.test.js` (same harness import, same `as(name)` helper from `tests/poc/people.js`):

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { newHarness } from "./harness.js";
import { as, seedPeople } from "./people.js";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const HTML = [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]; // "<html>"

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

test("a signature is stored, typed from its bytes, and fingerprinted", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: { s2_full_name: "Kavya Selvam" } });
  const result = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(PNG),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.mime, "image/png");
  assert.equal(result.data.size, PNG.length);

  const row = h.store.find("Attachments", "id", result.data.id);
  assert.equal(row.application_id, draft.data.id);
  assert.equal(row.kind, "CONSENT_SIGNATURE");
  assert.equal(row.deleted_at, null);
  assert.ok(row.drive_file_id, "the file must actually be in Drive");
  assert.ok(row.consent_hash, "a signature carries the fingerprint of what was consented to");
});

test("a file is refused for what it is, not what it is called", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: {} });
  // Renaming an HTML file to .png must not get it into a private Drive folder.
  const result = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(HTML),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FILE_TYPE_NOT_ALLOWED");
  assert.equal(h.store.all("Attachments").length, 0, "nothing may be written when the type is refused");
});

test("sniff reads the three allowed types and refuses the rest", () => {
  const h = newHarness();
  assert.equal(h.global.SC_Attachments.sniff(PNG), "image/png");
  assert.equal(h.global.SC_Attachments.sniff(JPEG), "image/jpeg");
  assert.equal(h.global.SC_Attachments.sniff(PDF), "application/pdf");
  assert.equal(h.global.SC_Attachments.sniff(HTML), null);
  assert.equal(h.global.SC_Attachments.sniff([]), null);
});

test("a file over 5 MB is refused", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: {} });
  const big = PNG.concat(new Array(5 * 1024 * 1024).fill(0));
  const result = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(big),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FILE_TOO_LARGE");
});

test("only someone who may see the application may attach to it", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: {} });
  // Deepa is another therapist: she may not even know the file exists.
  const result = as(h, "deepa")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(PNG),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("M7a stores signatures only", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: {} });
  const result = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "PHOTO", filename: "face.png", base64: b64(PNG),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_REQUEST");
});
```

Check the exact helper names in `tests/poc/people.js` and `tests/poc/harness.js` first and match them; the names above follow `tests/poc/applications.test.js`. If the harness exposes globals under a different property than `h.global`, use that.

- [x] **Step 3: Run it and watch it fail**

Run: `node --test tests/poc/attachments.test.js`
Expected: FAIL — `attachments.upload` is an unknown action (`UNKNOWN_ACTION`).

- [x] **Step 4: Implement**

Create `poc/apps-script/Attachments.gs`:

```javascript
// scope: poc
/* Photos, PDFs and signatures in Drive (POC spec §9, main spec §10.3).
   M7a stores the parent's consent signature only; M7b opens this to photos, diagnosis reports
   and the UDID certificate. The file's type is read from its first bytes and never from its name
   or a content type the caller supplies — a private Drive folder is on the other side of this
   check, and a caller who wants to get something past it will happily rename it. */
var SC_Attachments = (function () {
  "use strict";

  var ok = SC_Actions.ok;
  var fail = SC_Actions.fail;

  var MAX_BYTES = 5 * 1024 * 1024;      // main spec §10.3
  var ROOT_FOLDER = "SwabodhiniCare POC";
  var M7A_KINDS = ["CONSENT_SIGNATURE"]; // widened in M7b

  var MAGIC = [
    { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  ];

  // Apps Script's base64Decode returns signed bytes; compare unsigned so 0x89 is not -119.
  function sniff(bytes) {
    for (var i = 0; i < MAGIC.length; i++) {
      var want = MAGIC[i].bytes;
      if (bytes.length < want.length) continue;
      var same = true;
      for (var j = 0; j < want.length; j++) {
        if ((bytes[j] & 0xff) !== want[j]) { same = false; break; }
      }
      if (same) return MAGIC[i].mime;
    }
    return null;
  }

  function folderNamed(parent, name) {
    var found = parent.getFoldersByName(name);
    return found.hasNext() ? found.next() : parent.createFolder(name);
  }

  function folderFor(appNo) {
    var root = folderNamed(DriveApp.getRootFolder(), ROOT_FOLDER);
    return folderNamed(folderNamed(root, "attachments"), appNo);
  }

  // The newest attachment of a kind that has not been deleted.
  function liveFor(applicationId, kind) {
    var rows = SC_Store.all("Attachments").filter(function (row) {
      return row.application_id === applicationId && row.kind === kind && !row.deleted_at;
    });
    rows.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });
    return rows.length > 0 ? rows[0] : null;
  }

  function upload(data, session) {
    if (M7A_KINDS.indexOf(data.kind) === -1) return fail("INVALID_REQUEST");
    if (typeof data.base64 !== "string" || !data.base64) return fail("INVALID_REQUEST");

    var app = SC_Applications.loadVisible(data.applicationId, session);
    if (app.error) return app.error;

    var bytes = Utilities.base64Decode(data.base64);
    if (bytes.length > MAX_BYTES) return fail("FILE_TOO_LARGE");
    var mime = sniff(bytes);
    if (!mime) return fail("FILE_TYPE_NOT_ALLOWED");

    var name = typeof data.filename === "string" && data.filename ? data.filename : "file";
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = folderFor(app.row.app_no).createFile(blob);

    // A signature is a signature ON something: record what was agreed to at the moment it was
    // given. Only CONSENT_SIGNATURE carries this; M7b's photos are not consented facts.
    var consentPayload = data.kind === "CONSENT_SIGNATURE"
      ? SC_Consent.payload(SC_Applications.valuesOf(app.row))
      : null;

    var row = {
      id: SC_Store.newId(),
      application_id: app.row.id,
      kind: data.kind,
      drive_file_id: file.getId(),
      filename: name,
      mime: mime,
      size: bytes.length,
      uploaded_by: session.user.id,
      created_at: SC_Store.nowIso(),
      deleted_at: null,
      consent_hash: consentPayload ? SC_Crypto.sha256Hex(consentPayload) : null,
      consent_payload: consentPayload,
    };
    SC_Store.insert("Attachments", row);
    return ok({ id: row.id, kind: row.kind, filename: row.filename, mime: row.mime, size: row.size });
  }

  return Object.freeze({ upload: upload, sniff: sniff, liveFor: liveFor });
})();

SC_Api.register("attachments.upload", SC_Attachments.upload);
```

- [x] **Step 5: Export the two helpers `Attachments.gs` needs from `Applications.gs`**

`loadVisible` and a values reader are currently private inside the `SC_Applications` IIFE (`poc/apps-script/Applications.gs:78-87` and `:35-45`). Add them to the frozen export at `Applications.gs:394-397`, which becomes:

```javascript
  return Object.freeze({
    create: create, get: get, save: save, submit: submit, withdraw: withdraw, review: review,
    decide: decide, reopen: reopen, list: list, formHash: formHash,
    loadVisible: loadVisible, valuesOf: formValues,
  });
```

`valuesOf` is exported under a name of its own because `formValues` reads as a private detail; a second file calling it should say what it wants, not how the first file spells it. The M6 close-out already noted this export line is long — break it across lines as above rather than extending one 133-character line.

Files load alphabetically (`poc/scripts/source-order.mjs:14`), so `Applications.gs` is evaluated before `Attachments.gs`. No ordering change is needed.

- [x] **Step 6: Run the tests and watch them pass**

Run: `node --test tests/poc/attachments.test.js`
Expected: PASS, 6 tests.

Then: `npm test` → 307 passing, 0 failing.

- [x] **Step 7: Commit**

```bash
git add poc/apps-script/Attachments.gs poc/apps-script/Applications.gs poc/apps-script/Store.gs tests/poc/attachments.test.js
git commit -F - <<'MSG'
feat: store a parent's signature in Drive, typed from its bytes

attachments.upload takes base64, reads the type from the first bytes, and
writes the file to SwabodhiniCare POC/attachments/<app_no>/ with a row in the
Attachments tab. The type is never taken from the filename or from a content
type the caller supplies: a private Drive folder is on the other side of the
check, and anyone trying to get something past it will rename the file.

The row carries consent_hash, the fingerprint of the five facts the parent
agreed to. Nothing reads it yet; the next task does.

M7a accepts CONSENT_SIGNATURE only. Photos, diagnosis reports and the UDID
certificate are M7b.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: `attachments.get`, and re-signing without destroying the old mark

**Files:**
- Modify: `poc/apps-script/Attachments.gs`
- Modify: `tests/poc/attachments.test.js`

**Interfaces:**
- Consumes: Task 3's `upload`, `liveFor`.
- Produces: action `attachments.get`, data `{ id }` → `ok({ id, kind, filename, mime, size, base64 })`.

**Re-signing soft-deletes.** POC spec §9 requires soft delete; spec §5.1 says the re-sign path is not an exception. Keeping the superseded signature is what lets anyone answer later *what* was consented to and *when* — the entire purpose of holding a consent record.

- [x] **Step 1: Write the failing tests**

Append to `tests/poc/attachments.test.js`:

```javascript
test("a signature can be read back by someone who may see the application", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: {} });
  const up = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(PNG),
  });
  const got = as(h, "priya")("attachments.get", { id: up.data.id });
  assert.equal(got.ok, true);
  assert.equal(got.data.mime, "image/png");
  assert.deepEqual([...Buffer.from(got.data.base64, "base64")], PNG);
});

test("someone who may not see the application is not told the file exists", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: {} });
  const up = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(PNG),
  });
  const got = as(h, "deepa")("attachments.get", { id: up.data.id });
  assert.equal(got.ok, false);
  assert.equal(got.error.code, "NOT_FOUND");
});

test("signing again keeps the mark it replaced", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: { s11_parent_name: "Selvam R" } });
  const first = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(PNG),
  });
  const second = as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: b64(JPEG),
  });

  const rows = h.store.all("Attachments");
  assert.equal(rows.length, 2, "the old signature is kept, not overwritten");
  const old = rows.find((r) => r.id === first.data.id);
  assert.ok(old.deleted_at, "the replaced signature is marked deleted");
  assert.equal(rows.find((r) => r.id === second.data.id).deleted_at, null);
  // And it is still readable, because what was consented to must stay answerable.
  assert.equal(as(h, "priya")("attachments.get", { id: first.data.id }).ok, true);
});
```

- [x] **Step 2: Run and watch them fail**

Run: `node --test tests/poc/attachments.test.js`
Expected: FAIL — `attachments.get` is unknown, and the re-sign test finds 2 live rows instead of one deleted and one live.

- [x] **Step 3: Implement**

In `Attachments.gs`, inside `upload`, immediately **before** `SC_Store.insert`, add:

```javascript
    // Signing again supersedes the previous mark rather than erasing it (POC spec §9, M7a spec §5.1):
    // what was consented to, and when, has to stay answerable.
    var previous = liveFor(app.row.id, data.kind);
    if (previous) SC_Store.update("Attachments", previous.id, { deleted_at: SC_Store.nowIso() });
```

Add the `get` handler after `upload`:

```javascript
  function get(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    var row = SC_Store.find("Attachments", "id", data.id);
    if (!row) return fail("NOT_FOUND");
    // The permission lives on the application, so ask about that rather than about the file.
    var app = SC_Applications.loadVisible(row.application_id, session);
    if (app.error) return app.error;

    var blob = DriveApp.getFileById(row.drive_file_id).getBlob();
    return ok({
      id: row.id, kind: row.kind, filename: row.filename, mime: row.mime, size: row.size,
      base64: Utilities.base64Encode(blob.getBytes()),
    });
  }
```

Add `get: get` to the frozen export and register it:

```javascript
SC_Api.register("attachments.get", SC_Attachments.get);
```

- [x] **Step 4: Run and watch them pass**

Run: `node --test tests/poc/attachments.test.js`
Expected: PASS, 9 tests. Then `npm test` → 310 passing.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Attachments.gs tests/poc/attachments.test.js
git commit -F - <<'MSG'
feat: read a signature back, and keep the one it replaced

attachments.get asks the application for permission rather than the file,
so a therapist who may not see the file is told it does not exist instead of
being told it is not theirs. Drive ids never leave the server.

Signing again soft-deletes the previous mark instead of overwriting it. POC
spec §9 requires soft delete for attachments, and the re-sign path is not an
exception: what was consented to, and when, is the whole reason to hold a
consent record, and it stays readable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: The server decides whether a signature still stands

**Files:**
- Modify: `poc/apps-script/Applications.gs` (`view`, `submit`)
- Modify: `tests/poc/applications.test.js`

**Interfaces:**
- Consumes: `SC_Attachments.liveFor` (Task 3), `SC_Consent.payload` (Task 1).
- Produces: `applications.get` returns, in addition to today's fields:
  - `consentSigned: boolean`
  - `consentStale: boolean`
  - `consentChanged: string[]` — which of the five facts moved, empty unless stale

**Why the server and not the browser.** M6's final review found `review.js` recomputing the separation-of-duties rule in the browser and replaced it with `approvedThisRound` from `applications.get`. A rule with two implementations has two behaviours the moment one drifts. Staleness is the same shape of rule and gets the same treatment. It also avoids `crypto.subtle` being async on the render path.

- [x] **Step 1: Write the failing tests**

Append to `tests/poc/applications.test.js`:

```javascript
test("a signature stands until a consented fact changes", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", {
    values: { s2_full_name: "Kavya Selvam", s11_parent_name: "Selvam R" },
  });
  const sign = () => as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
  });
  const read = () => as(h, "priya")("applications.get", { id: draft.data.id }).data;

  assert.equal(read().consentSigned, false);
  sign();
  assert.equal(read().consentSigned, true);
  assert.equal(read().consentStale, false);

  // A medicine is not something the parent agreed to.
  let v = read().version;
  as(h, "priya")("applications.save", { id: draft.data.id, version: v, values: { s4_current_medicines: "None" } });
  assert.equal(read().consentStale, false, "an unconsented field must not stale the signature");

  // The applicant's name is.
  v = read().version;
  as(h, "priya")("applications.save", { id: draft.data.id, version: v, values: { s2_full_name: "Kavya S" } });
  const after = read();
  assert.equal(after.consentStale, true);
  assert.deepEqual(after.consentChanged, ["s2_full_name"]);

  // Signing again settles it.
  sign();
  assert.equal(read().consentStale, false);
  assert.deepEqual(read().consentChanged, []);
});

test("an application cannot be submitted without a signature that still stands", () => {
  const h = newHarness();
  seedPeople(h);
  const draft = as(h, "priya")("applications.create", { values: submitReadyValues() });
  const refused = as(h, "priya")("applications.submit", { id: draft.data.id });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "VALIDATION_FAILED");

  as(h, "priya")("attachments.upload", {
    applicationId: draft.data.id, kind: "CONSENT_SIGNATURE",
    filename: "signature.png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
  });
  assert.equal(as(h, "priya")("applications.submit", { id: draft.data.id }).ok, true);
});
```

`submitReadyValues()` already exists in this file or in `tests/fixtures/sample-application.js` — check which and reuse it rather than writing a new fixture. The `s11_signature` value it carries must be set to the uploaded attachment id, or removed so the upload supplies it; read how the fixture is built before deciding.

- [x] **Step 2: Run and watch them fail**

Run: `node --test tests/poc/applications.test.js`
Expected: FAIL — `consentSigned` is `undefined`.

- [x] **Step 3: Implement**

In `Applications.gs`, add above `view`:

```javascript
  // Whether the parent's signature still covers what they agreed to (M7a spec §5). The server
  // answers this so the browser never holds a second copy of the rule — the same correction M6
  // made when review.js was recomputing the round rule from the routing slip.
  function consentState(row) {
    var signature = SC_Attachments.liveFor(row.id, "CONSENT_SIGNATURE");
    if (!signature) return { signed: false, stale: false, changed: [] };

    var values = formValues(row);
    if (SC_Crypto.sha256Hex(SC_Consent.payload(values)) === signature.consent_hash) {
      return { signed: true, stale: false, changed: [] };
    }

    // Stale. Now name the facts that moved: "please sign again" with no reason is the defect
    // M6 closed in the rejection banner — a surface that knows why and will not say. The hash
    // can only answer same-or-different, so the comparison is against the payload it was made
    // from. Missing and empty were already folded together by SC_Consent.payload, so a field
    // absent from either side reads as null on both.
    var then = JSON.parse(signature.consent_payload || "{}");
    var changed = SC_Consent.FIELDS.filter(function (id) {
      var before = then[id] === undefined ? null : then[id];
      var after = values[id] === undefined || values[id] === "" || values[id] === false ? null : values[id];
      return JSON.stringify(before) !== JSON.stringify(after);
    });
    return { signed: true, stale: true, changed: changed };
  }
```

In `view(row)`, add to the returned object — calling `consentState` **once** into a local, because each call scans the `Attachments` tab and `get` is on the hot path:

```javascript
  function view(row) {
    var values = formValues(row);
    var consent = consentState(row);
    return {
      // … every field view() already returns, unchanged …
      consentSigned: consent.signed,
      consentStale: consent.stale,
      consentChanged: consent.changed,
    };
  }
```

In `submit`, before the transition check, add:

```javascript
    var consent = consentState(row);
    if (!consent.signed || consent.stale) {
      return fail("VALIDATION_FAILED", { errors: [{ field: "s11_signature", code: "REQUIRED" }] });
    }
```

Match the exact error-detail shape `checkValues` already produces (`Applications.gs:71-74`) — read it and copy it, so one screen can render both refusals.

- [x] **Step 4: Run and watch them pass**

Run: `node --test tests/poc/applications.test.js`
Expected: PASS. Then `npm test` → 312 passing.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Applications.gs poc/apps-script/Attachments.gs poc/apps-script/Store.gs tests/poc/applications.test.js
git commit -F - <<'MSG'
feat: let the server say whether a signature still stands

applications.get now ships consentSigned, consentStale and consentChanged
beside approvedThisRound, and submit refuses a file whose signature is missing
or stale. The browser is told the answer rather than working it out: M6's
final review deleted review.js's own copy of the round rule for exactly this
reason, and a second copy of this rule would drift the same way.

consentChanged names which of the five facts moved. "Please sign again" with
no reason is the defect closed in the rejection banner last week — a surface
that knows why and will not say. The row keeps the payload it hashed so the
comparison is a read, not a search.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: `signature-pad.js` — the geometry, tested apart from the canvas

**Files:**
- Create: `public/js/signature-pad.js`
- Create: `tests/public/signature-pad.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all pure, all exported):
  - `isBlank(strokes)` → `boolean`
  - `boundsOf(strokes)` → `{ minX, minY, maxX, maxY } | null`
  - `trimToInk(strokes, padding)` → strokes translated so the ink starts at `padding`
  - `fitTo(strokes, box)` → strokes scaled to fit `{ width, height }`, aspect ratio kept

A stroke is `[{x, y}, …]`; strokes are `[stroke, …]`.

**Why pure:** `tests/public/` covers only pure modules — every `pages/*.js` is untested. That is exactly how the version-conflict wording bug survived in `pages/application.js`. The DOM wrapper is Task 7 and stays thin enough to check by eye.

- [x] **Step 1: Write the failing test**

Create `tests/public/signature-pad.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlank, boundsOf, trimToInk, fitTo } from "../../public/js/signature-pad.js";

const line = [[{ x: 10, y: 10 }, { x: 30, y: 20 }, { x: 50, y: 10 }]];

test("a stray tap is not a signature", () => {
  assert.equal(isBlank([]), true);
  assert.equal(isBlank([[]]), true);
  assert.equal(isBlank([[{ x: 5, y: 5 }]]), true, "one point is a tap, not a mark");
  assert.equal(isBlank([[{ x: 5, y: 5 }, { x: 5.4, y: 5.2 }]]), true, "a jitter is not a mark");
  assert.equal(isBlank(line), false);
});

test("bounds cover every stroke, and are null when there is no ink", () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf(line), { minX: 10, minY: 10, maxX: 50, maxY: 20 });
  assert.deepEqual(
    boundsOf([[{ x: 0, y: 8 }], [{ x: 4, y: 2 }]]),
    { minX: 0, minY: 2, maxX: 4, maxY: 8 },
  );
});

test("trimming moves the ink to the corner, keeping its shape", () => {
  const trimmed = trimToInk(line, 2);
  assert.deepEqual(boundsOf(trimmed), { minX: 2, minY: 2, maxX: 42, maxY: 12 });
  assert.equal(trimmed.length, line.length);
  assert.equal(trimmed[0].length, line[0].length);
});

test("trimming empty ink gives empty ink rather than throwing", () => {
  assert.deepEqual(trimToInk([], 2), []);
});

test("fitting scales to the box without distorting the hand", () => {
  // 40 wide x 10 tall into a 400x100 box: both dimensions scale by 10, not 10 and 20.
  const fitted = fitTo(trimToInk(line, 0), { width: 400, height: 100 });
  const b = boundsOf(fitted);
  assert.equal(b.maxX - b.minX, 400);
  assert.equal(b.maxY - b.minY, 100);

  // A tall mark is limited by height, and must not overflow the width.
  const tall = [[{ x: 0, y: 0 }, { x: 5, y: 100 }]];
  const f2 = boundsOf(fitTo(tall, { width: 400, height: 100 }));
  assert.equal(f2.maxY - f2.minY, 100);
  assert.ok(f2.maxX - f2.minX <= 400);
});

test("fitting ink with no size does not divide by zero", () => {
  const dot = [[{ x: 7, y: 7 }, { x: 7, y: 7 }]];
  const fitted = fitTo(dot, { width: 400, height: 100 });
  assert.ok(Number.isFinite(boundsOf(fitted).minX));
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `node --test tests/public/signature-pad.test.mjs`
Expected: FAIL — cannot find `../../public/js/signature-pad.js`.

- [x] **Step 3: Implement**

Create `public/js/signature-pad.js`:

```javascript
// scope: shared
/* The parent's signature, drawn on screen (main spec §6 step 11).
   Geometry only: the canvas and the pointer events live in the page module that uses this, so
   what decides whether a mark counts can be tested without a browser. */

// Below this, a mark is a tap or a jitter rather than a signature. In CSS pixels.
const MIN_INK = 4;

export function boundsOf(strokes) {
  let box = null;
  for (const stroke of strokes) {
    for (const point of stroke) {
      if (!box) box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
      else {
        box.minX = Math.min(box.minX, point.x);
        box.minY = Math.min(box.minY, point.y);
        box.maxX = Math.max(box.maxX, point.x);
        box.maxY = Math.max(box.maxY, point.y);
      }
    }
  }
  return box;
}

export function isBlank(strokes) {
  const box = boundsOf(strokes);
  if (!box) return true;
  const points = strokes.reduce((n, stroke) => n + stroke.length, 0);
  if (points < 2) return true;
  return (box.maxX - box.minX) < MIN_INK && (box.maxY - box.minY) < MIN_INK;
}

function mapPoints(strokes, fn) {
  return strokes.map((stroke) => stroke.map(fn));
}

export function trimToInk(strokes, padding) {
  const box = boundsOf(strokes);
  if (!box) return [];
  const pad = padding || 0;
  return mapPoints(strokes, (p) => ({ x: p.x - box.minX + pad, y: p.y - box.minY + pad }));
}

export function fitTo(strokes, box) {
  const ink = boundsOf(strokes);
  if (!ink) return [];
  const width = ink.maxX - ink.minX;
  const height = ink.maxY - ink.minY;
  // One scale for both axes, or the hand that wrote it comes out stretched. A mark with no
  // width or no height (a straight line) scales by whichever side it does have.
  const scaleX = width > 0 ? box.width / width : Infinity;
  const scaleY = height > 0 ? box.height / height : Infinity;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) return strokes.map((stroke) => stroke.slice());
  return mapPoints(strokes, (p) => ({
    x: (p.x - ink.minX) * scale,
    y: (p.y - ink.minY) * scale,
  }));
}
```

- [x] **Step 4: Run and watch it pass**

Run: `node --test tests/public/signature-pad.test.mjs`
Expected: PASS, 6 tests. Then `npm test` → 318 passing.

- [x] **Step 5: Commit**

```bash
git add public/js/signature-pad.js tests/public/signature-pad.test.mjs
git commit -F - <<'MSG'
feat: decide what counts as a signature, without a browser

The geometry of the pad — whether a mark is real, where its ink sits, and how
it scales into a fixed box — is pure and tested here. The canvas and the
pointer events stay in the page module.

tests/public/ covers only pure modules, and every pages/*.js is untested.
That is how the version-conflict wording sat wrong in pages/application.js
until this week: a one-line map no test could see. Logic that decides
something belongs where a test can reach it.

One scale for both axes, so a signature is never stretched out of the shape
the parent's hand made.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: The consent step — draw, sign, and hear why a signature lapsed

**Files:**
- Modify: `public/js/form-render.js` (render the `signature` question type)
- Modify: `public/js/pages/application.js` (upload on sign; render the stale notice)
- Modify: `public/application.html` (the pad's markup)
- Modify: `public/css/app.css` (pad and notice styling)
- Modify: `public/i18n/en.json`, `public/i18n/ta.json`
- Modify: `tests/public/i18n.test.mjs`

**Interfaces:**
- Consumes: `isBlank`, `trimToInk`, `fitTo` (Task 6); `attachments.upload` (Task 3); `consentSigned` / `consentStale` / `consentChanged` (Task 5).
- Produces: a signed application whose `s11_signature` value is the attachment id.

**New i18n keys** (both files, or `tests/public/i18n.test.mjs` fails on key parity):

| Key | English |
|---|---|
| `sign.title` | Parent's signature |
| `sign.hint` | Ask the parent to sign in the box below. |
| `sign.clear` | Clear |
| `sign.save` | Save signature |
| `sign.saved` | Signed ✓ |
| `sign.blank` | Please sign in the box before saving. |
| `sign.again` | Please sign again |
| `sign.changedOne` | {field} changed after the parent signed, so the signature needs taking again. |
| `sign.changedMany` | These changed after the parent signed, so the signature needs taking again: {fields} |
| `sign.field.s11_consent` | the consent wording |
| `sign.field.s11_parent_name` | the parent's name |
| `sign.field.s11_relationship` | the relationship |
| `sign.field.s2_full_name` | the applicant's name |
| `sign.field.s2_dob` | the date of birth |

Tamil for all fourteen goes on the M6 close-out list of keys awaiting staff review; write a faithful translation now and record it there in Task 8.

Use `SC_I18n`'s existing `joinNames(list, t)` helper (`public/js/i18n.js`, tested at `tests/public/i18n.test.mjs`) to build `{fields}` — it joins with the sentence's own language rather than an English "and".

- [x] **Step 1: Write the failing i18n test**

Append to `tests/public/i18n.test.mjs`:

```javascript
test("every consented field can be named to the person in both languages", () => {
  const SC_Consent = require("../../shared/consent.js");
  for (const id of SC_Consent.FIELDS) {
    const key = `sign.field.${id}`;
    assert.ok(EN[key], `${id} has no English name (${key})`);
    assert.ok(TA[key], `${id} has no Tamil name (${key})`);
  }
});

test("the stale-signature sentences say what changed", () => {
  assert.match(EN["sign.changedOne"], /\{field\}/);
  assert.match(EN["sign.changedMany"], /\{fields\}/);
  assert.match(TA["sign.changedOne"], /\{field\}/);
  assert.match(TA["sign.changedMany"], /\{fields\}/);
});
```

- [x] **Step 2: Run and watch it fail**

Run: `node --test tests/public/i18n.test.mjs`
Expected: FAIL — `s11_consent has no English name (sign.field.s11_consent)`.

- [x] **Step 3: Add the keys to both dictionaries, then run again**

Expected: PASS. `npm test` → 320 passing.

- [x] **Step 4: Render the pad**

In `public/js/form-render.js`, add a `signature` branch to the type switch that renders:

```html
<div class="sign" data-field="s11_signature">
  <p class="sign-hint" data-i18n="sign.hint"></p>
  <canvas class="sign-pad" width="600" height="200"
          aria-label="Parent's signature" role="img"></canvas>
  <div class="sign-actions">
    <button type="button" class="btn btn-ghost sign-clear" data-i18n="sign.clear"></button>
    <button type="button" class="btn sign-save" data-i18n="sign.save"></button>
  </div>
  <p class="sign-state" role="status" aria-live="polite"></p>
</div>
```

Follow the file's existing conventions for building elements — read how `choice` and `consent` are rendered and match them rather than introducing string HTML if the file builds nodes.

Wire the canvas in `pages/application.js`:
- `pointerdown` / `pointermove` / `pointerup` collect `{x, y}` in CSS pixels, using `canvas.getBoundingClientRect()` so the points match the drawing regardless of device pixel ratio.
- Call `event.preventDefault()` on `pointerdown` so a drag does not scroll the page under the parent's hand.
- **Clear** empties the strokes and the canvas.
- **Save signature** rejects `isBlank(strokes)` with `sign.blank`; otherwise renders `fitTo(trimToInk(strokes, 8), { width: 560, height: 180 })` into an offscreen canvas, takes `toDataURL("image/png")`, strips the `data:image/png;base64,` prefix, and calls `attachments.upload`.
- On success, write the returned `id` into the form value for `s11_signature` through the same path every other answer uses, so autosave persists it, and show `sign.saved`.

- [x] **Step 5: Render the stale notice**

Where `bannerInfo()`/`renderBanner()` already handle a returned or rejected file (`pages/application.js`), add the consent notice on the `s11` step from `state.app.consentStale` and `state.app.consentChanged`:

- one changed field → `sign.changedOne` with `{field}` = `t("sign.field." + id)`
- more than one → `sign.changedMany` with `{fields}` = `joinNames(ids.map(…), t)`

Never print "please sign again" with no reason. The screen has been handed the list; withholding it is the same defect M6 closed in the rejection banner.

- [x] **Step 6: Style it**

In `public/css/app.css`, add `.sign-pad` with `touch-action: none` (without it the browser scrolls instead of drawing), a visible border, `width: 100%`, and a height that works at phone width. Use the existing design tokens — `var(--line)`, `var(--bad)`, `var(--ok)` — rather than new colours, and check the ≤440px query the M6 close-out widened.

- [x] **Step 7: Run the suite and commit**

Run: `npm test` → 320 passing, 0 failing.

```bash
git add public/js/form-render.js public/js/pages/application.js public/application.html public/css/app.css public/i18n/en.json public/i18n/ta.json tests/public/i18n.test.mjs
git commit -F - <<'MSG'
feat: let a parent sign on screen, and say when the signature lapsed

The consent step draws a pad, refuses a blank mark, trims and scales what was
drawn, and uploads it as a PNG. s11_signature holds the attachment id, so
autosave carries it like any other answer.

When a signature has gone stale the step names the facts that moved rather
than saying only that something did. The server already sends the list; a
screen that has been handed the reason and will not say it is the defect
closed in the rejection banner last week.

touch-action: none on the pad, or the page scrolls under the parent's hand
instead of drawing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 8: Prove it in a browser, and leave the record straight

**Files:**
- Modify: `poc/seed/demo-applications.mjs` (seeded files get a signature)
- Modify: `TODO.md`
- Modify: `docs/superpowers/plans/2026-09-16-m7a-consent-signature.md` (tick the boxes)
- Modify: `docs/superpowers/plans/2026-09-16-m6-workflow-screens.md` (the Tamil-review key list)

**Why the seed changes:** M5 seeded applications past the submit gate because no signature could exist. Now one can, so the seed should walk the real path — otherwise M7a ships with the demo still proving nothing.

- [x] **Step 1: Give the seeded applications a signature**

In `poc/seed/demo-applications.mjs`, before each `applications.submit`, upload a small valid PNG as `CONSENT_SIGNATURE` for that application. A 1×1 PNG as a base64 constant is enough; put it next to the seed's other fixed data with a comment saying it stands in for a real mark.

If `tests/poc/seed.test.mjs` asserts the seeded statuses, it should now also assert that every submitted application has a live signature — the seed's whole job is to be a truthful demo.

- [x] **Step 2: Run the suite**

Run: `npm test`
Expected: all green. Fix the seed, not the tests, if a status no longer reaches its stage.

- [x] **Step 3: Check it in a browser**

Restart the dev server so it runs the edited `.gs` files — static files are served from disk, but Apps Script sources are evaluated at boot:

```bash
pkill -f "poc/scripts/dev-server.mjs"; node poc/scripts/dev-server.mjs
```

Sign in as `priya@example.com` / `demo-pass-2026` and confirm, in **both** languages:

1. A new application's consent step shows the pad; **Save signature** on an empty pad refuses with `sign.blank`.
2. A real mark saves, reads "Signed ✓", and survives a page reload (the attachment id is in the answers).
3. Submit now succeeds — the first application in this project's history to pass the gate honestly.
4. Change the applicant's name; the step says *the applicant's name* changed and submit is refused.
5. Change a medicine instead; nothing goes stale.
6. Sign again; both the old and new rows exist in the `Attachments` tab, the old one with `deleted_at` set.
7. The pad draws under a finger without scrolling the page, at phone width.

Record a screenshot of the stale notice in `.playwright-mcp/` as the M6 fix wave did.

- [x] **Step 4: Update the records**

- `TODO.md`: tick M7a's six items; change its heading to `✅ done (<N> tests; checked in a browser)`; if anything was deferred, say so on its own line rather than silently leaving a box ticked.
- Add the fourteen new `sign.*` keys to the M6 plan's Tamil-review list, which currently stands at 28 keys.
- Tick this plan's checkboxes.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'MSG'
docs: M7a done — an application can be submitted honestly

The demo seed now signs each application before submitting it, instead of
being seeded past a gate nothing could pass. Checked in a browser in both
languages: a blank pad is refused, a real mark saves and survives a reload,
submit succeeds, changing the applicant's name stales the signature and says
so by name, changing a medicine does not, and signing again keeps the mark it
replaced.

Fourteen sign.* keys join the Tamil list awaiting staff review.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Carry-forwards from M7a

1. **M7b** inherits `Attachments.gs`: widen `M7A_KINDS` to `PHOTO`, `DIAGNOSIS`, `UDID`, add the 10-file cap (main spec §10.3), and add `s2_udid_file` to the schema — `attachments.kind` names a UDID file that no question creates.
2. **`[PROD]`**: the D1 port must hash `SC_Consent.payload` byte-for-byte as the POC does, or a signature taken before the port cannot be checked after it. Same hazard the M6 plan records for `form_hash`, now with a second column.
3. **M8**: the A4 report (R2) prints the Director's signature; the parent's consent signature and the date it was given belong on it too, since that is the document that evidences consent.
4. **Open, for staff (spec §8 CQ1):** an applicant aged 18+ still gets a *parent's* consent. DPDP's verifiable parental consent is a children's provision. One consent path is assumed until staff say otherwise.
