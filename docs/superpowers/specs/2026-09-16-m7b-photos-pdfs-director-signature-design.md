# M7b — Photos, PDFs and the Director's signature

Design for the second half of M7 (`TODO.md` → M7: Files). It connects the file questions the form
already declares to a real upload path, and stores the Director's signature for M8 to stamp.

Specs this implements: main spec §6 (the step-2 and step-4 file questions), §8 (`attachments`,
`signatures`), §10.3 (files: compression, caps); POC spec §9 (Drive), §7 (tabs). Where this
document adds to those, the section says so.

---

## 1. Why this comes second

M7a closed the one gap that stopped any application being submitted — the consent signature. What
remained is the rest of M7: the photo (`s2_photo`), the diagnosis reports (`s4_diagnosis_report`)
and the UDID certificate the form has asked for since M2, plus the Director's stored signature.

Most of the client and server scaffolding is already in place and was left there on purpose. The
schema declares `s2_photo` (`kind: PHOTO`) and `s4_diagnosis_report` (`kind: DIAGNOSIS`); the rules
and view understand file questions (`checkFiles`, `UPLOAD_TYPES = ["file"]`); and the type sniffing
that refuses a renamed file was built and tested in M7a. What is missing is everything between: a
picker that produces a file, compression that keeps it small, and a server that accepts the kind.
`form-render.js` renders file questions as a "waiting for uploads" note, and `Attachments.gs`
accepts only `CONSENT_SIGNATURE`.

The UDID certificate is a gap in the schema itself: `attachments.kind` lists `UDID` (main spec §8,
line 289) and step 2's text says "UDID / disability **certificate**", but `form-schema.js` captures
only status, number and percent. M7a's §9 recorded the decision to add `s2_udid_file` here.

## 2. The file questions, and what each accepts

| Question | kind | maxFiles | Picker | Accepts | Stored as |
|---|---|---|---|---|---|
| `s2_photo` | PHOTO | 1 | camera or gallery | image | JPEG ≤1600 px, ~300 KB |
| `s2_udid_file` | UDID | 1 | gallery | image or PDF | image compressed, PDF as-is |
| `s4_diagnosis_report` | DIAGNOSIS | 3 | gallery | image or PDF | image compressed, PDF as-is |

`kind` is the client's hint for which picker to offer and what `accept` string to set. It is
**never** trusted for type — the server reads the type from the file's first bytes (M7a §3.3) and
now also checks it against the kind's allowed list (§3.3).

## 3. Modules

### 3.1 `public/js/image-compress.js` — shrink photos before upload

Canvas-based. Like `signature-pad.js`, the geometry is pure so tests reach it without a DOM:

```
fitInside(width, height, maxDim)  -> { width, height } : aspect kept, ≤ maxDim, never upscaled
qualityFor(bytes, target)         -> the JPEG quality whose output is under ~300 KB, step-down
compress(file, { maxDim, target }) -> Promise<Blob> : draw to canvas, export JPEG
```

Only images are compressed. PDFs pass through untouched and the 5 MB server cap still applies. The
quality loop steps down (0.9, 0.8, … floor 0.5) and takes the first result under the target, so a
busy photo is shrunk more rather than rejected.

### 3.2 `public/js/form-render.js` — the file question becomes real

Replaces the `waitsForUploads` note with a picker and the current files. Photos show as a
thumbnail, PDFs as a filename chip; each has a remove button. The picker is two inputs the page
module wires: `<input type="file" accept="image/*" capture="environment">` for the camera and a
plain `<input type="file">` for the gallery, with `accept` set from the kind. The picked file is
compressed (if an image) then uploaded via `attachments.upload`; the returned attachment id is
appended to the question's answer array (or replaces it when `maxFiles` is 1).

### 3.3 `poc/apps-script/Attachments.gs` — widened

`M7A_KINDS` becomes `KINDS = ["PHOTO", "DIAGNOSIS", "UDID", "CONSENT_SIGNATURE"]`, each with an
allowed-mime list:

| kind | allowed mimes |
|---|---|
| PHOTO | image/png, image/jpeg |
| DIAGNOSIS | image/png, image/jpeg, application/pdf |
| UDID | image/png, image/jpeg, application/pdf |
| CONSENT_SIGNATURE | image/png, image/jpeg |

`attachments.upload` gains the **10-file cap** (main spec §10.3): it counts the application's live
attachments and refuses `TOO_MANY_FILES` when the new one would be the eleventh. The 5 MB cap
already exists (`MAX_BYTES`) and stays the universal ceiling for every kind.

`attachments.delete` soft-deletes a row (stamps `deleted_at`). It asks the application for
permission first (`loadVisible`), then applies the same edit check `save()` uses: the owner on an
editable file (`Applications.gs:162`). Someone who may not even see it is told `NOT_FOUND`, in the
M7a convention.

Re-signing's soft-delete behaviour (M7a §5.1) is unchanged **and stays scoped to
`CONSENT_SIGNATURE`**: that is the one kind where a new upload supersedes the old. The other kinds
are additive — a second diagnosis report must not erase the first — so `upload`'s implicit
soft-delete runs only for the signature. Removing or replacing a photo is an explicit
`attachments.delete` by the client.

`applications.get` gains an `attachments` list of live rows — id, kind, filename, mime, size,
uploaded_at — so the form can render photos and PDFs without a round trip per file. Bytes stay
behind `attachments.get`.

### 3.4 `shared/form-schema.js` — the UDID certificate

```
q("s2_udid_file", "file", "UDID / disability certificate", "UDID / மாற்றுத்திறனாளி சான்றிதழ்",
  { kind: "UDID", maxFiles: 1, showIf: HAVE_UDID })
```

Visible when `s2_udid_status = HAVE`. Optional, like `s2_photo` — see §7.

### 3.5 Director signature — `poc/apps-script/Signatures.gs` + Settings

New `Signatures` tab (`user_id → drive_file_id, uploaded_at`, POC spec §7). Two actions:

- `signature.upload` — stores the Director's signature (gated on `decision.final`); a blank mark is
  refused via `signature-pad.isBlank`.
- `signature.get` — returns it (base64) so Settings can show a preview and "Signature saved ✓".

Re-upload replaces the row. Unlike a consent signature this is the Director's identity mark, not a
record of what was agreed, so nothing is kept. Stamping onto the A4 report is M8; it reads this
tab. The capture reuses `signature-pad.js` and lives in Settings as a Director-only section (§5).

### 3.6 The fresh-draft submit button (M7a carry-forward)

The final button on a fresh draft (`status = DRAFT`) says "Send to the Therapy Head?" and submits
instead of opening the overview: confirmation sheet → flush → `applications.submit` → home. It is
`resend()`'s body (`application.js:469`) with a draft's wording. This closes the gap M6 left — a
therapist can now fill, sign and send a new application from the screen, not only from the seed.

## 4. The screens

- **File questions** — picker plus thumbnails/chips plus remove, inside the existing step. The
  answer stays an array of attachment ids in the form values, as `checkFiles` already expects.
- **Settings** — a "Your signature" section shown only to the Director: the pad, Save/Clear, and
  "Signature saved ✓" once stored.

## 5. Testing

| Test | What it pins |
|---|---|
| `tests/public/image-compress.test.mjs` | `fitInside` (aspect, no upscale, ≤ maxDim), `qualityFor` ordering |
| `tests/poc/attachments.test.mjs` (extended) | PHOTO/DIAGNOSIS/UDID accepted; per-kind mime refused; 10-file cap; `delete` soft-deletes; delete permission; `applications.get` ships `attachments` |
| `tests/shared/form-schema.test.mjs` (extended) | `s2_udid_file` present, `showIf` HAVE, submit check passes a filled UDID |
| `tests/poc/signatures.test.mjs` | Director-only; blank refused; stored then `signature.get` returns it; re-upload replaces |

## 6. Open questions

- **Should `s2_udid_file` be `required` when `status = HAVE`?** Built as optional, matching
  `s2_photo` and `s4_diagnosis_report`. A staff review in POC testing may say a missing certificate
  should block submission.
- **Re-uploading the Director's signature changes what past reports would stamp.** The `signatures`
  table holds one row per user, so M8's print will show the current mark on old decisions too.
  Acceptable for the POC; raise with staff.
