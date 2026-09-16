# M7b — Photos, PDFs and the Director's Signature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the form's already-declared file questions (photo, diagnosis reports, UDID certificate) to a real upload path, store the Director's signature, and let a therapist send a fresh draft from the screen.

**Architecture:** Two pure browser modules (`image-compress.js`, `signature-image.js`) carry the geometry; the POC server widens `Attachments.gs` to accept four kinds against per-kind mime lists with a 10-file cap, adds `attachments.delete`, and gains a `Signatures.gs` module for the Director's mark. The application screen renders file pickers/thumbnails where the "waiting for uploads" note was, and the final button on a fresh draft submits instead of opening the overview.

**Tech Stack:** Google Apps Script (POC server, `.gs` IIFEs), vanilla ES modules in `public/js` (browser), `node:test` (`.test.js` CommonJS for shared/POC, `.test.mjs` ESM for public).

**Spec:** `docs/superpowers/specs/2026-09-16-m7b-photos-pdfs-director-signature-design.md`

## Global Constraints

- Files are typed by their **first bytes** (`sniff`), never by name or a caller-supplied content type.
- **5 MB** universal cap per file (`MAX_BYTES`); **10** live attachments per application (`TOO_MANY_FILES`).
- Per-kind allowed mimes — PHOTO: `image/png,image/jpeg`; DIAGNOSIS/UDID: `image/png,image/jpeg,application/pdf`; CONSENT_SIGNATURE: `image/png,image/jpeg`.
- `CONSENT_SIGNATURE` is the only singleton (a re-sign soft-deletes the old mark); every other kind is additive.
- `attachments.delete` mirrors `Applications.save`'s check: the owner (`created_by === session.user.id`) on an editable file; someone who may not see it is told `NOT_FOUND`.
- The Director's signature is gated on `decision.final` (`["DIRECTOR"]`); a blank mark is refused client-side via `signature-pad.isBlank`, the server refuses anything not a PNG.
- JSON API responses use **camelCase** (`uploadedAt`, `createdAt`), matching `Applications.view`.
- New `public/js` files carry a `// scope: shared` header (enforced by `scripts/check-scope.mjs`).
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `s2_udid_file` schema question

**Files:**
- Modify: `shared/form-schema.js` (insert one field in the `s2` step)
- Test: `tests/shared/form-schema.test.js`

**Interfaces:**
- Consumes: `q(id, type, en, ta, extra)` and `HAVE_UDID` already in `form-schema.js`.
- Produces: `s2_udid_file` — a `file` field, `kind: "UDID"`, `maxFiles: 1`, `showIf: HAVE_UDID`. Task 6's UI and Task 3's upload both key off `kind === "UDID"`.

- [x] **Step 1: Write the failing test**

Append to `tests/shared/form-schema.test.js`:

```js
test("the UDID certificate is a file question shown only when the family has one", () => {
  const udid = F.fieldById("s2_udid_file");
  assert.ok(udid, "s2_udid_file exists");
  assert.equal(udid.type, "file");
  assert.equal(udid.kind, "UDID");
  assert.equal(udid.maxFiles, 1);
  assert.equal(udid.required, false);
  assert.deepEqual(udid.showIf, { field: "s2_udid_status", equals: "HAVE" });
  assert.equal(F.stepById("s2").fields.some((f) => f.id === "s2_udid_file"), true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared/form-schema.test.js`
Expected: FAIL — `fieldById("s2_udid_file")` is `null`.

- [x] **Step 3: Write minimal implementation**

In `shared/form-schema.js`, insert after the `s2_udid_percent` line (line 95):

```js
      q("s2_udid_file", "file", "UDID / disability certificate", "UDID / மாற்றுத்திறனாளி சான்றிதழ்", { kind: "UDID", maxFiles: 1, showIf: HAVE_UDID }),
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/shared/form-schema.test.js`
Expected: PASS (the new test, plus the existing "every question uses a known type" test which asserts `file` fields carry `kind`/`maxFiles`).

- [x] **Step 5: Commit**

```bash
git add shared/form-schema.js tests/shared/form-schema.test.js
git commit -m "feat: add the UDID certificate file question"
```

---

### Task 2: `public/js/image-compress.js`

**Files:**
- Create: `public/js/image-compress.js`
- Test: `tests/public/image-compress.test.mjs`

**Interfaces:**
- Consumes: nothing (pure + a canvas half).
- Produces: `fitInside(width, height, maxDim) -> { width, height }`; `qualityFor(sizes, target) -> quality`; `compress(file, { maxDim, target }) -> Promise<Blob>`; `blobToBase64(blob) -> Promise<string>`. Task 6's `uploadFile` uses `compress` and `blobToBase64`.

- [x] **Step 1: Write the failing test**

Create `tests/public/image-compress.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitInside, qualityFor } from "../../public/js/image-compress.js";

test("fitInside keeps the aspect, never upscales, and fits the box", () => {
  assert.deepEqual(fitInside(3200, 2400, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitInside(2400, 3200, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitInside(800, 600, 1600), { width: 800, height: 600 }, "small images are not upscaled");
  assert.deepEqual(fitInside(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitInside(0, 0, 1600), { width: 0, height: 0 });
});

test("qualityFor steps down to the first size under the target, else the floor", () => {
  // QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5]
  assert.equal(qualityFor([400 * 1024, 350 * 1024, 280 * 1024], 300 * 1024), 0.7);
  assert.equal(qualityFor([200 * 1024], 300 * 1024), 0.9, "the highest quality wins when it already fits");
  assert.equal(qualityFor([500 * 1024, 450 * 1024, 400 * 1024, 350 * 1024, 320 * 1024], 300 * 1024), 0.5, "falls back to the floor");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/public/image-compress.test.mjs`
Expected: FAIL — module not found / `fitInside` undefined.

- [x] **Step 3: Write minimal implementation**

Create `public/js/image-compress.js`:

```js
// scope: shared
// Shrinks a photo before upload (main spec §10.3): a JPEG at most maxDim on its longest side and
// under target bytes. PDFs and other non-images pass through untouched — the 5 MB server cap is the
// only ceiling they meet. The geometry is pure so tests reach it without a DOM; only compress() and
// blobToBase64() touch the browser.
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5];
const FLOOR = 0.5;

// Keeps the aspect and never upscales: the result fits inside maxDim on both sides.
export function fitInside(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = maxDim / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// The first quality (highest) whose output is under the target, or the floor when none is.
// `sizes[i]` is the JPEG size in bytes QUALITY_STEPS[i] produced.
export function qualityFor(sizes, target) {
  for (let i = 0; i < QUALITY_STEPS.length; i++) {
    if (sizes[i] <= target) return QUALITY_STEPS[i];
  }
  return FLOOR;
}

export async function compress(file, { maxDim = 1600, target = 300 * 1024 } = {}) {
  const bitmap = await loadImage(file);
  const { width, height } = fitInside(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d");
  pen.drawImage(bitmap, 0, 0, width, height);
  for (const quality of QUALITY_STEPS) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= target) return blob;
  }
  return toBlob(canvas, FLOOR);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned nothing"))), "image/jpeg", quality);
  });
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/public/image-compress.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add public/js/image-compress.js tests/public/image-compress.test.mjs
git commit -m "feat: compress photos before upload"
```

---

### Task 3: Widen `Attachments.gs` (kinds + 10-file cap)

**Files:**
- Modify: `poc/apps-script/Attachments.gs` (KINDS map, `MAX_FILES`, `liveList`, cap check, scope the re-sign soft-delete)
- Modify: `shared/actions.js` (add `TOO_MANY_FILES` message)
- Test: `tests/poc/attachments.test.js` (replace "M7a stores signatures only")

**Interfaces:**
- Consumes: `sniff`, `liveFor`, `SC_Applications.loadVisible`, `SC_Store`, `SC_Actions.ok/fail`.
- Produces: `SC_Attachments.liveList(applicationId)` (live rows, newest first); the upload cap. Task 4's `applications.get` metadata and `attachments.delete` both reuse `liveList`.

- [x] **Step 1: Write the failing tests**

In `tests/poc/attachments.test.js`, replace the test `"M7a stores signatures only"` (lines 83-91) with:

```js
test("photos, diagnosis reports and the UDID certificate are accepted", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  for (const kind of ["PHOTO", "DIAGNOSIS", "UDID"]) {
    const result = as("priya")("attachments.upload", {
      applicationId: app.id, kind, filename: `${kind}.png`, base64: b64(PNG),
    });
    assert.equal(result.ok, true, `${kind} accepted`);
    assert.equal(result.data.kind, kind);
  }
});

test("a PDF is a valid diagnosis report but not a photo", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const diag = as("priya")("attachments.upload", {
    applicationId: app.id, kind: "DIAGNOSIS", filename: "report.pdf", base64: b64(PDF),
  });
  assert.equal(diag.ok, true);
  const photo = as("priya")("attachments.upload", {
    applicationId: app.id, kind: "PHOTO", filename: "face.pdf", base64: b64(PDF),
  });
  assert.equal(photo.ok, false);
  assert.equal(photo.error.code, "FILE_TYPE_NOT_ALLOWED");
});

test("adding a second diagnosis report keeps the first (kinds are additive)", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya");
  const first = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: "a.pdf", base64: b64(PDF) });
  const second = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: "b.pdf", base64: b64(PDF) });
  assert.equal(second.ok, true);
  assert.equal(ctx.SC_Store.all("Attachments").length, 2);
  assert.equal(ctx.SC_Store.find("Attachments", "id", first.data.id).deleted_at, null, "the first report is not deleted");
});

test("the eleventh attachment is refused", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  for (let i = 0; i < 10; i++) {
    const r = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: `r${i}.png`, base64: b64(PNG) });
    assert.equal(r.ok, true);
  }
  const extra = as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: "r10.png", base64: b64(PNG) });
  assert.equal(extra.ok, false);
  assert.equal(extra.error.code, "TOO_MANY_FILES");
});

test("re-signing does not count the signature it replaces against the cap", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya", { s11_parent_name: "Selvam R" });
  sign(as, "priya", app.id); // 1 live: the signature
  for (let i = 0; i < 9; i++) {
    assert.equal(as("priya")("attachments.upload", { applicationId: app.id, kind: "DIAGNOSIS", filename: `r${i}.png`, base64: b64(PNG) }).ok, true);
  }
  ctx.clock.ms += 1000;
  const again = sign(as, "priya", app.id, JPEG);
  assert.equal(again.ok, true);
  assert.equal(ctx.SC_Store.filter("Attachments", (r) => !r.deleted_at).length, 10, "the replacement keeps the count at 10");
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/attachments.test.js`
Expected: FAIL — PHOTO/DIAGNOSIS/UDID uploads return `INVALID_REQUEST`; the cap test's eleventh upload succeeds.

- [x] **Step 3: Write minimal implementation**

In `poc/apps-script/Attachments.gs`, replace line 16 (`var M7A_KINDS = ...`) with a KINDS map and add `MAX_FILES`:

```js
  var MAX_BYTES = 5 * 1024 * 1024;       // main spec §10.3
  var MAX_FILES = 10;                    // main spec §10.3: live attachments per application
  var ROOT_FOLDER = "SwabodhiniCare POC";

  var KINDS = {
    PHOTO: ["image/png", "image/jpeg"],
    DIAGNOSIS: ["image/png", "image/jpeg", "application/pdf"],
    UDID: ["image/png", "image/jpeg", "application/pdf"],
    CONSENT_SIGNATURE: ["image/png", "image/jpeg"],
  };
```

Add `liveList` after `liveFor` (line 56) and refactor `liveFor` to reuse it:

```js
  // Every attachment of an application that has not been deleted, newest first.
  function liveList(applicationId) {
    return SC_Store.filter("Attachments", function (row) {
      return row.application_id === applicationId && !row.deleted_at;
    }).sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });
  }

  // The newest attachment of a kind that has not been deleted.
  function liveFor(applicationId, kind) {
    var rows = liveList(applicationId).filter(function (row) { return row.kind === kind; });
    return rows.length > 0 ? rows[0] : null;
  }
```

Replace the top of `upload` and the tail of it:

```js
  function upload(data, session) {
    var allowed = KINDS[data.kind];
    if (!allowed) return fail("INVALID_REQUEST");
    if (typeof data.base64 !== "string" || !data.base64) return fail("INVALID_REQUEST");

    var app = SC_Applications.loadVisible(data.applicationId, session);
    if (app.error) return app.error;

    var bytes = Utilities.base64Decode(data.base64);
    if (bytes.length > MAX_BYTES) return fail("FILE_TOO_LARGE");
    var mime = sniff(bytes);
    if (!mime || allowed.indexOf(mime) === -1) return fail("FILE_TYPE_NOT_ALLOWED");

    // The 10-file cap (main spec §10.3). A re-sign replaces its own previous mark, so that one
    // does not count against the incoming upload; every other kind is additive.
    var previous = data.kind === "CONSENT_SIGNATURE" ? liveFor(app.row.id, data.kind) : null;
    if (liveList(app.row.id).length - (previous ? 1 : 0) + 1 > MAX_FILES) return fail("TOO_MANY_FILES");

    var name = typeof data.filename === "string" && data.filename ? data.filename : "file";
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = folderFor(app.row.app_no).createFile(blob);

    var consentPayload = data.kind === "CONSENT_SIGNATURE"
      ? SC_Consent.payload(SC_Applications.valuesOf(app.row))
      : null;

    var row = { /* unchanged: id, application_id, kind, drive_file_id, filename, mime, size,
                  uploaded_by, created_at, deleted_at, consent_hash, consent_payload */ };

    // Signing again supersedes the previous mark rather than erasing it (POC spec §9, M7a spec
    // §5.1). The other kinds are additive, so this runs for the signature alone (M7b spec §3.3).
    if (previous) SC_Store.update("Attachments", previous.id, { deleted_at: SC_Store.nowIso() });

    SC_Store.insert("Attachments", row);
    return ok({ id: row.id, kind: row.kind, filename: row.filename, mime: row.mime, size: row.size });
  }
```

(Keep the full `var row = { ... }` object literal as it already is; the comment above stands in for it in this plan.)

Update the export and registration:

```js
  return Object.freeze({ upload: upload, get: get, sniff: sniff, liveFor: liveFor, liveList: liveList });

  // ...at the bottom, add:
  SC_Api.register("attachments.delete", SC_Attachments.remove); // added in Task 4; leave for then
```

> Only add `liveList` to the export now; `remove` and its registration arrive in Task 4.

In `shared/actions.js`, add a message to `MESSAGES` (after `FILE_TOO_LARGE`):

```js
    TOO_MANY_FILES: ["Too many files. Remove one first.", "கோப்புகள் அதிகம். முதலில் ஒன்றை நீக்கவும்."],
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/attachments.test.js tests/shared/actions.test.js`
Expected: PASS (the replaced suite, and the existing signature tests still pass).

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Attachments.gs shared/actions.js tests/poc/attachments.test.js
git commit -m "feat: accept photos, diagnosis reports and the UDID certificate with a 10-file cap"
```

---

### Task 4: `attachments.delete` + `applications.get` metadata

**Files:**
- Modify: `poc/apps-script/Attachments.gs` (add `remove`, register `attachments.delete`)
- Modify: `poc/apps-script/Applications.gs` (add `attachments` to `get`)
- Test: `tests/poc/attachments.test.js`

**Interfaces:**
- Consumes: `liveList` (Task 3), `SC_Applications.loadVisible`, `SC_Workflow.isEditable`, `SC_Audit.log`.
- Produces: `attachments.delete` action; `applications.get` response gains `attachments` (`[{ id, kind, filename, mime, size, uploadedAt }]`). Task 6's `removeFile` calls `attachments.delete` and reads `state.app.attachments`.

- [x] **Step 1: Write the failing tests**

Append to `tests/poc/attachments.test.js`:

```js
test("the owner may delete an attachment; it is marked, not removed", () => {
  const { ctx, as } = setupPeople();
  const app = draft(as, "priya");
  const up = as("priya")("attachments.upload", { applicationId: app.id, kind: "PHOTO", filename: "face.png", base64: b64(PNG) });
  const del = as("priya")("attachments.delete", { id: up.data.id });
  assert.equal(del.ok, true);
  assert.ok(ctx.SC_Store.find("Attachments", "id", up.data.id).deleted_at, "the row is marked deleted, not removed");
  const got = as("priya")("applications.get", { id: app.id });
  assert.equal(got.data.attachments.length, 0, "deleted files are no longer listed");
});

test("someone who may see but not edit may not delete", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const up = as("priya")("attachments.upload", { applicationId: app.id, kind: "PHOTO", filename: "face.png", base64: b64(PNG) });
  const del = as("lakshmi")("attachments.delete", { id: up.data.id });
  assert.equal(del.ok, false);
  assert.equal(del.error.code, "NOT_ALLOWED");
});

test("someone who may not see the application is told NOT_FOUND on delete", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const up = as("priya")("attachments.upload", { applicationId: app.id, kind: "PHOTO", filename: "face.png", base64: b64(PNG) });
  assert.equal(as("deepa")("attachments.delete", { id: up.data.id }).error.code, "NOT_FOUND");
});

test("applications.get ships attachment metadata, not bytes", () => {
  const { as } = setupPeople();
  const app = draft(as, "priya");
  const up = as("priya")("attachments.upload", { applicationId: app.id, kind: "PHOTO", filename: "face.png", base64: b64(PNG) });
  const got = as("priya")("applications.get", { id: app.id });
  assert.equal(got.ok, true);
  assert.deepEqual(got.data.attachments, [{
    id: up.data.id, kind: "PHOTO", filename: "face.png", mime: "image/png", size: PNG.length,
    uploadedAt: got.data.attachments[0].uploadedAt,
  }]);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/attachments.test.js`
Expected: FAIL — `attachments.delete` is `UNKNOWN_ACTION`; `applications.get` has no `attachments` key.

- [x] **Step 3: Write minimal implementation**

In `poc/apps-script/Attachments.gs`, add `remove` after `get`:

```js
  function remove(data, session) {
    if (typeof data.id !== "string" || !data.id) return fail("INVALID_REQUEST");
    var row = SC_Store.find("Attachments", "id", data.id);
    if (!row || row.deleted_at) return fail("NOT_FOUND");
    // The permission lives on the application, so ask about that — as get() does. The edit check
    // is the one save() uses (Applications.gs:162): the owner, on a file they may still change.
    var app = SC_Applications.loadVisible(row.application_id, session);
    if (app.error) return app.error;
    if (app.row.created_by !== session.user.id || !SC_Workflow.isEditable(app.row.status)) {
      return fail("NOT_ALLOWED");
    }
    SC_Store.update("Attachments", row.id, { deleted_at: SC_Store.nowIso() });
    SC_Audit.log(session.user.id, "attachments.deleted", "Attachments", row.id, { kind: row.kind });
    return ok({ id: row.id });
  }
```

Update the export and add the registration:

```js
  return Object.freeze({ upload: upload, get: get, remove: remove, sniff: sniff, liveFor: liveFor, liveList: liveList });
```

```js
SC_Api.register("attachments.upload", SC_Attachments.upload);
SC_Api.register("attachments.get", SC_Attachments.get);
SC_Api.register("attachments.delete", SC_Attachments.remove);
```

In `poc/apps-script/Applications.gs`, add to `get()` after `shown.approvedThisRound = ...` (line 152):

```js
    // File metadata travels without the bytes, so the form can draw chips and thumbnails before
    // fetching anything; bytes stay behind attachments.get. Left out of view() on purpose: view()
    // runs on every save, and this would charge a full Attachments scan to the autosave.
    shown.attachments = SC_Attachments.liveList(found.row.id).map(function (r) {
      return { id: r.id, kind: r.kind, filename: r.filename, mime: r.mime, size: r.size, uploadedAt: r.created_at };
    });
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/attachments.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Attachments.gs poc/apps-script/Applications.gs tests/poc/attachments.test.js
git commit -m "feat: delete attachments and list them on applications.get"
```

---

### Task 5: `Signatures.gs` (Director signature)

**Files:**
- Create: `poc/apps-script/Signatures.gs`
- Modify: `shared/actions.js` (add `signature.get`)
- Modify: `tests/shared/actions.test.js` (add `signature.get` to the expected list)
- Test: `tests/poc/signatures.test.js`

**Interfaces:**
- Consumes: `SC_Attachments.sniff` (PNG check), `SC_Store` (Signatures tab already defined in `Store.gs`), `SC_Actions`.
- Produces: `signature.upload` (Director-only, replaces the row) and `signature.get` (base64 + `uploadedAt`, or `{ base64: null }`). Task 7's Settings UI calls both.

- [x] **Step 1: Write the failing tests**

Create `tests/poc/signatures.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setupPeople } = require("./people.js");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

test("only the Director may store a signature", () => {
  const { as } = setupPeople();
  const refused = as("priya")("signature.upload", { base64: b64(PNG) });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "NOT_ALLOWED");
});

test("the Director's signature is stored and read back", () => {
  const { ctx, as } = setupPeople();
  const up = as("revathi")("signature.upload", { base64: b64(PNG) });
  assert.equal(up.ok, true);
  const row = ctx.SC_Store.find("Signatures", "user_id", "u-revathi");
  assert.ok(row && row.drive_file_id, "the signature is in Drive");
  const got = as("revathi")("signature.get", {});
  assert.equal(got.ok, true);
  assert.deepEqual([...Buffer.from(got.data.base64, "base64")], PNG);
});

test("a non-image is refused", () => {
  const { as } = setupPeople();
  const result = as("revathi")("signature.upload", { base64: b64([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FILE_TYPE_NOT_ALLOWED");
});

test("re-uploading replaces the stored mark", () => {
  const { ctx, as } = setupPeople();
  as("revathi")("signature.upload", { base64: b64(PNG) });
  ctx.clock.ms += 1000;
  const PNG2 = PNG.concat([0, 0, 0, 0]);
  const second = as("revathi")("signature.upload", { base64: b64(PNG2) });
  assert.equal(second.ok, true);
  assert.equal(ctx.SC_Store.all("Signatures").length, 1, "one row per Director, not one per upload");
  const got = as("revathi")("signature.get", {});
  assert.deepEqual([...Buffer.from(got.data.base64, "base64")], PNG2);
});

test("signature.get is empty before anything is stored", () => {
  const { as } = setupPeople();
  const got = as("revathi")("signature.get", {});
  assert.equal(got.ok, true);
  assert.equal(got.data.base64, null);
});
```

In `tests/shared/actions.test.js`, add `"signature.get"` to the `expected` array in the test `"the contract covers the POC spec §5 action list"` (insert after `"signature.upload"`).

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/poc/signatures.test.js tests/shared/actions.test.js`
Expected: FAIL — `signature.upload`/`signature.get` are `UNKNOWN_ACTION`; the contract-list test sees a missing `signature.get`.

- [x] **Step 3: Write minimal implementation**

In `shared/actions.js`, add to `CONTRACT` after `signature.upload`:

```js
    "signature.get": { auth: "user", capability: "decision.final" },
```

Create `poc/apps-script/Signatures.gs`:

```js
// scope: poc
/* The Director's stored signature (POC spec §7 Signatures tab, M7b spec §3.5). One row per user:
   the mark M8 stamps on reports. Re-upload replaces it; unlike a consent signature nothing is kept,
   because this is the Director's identity mark, not a record of what was agreed. The router has
   already enforced decision.final, so these handlers only need to store and read. */
var SC_Signatures = (function () {
  "use strict";

  var ok = SC_Actions.ok;
  var fail = SC_Actions.fail;
  var ROOT_FOLDER = "SwabodhiniCare POC";

  function folderNamed(parent, name) {
    var found = parent.getFoldersByName(name);
    return found.hasNext() ? found.next() : parent.createFolder(name);
  }

  function folderFor() {
    var root = folderNamed(DriveApp.getRootFolder(), ROOT_FOLDER);
    return folderNamed(root, "signatures");
  }

  function stored(userId) {
    return SC_Store.find("Signatures", "user_id", userId);
  }

  function upload(data, session) {
    if (typeof data.base64 !== "string" || !data.base64) return fail("INVALID_REQUEST");
    var bytes = Utilities.base64Decode(data.base64);
    // The signature-pad's own blank check runs client-side (isBlank); the server only guarantees
    // the bytes are a real PNG so Drive never holds something that is not an image.
    if (SC_Attachments.sniff(bytes) !== "image/png") return fail("FILE_TYPE_NOT_ALLOWED");

    var file = folderFor().createFile(Utilities.newBlob(bytes, "image/png", "signature.png"));
    var row = { user_id: session.user.id, drive_file_id: file.getId(), uploaded_at: SC_Store.nowIso() };
    if (stored(session.user.id)) SC_Store.update("Signatures", session.user.id, row);
    else SC_Store.insert("Signatures", row);
    return ok({ uploadedAt: row.uploaded_at });
  }

  function get(data, session) {
    var row = stored(session.user.id);
    if (!row) return ok({ base64: null });
    var blob = DriveApp.getFileById(row.drive_file_id).getBlob();
    return ok({ base64: Utilities.base64Encode(blob.getBytes()), uploadedAt: row.uploaded_at });
  }

  return Object.freeze({ upload: upload, get: get });
})();

SC_Api.register("signature.upload", SC_Signatures.upload);
SC_Api.register("signature.get", SC_Signatures.get);
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/poc/signatures.test.js tests/shared/actions.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add poc/apps-script/Signatures.gs shared/actions.js tests/shared/actions.test.js tests/poc/signatures.test.js
git commit -m "feat: store the Director's signature"
```

---

### Task 6: File question UI

**Files:**
- Modify: `public/js/form-render.js` (add `fileInput`, dispatch `file`)
- Modify: `public/js/form-view.js` (expose `kind`/`maxFiles` on the model)
- Modify: `public/js/pages/application.js` (wire pickers, upload, remove, thumbnails)
- Modify: `public/i18n/en.json` (file copy)

**Interfaces:**
- Consumes: `compress`, `blobToBase64` (Task 2); `attachments.upload`/`attachments.delete`/`applications.get` (Tasks 3-4); `s2_udid_file` etc. (Task 1).
- Produces: the file questions are fillable on the application screen. Nothing later depends on this task's internals except the `ctx.attachments` shape.

- [x] **Step 1: Write the failing test**

The browser page modules are untested by convention (see `signature-pad.js`'s header); the pure parts of this task are already covered by Tasks 1-2. Add one shared rule test to pin the model shape, in `tests/public/form-view.test.mjs`:

```js
test("file fields carry their kind and maxFiles to the renderer", () => {
  const { schema, rules, dates } = window; // adapt to the file's existing setup
  const v = createFormView({ schema, rules, dates });
  const model = v.stepModel("s2", { s2_photo: ["a"], s2_udid_status: "HAVE" }, "2026-09-16", "en");
  const photo = model.fields.find((f) => f.id === "s2_photo");
  assert.equal(photo.kind, "PHOTO");
  assert.equal(photo.maxFiles, 1);
});
```

> The exact harness import in this file varies; match the existing `tests/public/form-view.test.mjs` top matter rather than the skeleton above.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/public/form-view.test.mjs`
Expected: FAIL — `photo.kind` is `undefined`.

- [x] **Step 3: Write minimal implementation**

In `public/js/form-view.js`, add to `fieldModel`'s returned object (after `safety`):

```js
      kind: field.kind,
      maxFiles: field.maxFiles,
```

In `public/js/form-render.js`, add `fileInput` (after `signaturePad`) and change the dispatch:

```js
/* A file question (photo, UDID certificate, diagnosis report). The picker and the thumbnails are
   wired by the page module, which owns the upload and the remove calls; this only builds the
   structure they attach to, exactly as signaturePad does. */
function fileInput(field, ctx) {
  const box = el("div", { class: "files" });
  const list = el("ul", { class: "files-list", id: `${field.id}-list` });
  const ids = Array.isArray(field.value) ? field.value : [];
  ids.forEach((id) => {
    const file = (ctx.attachments && ctx.attachments[id]) || { id, filename: "…", mime: "" };
    const item = el("li", { class: "file", "data-attachment": id });
    if (file.mime.indexOf("image/") === 0) {
      item.append(el("img", { class: "thumb", id: `${field.id}-thumb-${id}`, alt: file.filename }));
    } else {
      const chip = el("span", { class: "file-chip" });
      chip.append(el("span", { class: "file-glyph" }, "▤"), el("span", {}, file.filename));
      item.append(chip);
    }
    if (!ctx.readOnly) {
      item.append(el("button", {
        type: "button", class: "file-remove", id: `${field.id}-remove-${id}`,
        "aria-label": ctx.t("file.remove"),
      }, "✕"));
    }
    list.append(item);
  });
  box.append(list);

  if (!ctx.readOnly) {
    const pick = el("div", { class: "file-pick" });
    if (field.kind === "PHOTO") {
      pick.append(el("button", { type: "button", class: "btn btn-ghost", id: `${field.id}-camera` }, ctx.t("file.takePhoto")));
    }
    pick.append(el("button", { type: "button", class: "btn btn-ghost", id: `${field.id}-choose` }, ctx.t("file.chooseFile")));
    box.append(pick);
  }
  return box;
}
```

In `renderQuestion`, replace the `field.waitsForUploads` branch with a `file` branch (place it before it):

```js
  } else if (field.type === "file") {
    q.append(labelFor(field, ctx), fileInput(field, ctx));
  } else if (field.waitsForUploads) {
```

In `public/js/pages/application.js`:

1. Import `compress, blobToBase64`:
   ```js
   import { compress, blobToBase64 } from "../image-compress.js";
   ```
2. In `renderStep`, build `attachments` and pass it in `ctx`, and wire file questions:
   ```js
    const attachments = (state.app.attachments || []).reduce((map, a) => { map[a.id] = a; return map; }, {});
    const ctx = { t, today: today(), view, readOnly: state.readOnly, errorText, onAnswer, attachments };
    $("fields").replaceChildren(...model.fields.map((field) => renderQuestion(field, ctx)));
    model.fields.filter((f) => f.type === "signature").forEach(wireSignaturePad);
    model.fields.filter((f) => f.type === "file").forEach(wireFileQuestion);
   ```
3. Add the wiring helpers (after `wireSignaturePad`):

```js
/* A file question's browser half: the pickers and the remove buttons, plus loading image bytes
   for thumbnails. The pure geometry is in image-compress.js; this owns the upload and the calls. */
function wireFileQuestion(field) {
  const { t } = state.page;
  const makePicker = (accept, capture) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) uploadFile(field, file);
      input.value = "";
    });
    document.body.append(input);
    return input;
  };
  const accept = field.kind === "PHOTO" ? "image/*" : "image/*,application/pdf";
  const camera = $(`${field.id}-camera`);
  if (camera) camera.addEventListener("click", () => makePicker("image/*", true).click());
  const choose = $(`${field.id}-choose`);
  if (choose) choose.addEventListener("click", () => makePicker(accept, false).click());
  const ids = Array.isArray(field.value) ? field.value : [];
  ids.forEach((id) => {
    const remove = $(`${field.id}-remove-${id}`);
    if (remove) remove.addEventListener("click", () => removeFile(field, id));
    loadThumb(field, id);
  });
}

async function uploadFile(field, file) {
  const page = state.page;
  let blob = file;
  if (file.type.indexOf("image/") === 0) {
    try { blob = await compress(file, { maxDim: 1600, target: 300 * 1024 }); }
    catch (err) { console.error("The photo could not be compressed", err); }
  }
  const base64 = await blobToBase64(blob);
  const result = await page.api.call("attachments.upload", {
    applicationId: state.app.id, kind: field.kind, filename: file.name || "file", base64,
  });
  if (!result.ok) { showMessage($("message"), page.errorMessage(result.error)); return; }
  const current = Array.isArray(state.values[field.id]) ? state.values[field.id] : [];
  // Replacing (maxFiles 1) removes the old file explicitly, so it does not linger on the cap.
  if (field.maxFiles === 1 && current.length > 0) {
    await page.api.call("attachments.delete", { id: current[0] });
  }
  const next = field.maxFiles === 1 ? [result.data.id] : current.concat(result.data.id);
  const fresh = await page.api.call("applications.get", { id: state.app.id });
  if (fresh.ok) state.app = fresh.data;
  onAnswer(field.id, next, true);
}

async function removeFile(field, id) {
  const page = state.page;
  const result = await page.api.call("attachments.delete", { id });
  if (!result.ok) { showMessage($("message"), page.errorMessage(result.error)); return; }
  const next = (state.values[field.id] || []).filter((x) => x !== id);
  const fresh = await page.api.call("applications.get", { id: state.app.id });
  if (fresh.ok) state.app = fresh.data;
  onAnswer(field.id, next, true);
}

async function loadThumb(field, id) {
  const img = $(`${field.id}-thumb-${id}`);
  if (!img) return;
  const result = await state.page.api.call("attachments.get", { id });
  if (result.ok) img.src = `data:${result.data.mime};base64,${result.data.base64}`;
}
```

In `public/i18n/en.json`, add (after `form.waitsForUploads`):

```json
  "file.takePhoto": "Take photo",
  "file.chooseFile": "Choose file",
  "file.remove": "Remove",
```

- [x] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — the browser page module changes are checked only for scope/imports, and the form-view model test passes.

- [x] **Step 5: Commit**

```bash
git add public/js/form-render.js public/js/form-view.js public/js/pages/application.js public/i18n/en.json tests/public/form-view.test.mjs
git commit -m "feat: pick, compress and remove photos and documents in the form"
```

---

### Task 7: Director signature Settings UI

**Files:**
- Create: `public/js/signature-image.js` (extract the shared PNG step)
- Modify: `public/js/pages/application.js` (use `strokesToPng`, drop `signaturePng`/`SIGN_BOX`)
- Modify: `public/settings.html` + `public/js/pages/settings.js` (Director-only section)
- Modify: `public/i18n/en.json` (Director signature copy)

**Interfaces:**
- Consumes: `signature.upload`/`signature.get` (Task 5), `isBlank`/`fitTo`/`trimToInk` from `signature-pad.js`.
- Produces: `strokesToPng(strokes) -> base64` in `public/js/signature-image.js`; Settings shows the Director-only "Your signature" pad.

- [x] **Step 1: Write the failing test**

`strokesToPng` touches the DOM and is untested by convention (like the old `signaturePng`). No new unit test; the behaviour is exercised by hand in the browser. Verification here is the scope check and the suite still passing.

- [x] **Step 2: Run test to verify the baseline**

Run: `npm test`
Expected: PASS before the edits (baseline).

- [x] **Step 3: Write minimal implementation**

Create `public/js/signature-image.js`:

```js
// scope: shared
// Turns drawn strokes into a PNG for upload. Geometry (trim/fit) is in signature-pad.js; the canvas
// drawing is here because it needs the DOM. The consent pad and the Director's signature in Settings
// both use it, so every stored signature prints alike.
import { trimToInk, fitTo } from "./signature-pad.js";

const BOX = { width: 560, height: 180 };

export function strokesToPng(strokes) {
  const fitted = fitTo(trimToInk(strokes, 0), BOX);
  const out = document.createElement("canvas");
  out.width = BOX.width + 16;
  out.height = BOX.height + 16;
  const pen = out.getContext("2d");
  pen.lineWidth = 2.5;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  pen.strokeStyle = "#111";
  for (const stroke of fitted) {
    if (stroke.length < 2) continue;
    pen.beginPath();
    pen.moveTo(stroke[0].x + 8, stroke[0].y + 8);
    for (const point of stroke.slice(1)) pen.lineTo(point.x + 8, point.y + 8);
    pen.stroke();
  }
  return out.toDataURL("image/png").split(",")[1];
}
```

In `public/js/pages/application.js`: change the import to drop `trimToInk, fitTo` and add `strokesToPng`:

```js
import { isBlank } from "../signature-pad.js";
import { strokesToPng } from "../signature-image.js";
```

Remove `SIGN_BOX` (line 241) and the whole `signaturePng` function (lines 343-362); change the one caller (line 323) from `signaturePng(strokes)` to `strokesToPng(strokes)`.

In `public/settings.html`, add after the account `</section>` (line 49):

```html
    <section class="panel" aria-labelledby="signature-title" id="signature-section" hidden>
      <h2 id="signature-title" data-i18n="sign.directorTitle">Your signature</h2>
      <p class="hint" data-i18n="sign.directorHint">Your signature is stamped on the reports you sign.</p>
      <div class="sign">
        <canvas class="sign-pad" id="director-pad" width="600" height="200" role="img" aria-label="Your signature"></canvas>
        <div class="sign-actions">
          <button type="button" class="btn btn-ghost" id="director-clear" data-i18n="sign.clear">Clear</button>
          <button type="button" class="btn" id="director-save" data-i18n="sign.save">Save signature</button>
        </div>
        <p class="sign-state" id="director-state" role="status" aria-live="polite"></p>
      </div>
    </section>
```

In `public/js/pages/settings.js`, add the imports and the wiring inside `main()` (after the `page.onRender` block):

```js
import { isBlank } from "../signature-pad.js";
import { strokesToPng } from "../signature-image.js";
```

```js
  // The Director's stored signature (M7b spec §3.5). Shown only to the Director: the section is
  // hidden in the HTML and revealed here, so nobody else even sees the pad.
  if (!user.roles.includes("DIRECTOR")) return;
  document.getElementById("signature-section").hidden = false;
  const pad = document.getElementById("director-pad");
  const stateEl = document.getElementById("director-state");
  const pen = pad.getContext("2d");
  let strokes = [];
  let drawing = false;

  const paint = () => {
    pen.clearRect(0, 0, pad.width, pad.height);
    pen.lineWidth = 2.5;
    pen.lineCap = "round";
    pen.lineJoin = "round";
    pen.strokeStyle = "#111";
    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      pen.beginPath();
      pen.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) pen.lineTo(point.x, point.y);
      pen.stroke();
    }
  };
  const at = (event) => {
    const box = pad.getBoundingClientRect();
    return { x: (event.clientX - box.left) * (pad.width / box.width), y: (event.clientY - box.top) * (pad.height / box.height) };
  };
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    drawing = true;
    pad.setPointerCapture(event.pointerId);
    strokes = strokes.concat([[at(event)]]);
  });
  pad.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    const last = strokes[strokes.length - 1];
    strokes = strokes.slice(0, -1).concat([last.concat([at(event)])]);
    paint();
  });
  pad.addEventListener("pointerup", () => { drawing = false; });
  pad.addEventListener("pointercancel", () => { drawing = false; });

  document.getElementById("director-clear").addEventListener("click", () => {
    strokes = [];
    paint();
    stateEl.textContent = "";
  });
  document.getElementById("director-save").addEventListener("click", async () => {
    if (isBlank(strokes)) { stateEl.textContent = page.t("sign.blank"); return; }
    stateEl.textContent = page.t("sign.saving");
    const result = await page.api.call("signature.upload", { base64: strokesToPng(strokes) });
    if (!result.ok) { stateEl.textContent = page.errorMessage(result.error); return; }
    stateEl.textContent = page.t("sign.saved");
  });
  // A stored signature shows as "Signed ✓", fetched once when Settings opens.
  page.api.call("signature.get", {}).then((got) => {
    if (got.ok && got.data.base64) stateEl.textContent = page.t("sign.saved");
  });
```

In `public/i18n/en.json`, add (after `settings.signOut`):

```json
  "sign.directorTitle": "Your signature",
  "sign.directorHint": "Your signature is stamped on the reports you sign.",
```

- [x] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add public/js/signature-image.js public/js/pages/application.js public/js/pages/settings.js public/settings.html public/i18n/en.json
git commit -m "feat: let the Director store a signature from Settings"
```

---

### Task 8: Fresh-draft submit button

**Files:**
- Modify: `public/js/pages/application.js` (`drawPrimary`, the next-button handler, `askToSubmit`)
- Modify: `public/i18n/en.json` (`form.sendToHead`, `confirm.sendDraft`)

**Interfaces:**
- Consumes: `resend()` already in the file (flush → `applications.submit` → home), `confirm.sendTitle`/`confirm.yesSend`.
- Produces: a fresh `DRAFT` on its last step shows "Send to the Therapy Head" and submits. Nothing later depends on it.

- [x] **Step 1: Write the failing test**

Page modules are untested by convention; the change is behavioural and checked by hand. Verification is the suite still passing plus a manual browser pass.

- [x] **Step 2: Run test to verify the baseline**

Run: `npm test`
Expected: PASS before the edits.

- [x] **Step 3: Write minimal implementation**

In `public/js/pages/application.js`, change `drawPrimary`:

```js
function drawPrimary(model) {
  const isLast = model.number === model.total;
  const label = state.resend
    ? "sentBack.fixAndResend"
    : isLast && state.app.status === "DRAFT" ? "form.sendToHead" : isLast ? "form.finish" : "form.saveNext";
  $("next-btn").textContent = state.page.t(label);
  $("next-btn").disabled = state.readOnly;
}
```

Change the next-button handler in `wireButtons`:

```js
  $("next-btn").addEventListener("click", () => {
    if (state.resend) {
      askToResend();
      return;
    }
    if (state.app.status === "DRAFT" && !stepAt(1)) {
      askToSubmit();
      return;
    }
    saveThen(() => (stepAt(1) ? show("step", stepAt(1)) : show("overview")));
  });
```

Add `askToSubmit` next to `askToResend`:

```js
/* Sending a new draft on (M7b spec §3.6). Same send as resend(), with the draft's wording: a fresh
   draft has no Therapy Head on its slip yet, so the sheet says what happens without naming one. */
function askToSubmit() {
  const { t } = state.page;
  state.sheet.open({
    title: t("confirm.sendTitle"),
    body: t("confirm.sendDraft"),
    yes: t("confirm.yesSend"),
    yesClass: "btn-primary",
    onYes: resend,
  }, $("next-btn"));
}
```

In `public/i18n/en.json`, add after `form.finish`:

```json
  "form.sendToHead": "Send to the Therapy Head",
```

and after `confirm.sendBody`:

```json
  "confirm.sendDraft": "The Therapy Head will review this application. You can't edit it after sending, unless it is sent back to you.",
```

- [x] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add public/js/pages/application.js public/i18n/en.json
git commit -m "feat: send a fresh draft to the Therapy Head from the last step"
```

---

## After all tasks

- [x] Run `npm test` once more; the scope check and every suite must be green.
- [x] Browser-check the flow against the dev server (`poc/scripts/dev-server.mjs`): fill a draft, add a photo and a diagnosis PDF, remove one, sign the consent, and press "Send to the Therapy Head" on the last step.
- [x] Update `TODO.md` (mark M7b done — PR #10, awaiting merge; note the Director-signature and fresh-draft-submit items as done) and commit it.
- [x] Open the PR from `feat/m7b-photos-pdfs-director-signature` against `main`, with a summary and test plan; end the description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
