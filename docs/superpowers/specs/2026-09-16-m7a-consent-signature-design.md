# M7a — The parent's consent signature

Design for the first half of M7 (`TODO.md` → M7: Files). It closes the one gap that stops any
application being submitted, and lays the attachment path that M7b widens to photos and PDFs.

Specs this implements: main spec §6 (step 11), §8 (`attachments`), §10.3 (files), §10.4 (consent);
POC spec §9 (Drive), §7 (tabs). Where this document adds to those, the section says so.

---

## 1. Why this comes first

`shared/form-schema.js:184` declares the parent's signature `required: true`. Nothing can produce
one yet, so **no application in the system can pass the submit check.** M5 shipped the demo seed
with a note that its answers "must pass the submit check except the signature", and M6 built the
whole approval chain on top of applications that were seeded past that gate rather than sent
through it. M7a is what makes the ordinary path — fill in, sign, submit — reachable for the first
time.

The rest of M7 (photos, diagnosis PDFs, the UDID certificate, the Director's stored signature) is
M7b. It is not on this critical path.

## 2. What the parent is actually consenting to

The consent statement (`form-schema.js:179`) reads:

> I agree that Swabodhini may keep the applicant's details, photos and reports to assess and
> support them. Only Swabodhini staff can see them. I can ask for them to be deleted.

This is a **permission to process data** under the DPDP Act 2023, not an attestation that the
clinical answers are correct. The distinction decides everything below: correcting
`s4_current_medicines` does not withdraw a permission to store data, so it must not invalidate the
signature. What invalidates it is a change to **who the data is about**, **who gave the
permission**, or **what they agreed to**.

### 2.1 The consented fields

| Field | Why it is in scope |
|---|---|
| `s11_consent` | The statement itself. If the wording changes, the old agreement was to different words |
| `s11_parent_name` | Who gave the permission |
| `s11_relationship` | The authority under which they gave it |
| `s2_full_name` | Who the data is about |
| `s2_dob` | Identity, and the basis for parental consent at all (§8, open question) |

**Five fields, not eighty.** Had the statement been read as an attestation, every edit would stale
the signature and a therapist fixing one typo on a sent-back file would have to bring the parent
back in. That is a real flow in this system — `RETURNED → fix → resend` is routine, not an edge
case.

## 3. Modules

### 3.1 `shared/consent.js` — what was consented to

Pure, no platform APIs (`scripts/check-scope.mjs` forbids them in `shared/`).

```
consentFields()          -> the five field ids above, frozen, in a fixed order
consentPayload(values)   -> a normalized string built from those fields only
```

It does **not** hash. Hashing needs `SC_Crypto.sha256Hex` on Apps Script and `crypto.subtle` in the
browser, and neither may appear in `shared/`. Splitting it this way is also what the M6 plan's
`[PROD]` carry-forward 3 requires — *"the fingerprint must hash the same normalized serialization
the POC hashes, or an approval taken before the port cannot be compared with a change made after
it."* The same hazard applies here, and one shared serializer is the answer to it.

Normalization follows `formHash`'s existing treatment (`Applications.gs:35-48`): missing and empty
answers are indistinguishable, so a field cleared and a field never filled hash alike.

### 3.2 `public/js/signature-pad.js` — capturing the mark

The geometry is pure and tested; a thin wrapper touches the canvas. Same split as
`routing-slip.js` and `reg-preview.js`, and the same reason — `tests/public/` covers only pure
modules, so logic left inside a page module is logic no test can see. That is precisely how the
version-conflict wording bug survived in `pages/application.js` until this week.

| Pure (tested) | Wrapper (browser only) |
|---|---|
| stroke points → path, with smoothing | pointer/touch event binding |
| `isBlank(strokes)` — a stray tap is not a signature | canvas sizing for device pixel ratio |
| `trimToInk(strokes)` — crop the empty margin | `toDataURL("image/png")` |
| scale to a fixed box, so every stored signature prints at one size | Clear button wiring |

Output is **PNG**, not JPEG: a signature is line art on white, where JPEG's block artefacts are
ugly and PNG is smaller. Photos stay JPEG in M7b, as main spec §10.3 requires.

### 3.3 `poc/apps-script/Attachments.gs` — the M7a slice

Only what the signature needs. `kind` is restricted to `CONSENT_SIGNATURE` in M7a; M7b opens it to
`PHOTO`, `DIAGNOSIS` and `UDID`.

| Action | Does |
|---|---|
| `attachments.upload` | base64 in; type checked from the **first bytes**, never the filename; `DriveApp` save to `SwabodhiniCare POC/attachments/<app_no>/`; one row in the `Attachments` tab |
| `attachments.get` | permission check, then the file back as base64. Drive links are never exposed (POC spec §9) |

Errors reuse what `shared/actions.js` already defines — `FILE_TYPE_NOT_ALLOWED` (line 54) and
`FILE_TOO_LARGE` (line 55) exist and are currently unused. No new error codes, so no new Tamil
needing review.

## 4. Data model

The `Attachments` tab is as POC spec §7 specifies, **plus one column**:

```
id, application_id, kind, drive_file_id, filename, mime, size,
uploaded_by, created_at, deleted_at,
consent_hash            -- NEW: only set when kind = CONSENT_SIGNATURE
```

`consent_hash` is the hash of `consentPayload(values)` at the moment of signing. It is the whole
mechanism of §5.

**Addition to the spec.** Main spec §8's `attachments` table has no such column. The alternative —
a separate `Consents` table — was rejected: the signature *is* the consent record, and splitting
them invites the two halves to disagree about which signature a hash belongs to.

## 5. Staleness, and who decides it

**The server decides. The browser renders the answer.**

`applications.get` already returns `approvedThisRound` for exactly this reason: M6's final review
found `review.js` recomputing the separation-of-duties rule in the browser from the routing slip,
and the fix was to delete the client's copy and have the server ship the answer. A rule with two
implementations has two behaviours the moment one drifts.

So `applications.get` gains:

```
consentSigned : boolean   -- a live CONSENT_SIGNATURE attachment exists
consentStale  : boolean   -- it exists, but its consent_hash no longer matches the answers
```

The browser never hashes anything. It renders a sentence and a Sign again button from those two
booleans.

`applications.submit` refuses a missing **or** stale signature with `VALIDATION_FAILED`, pointing at
`s11_signature`. The client-side check in `form-rules.js` is an aid to the person filling the form,
not the enforcement — the server's refusal is.

### 5.1 Re-signing keeps the old mark

A stale signature is **soft-deleted, never overwritten**: `deleted_at` is stamped on the old row and
a new row is inserted. POC spec §9 already requires soft delete for attachments; this says the
re-sign path is not an exception to it. What was consented to, and when, stays answerable — which
is the entire point of holding a consent record.

## 6. The screen

The consent step (`s11`) renders the statement, the two text answers, and the pad. On signing:
compress nothing (it is already small), upload, store the returned attachment id.

On opening a file whose signature has gone stale, the step says which of the five facts changed —
not merely that something did. "Please sign again" with no reason is the same defect M6 closed in
the rejection banner: a surface that knows why and declines to say.

## 7. Testing

| Level | Covers |
|---|---|
| `tests/shared/consent.test.js` | the field list; that an out-of-scope edit does **not** change the payload; that each of the five **does**; empty/missing equivalence |
| `tests/public/signature-pad.test.mjs` | `isBlank`, `trimToInk`, scaling; a one-pixel tap is blank |
| `tests/poc/attachments.test.js` | upload/get round trip; magic-byte rejection of a renamed file; size limit; permissions; soft delete on re-sign |
| `tests/poc/applications.test.js` | `consentSigned` / `consentStale` on `get`; `submit` refusing missing and stale |
| Browser | sign → submit; sign → change `s2_full_name` → stale with the reason → re-sign → submit; both languages |

The magic-byte test matters more than it looks: it is the one check standing between a private Drive
folder and a file that is not what it claims to be. A `.png` that is actually HTML must be refused.

## 8. Open questions

| # | Question | Assumption while unanswered |
|---|---|---|
| CQ1 | An applicant aged 18+ — should a *parent* be consenting at all? DPDP's verifiable parental consent is a children's provision, and the schema's only age branch is `s8_work_experience` (`form-schema.js:164`). | Keep one consent path. Raise with staff in POC testing rather than build a branch nobody asked for |
| CQ2 | Does re-signing need the parent physically present, and should the app say so? | The screen states plainly that the parent must sign; no enforcement is possible or attempted |
| CQ3 | Tamil wording for the new stale-signature sentences | Added to the M6 close-out list of keys awaiting staff review |

## 9. Deferred to M7b

Photos (`s2_photo`), diagnosis reports (`s4_diagnosis_report`), the **new** UDID certificate upload,
`public/js/image-compress.js` (canvas, ≤1600 px, ~300 KB), camera/gallery pickers, the Director's
stored signature (`Signatures` tab, `signature.upload`), the 10-file cap and the 5 MB PDF limit.

The UDID upload is an addition decided during this design: `attachments.kind` lists `UDID` (main
spec §8, line 289) and step 2's text says "UDID / disability **certificate**", but
`form-schema.js:93-95` captures only status, number and percent. The enum promises a file nothing
creates. M7b adds `s2_udid_file` (`kind: UDID`, `showIf` status `HAVE`) and closes the gap.
