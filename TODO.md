# SwabodhiniCare — TODO

Every item has a scope tag (see `docs/architecture/scope-map.md`):
**`[SHARED]`** used in both phases · **`[POC]`** Phase 0 only (Google Sheets) · **`[PROD]`** Phase 1 only (Cloudflare).

Status: `[x]` done · `[~]` in progress · `[ ]` not started. Each milestone gets its own plan in `docs/superpowers/plans/` when it starts.

---

## ▶ Start here (updated 2026-09-16)

**M10 (installable app, hosting, end-to-end) is done** (377 tests). **The POC is deployed** (2026-09-16): website at https://swabodhinicare.pages.dev (classic Cloudflare Pages), server on Google Apps Script. **In design: Phase 1 on Supabase** (see Phase 1 below) — pages take 3–5 s on Apps Script. **Also open: POC close-out** — staffing, staff testing, feedback, and the decide-Sheets-vs-production step before Phase 1.

Run tasks **inline, not with subagents** (token cost).

| | |
|---|---|
| M10 spec (the *why*) | `docs/superpowers/specs/2026-09-16-m10-installable-app-hosting-e2e-design.md` |
| M10 plan (the *how*) | ✅ done — `docs/superpowers/plans/2026-09-16-m10-installable-app-hosting-e2e.md` |
| Runbook | `docs/runbook.md` |
| Tests now | **377 pass, 0 fail** — `npm test` (scope check, then `node --test`); E2E via `npm run test:e2e` (8 specs) |
| Dev server | `node poc/scripts/dev-server.mjs` → http://127.0.0.1:8787 · sign in `priya@example.com` / `demo-pass-2026` (all demo staff share it; see `poc/seed/demo-data.mjs`) |

---

## Phase 0: POC on Google Sheets (every feature, tested by all roles)

### M1: Shared foundations · plan: `docs/superpowers/plans/2026-09-15-m1-shared-foundations.md` · ✅ done (53 tests, 97.95% line coverage)
- [x] `[SHARED]` Tooling: `package.json` (no dependencies), `npm test`, `scripts/check-scope.mjs`
- [x] `[SHARED]` `shared/numbers.js`: application and registration numbers
- [x] `[SHARED]` `shared/dates.js`: age from date of birth, days waiting, calendar checks
- [x] `[SHARED]` `shared/permissions.js`: roles and capabilities (main spec §4)
- [x] `[SHARED]` `shared/workflow.js`: status machine and separation of duties (main spec §5)
- [x] `[SHARED]` `shared/actions.js`: API contract, EN/TA error messages, envelope

### M2: Form definition and answer rules · plan: `docs/superpowers/plans/2026-09-15-m2-form-definition.md` · ✅ done (85 tests total, 98.87% line coverage)
- [x] `[SHARED]` `shared/form-schema.js`: all 11 steps, 82 questions, EN/TA labels, required rules, show-if (adult path 18+)
- [x] `[SHARED]` `shared/form-rules.js`: draft vs submit checks with EN/TA error text, show-if, step progress, safety flags, summary columns

### M3: POC server (Apps Script) core · plan: `docs/superpowers/plans/2026-09-15-m3-poc-server.md` · ✅ done
- [x] `[POC]` M3a: Node test harness with fake Apps Script services (`tests/poc/fakes.js`, `harness.js`)
- [x] `[POC]` M3a: `Store.gs`: tab ↔ object mapping, columns generated from the form schema, readable encodings, `LockService`, counters
- [x] `[POC]` M3a: `Api.gs`: `doPost` router, envelope, sign-in and capability checks
- [x] `[POC]` M3b: `Crypto.gs` + `Auth.gs`: prelogin (fake salts), login (SHA-256 of device key), sessions (12 h idle / 7 days), lockout, change password, temporary-password gate
- [x] `[POC]` M3c: `Users.gs`: me, list, create (temporary password), update roles, reset password, deactivate
- [x] `[POC]` M3c: `Audit.gs`: sign-in and account events, paged list for Director and Admin
- [x] `[POC]` M3c: `Setup.gs` (`setup()` + one-time first-Admin code), `poc/scripts/build.mjs` + `source-order.mjs`, `appsscript.json`, `poc/README.md` deploy steps

### M4: Screens core · plan: `docs/superpowers/plans/2026-09-15-m4-screens.md` · ✅ done (192 tests; flow checked in a browser)
- [x] `[SHARED]` First-time setup screen: setup code → first Admin (`setup.firstAdmin`; code issued by `[POC]` `setup()` now, a Worker secret in production)
- [x] `[POC]` Local dev server (`poc/scripts/dev-server.mjs`): real server code in memory, for testing screens without Google
- [x] `[SHARED]` `public/css/app.css`: design tokens from the mockups (light default, dark via Settings). Print CSS comes with the A4 report in M8
- [x] `[SHARED]` `public/js/config.js`, `api.js` (loads `backends/${BACKEND}.js`), `i18n.js` + `i18n/en.json`/`ta.json`, `prefs.js`, `theme-boot.js`, `page.js`
- [x] `[POC]` `public/js/backends/poc.js`: `{action, token, data}` over `text/plain`, token in `localStorage` (memory if blocked)
- [x] `[SHARED]` `public/js/kdf.js`: PBKDF2 600k on the device, password rules
- [x] `[SHARED]` Screens: Sign in, choose your password, Home (placeholder), Settings (language, appearance, change password, sign out)
- [x] `[POC]` "Test version: sample data only" banner behind `IS_DEMO`

### M5: Applications · plan: `docs/superpowers/plans/2026-09-15-m5-applications.md` · ✅ done (293 tests; the conflict wording landed after M6)
- [x] `[SHARED]` Autosave every 20 s + on step change; "Saving…" / "Saved ✓" / "Not saved" states; version-conflict message (`js/autosave.js` + tests)
- [x] `[POC]` `Applications.gs`: create, get, save (optimistic lock), list (role-scoped) (+ `tests/poc/applications.test.js`, `tests/poc/people.js`)
- [x] `[SHARED]` Form wizard rendered from the schema (one step per screen, progress, big tap choices, 3-dropdown DOB) — `js/form-view.js`, `js/form-render.js`, `application.html`, `js/pages/application.js`
- [x] `[SHARED]` Home: "Start a new application" + the list of applications this person may see (`home.html`, `js/pages/home.js`)
- [x] `[SHARED]` All-steps overview. The consent step's finger signature pad needs uploads, so it waits for M7
- [x] `[SHARED]` Version conflict: the "Not saved" line said "check Wi-Fi" when the real cause was someone else's save — it contradicted the alert below it, which had it right all along. `conflict` is now its own state with its own wording (`form.notSavedConflict`, EN + TA), and `autosave.js` owns the state → key mapping so the form screen cannot keep a second copy to drift
- [x] `[POC]` Sample answers for demos: `public/js/seed/sample-applications.js` — invented, and must pass the submit check except the signature (test accounts are made by the Admin in the app)
- [x] `[POC]` "Fill with sample data" button behind `IS_DEMO` — `SAMPLE_DATA` in `config.js`, named like `BACKEND` so no shared screen names POC code

### M6: Workflow screens · plan: `docs/superpowers/plans/2026-09-16-m6-workflow-screens.md` · ✅ done (289 tests; all five actions reviewed, every screen checked in a browser)
- [x] `[POC]` Demo seed: the dev server starts with an application at every stage, so the queues can be shown before uploads exist (M7). Added by decision, not in the spec
- [x] `[SHARED]` My Queue (auto-refresh every 60 s while visible, Refresh button), review screen, routing slip
- [x] `[SHARED]` Approve / Send back / Reject with confirmations; sent-back view with "Fix and resend"
- [x] `[SHARED]` Director decision: Admit / Waitlist / Reject, password step-up, stored signature, registration number, lock
- [x] `[POC]` `Applications.gs`: submit, review, decide, reopen, withdraw (using `shared/workflow.js`), form fingerprint — all five actions done and reviewed (plan tasks 1–6)
- [x] `[SHARED]` Reopen and withdraw screens — reopen is `reopen.html`; withdraw lives on the form screen's own file actions, next to the answers it promises not to delete
- [x] `[SHARED]` A file that has left the therapist's hands opens with its status and, when a decision left one, that decision's reason — a rejection's reason is otherwise shown nowhere (close-out fix)

### M7: Files · split into M7a (the signature, on the critical path) and M7b (everything else)

#### M7a: The parent's consent signature · ✅ **done (326 tests; checked in a browser)** · spec: `docs/superpowers/specs/2026-09-16-m7a-consent-signature-design.md` · plan: `docs/superpowers/plans/2026-09-16-m7a-consent-signature.md`
> Why first: `form-schema.js:184` marks the signature required and nothing can produce one, so **no application can pass the submit check today**. M5 seeded past that gate and M6 built the approval chain on files that never went through it.
- [x] `[SHARED]` `shared/consent.js`: the five consented fields + their normalized serialization. No hashing — `check-scope.mjs` bans platform APIs from `shared/`, so each side hashes the one shared payload (M6 plan, carry-forward 3)
- [x] `[SHARED]` `public/js/signature-pad.js`: canvas capture, PNG out. Pure geometry (`isBlank`, `trimToInk`, scale to a fixed box) tested apart from the DOM wrapper
- [x] `[POC]` `Attachments.gs` (M7a slice): `attachments.upload` / `.get`, `CONSENT_SIGNATURE` only, type checked by first bytes, Drive `attachments/<app_no>/`, new `consent_hash` column
- [x] `[POC]` `applications.get` ships `consentSigned` / `consentStale`; `submit` refuses a missing **or** stale signature — the server owns the rule, as M6's I2 fix established
- [x] `[SHARED]` The consent step renders the pad, and says **which** of the five facts changed when a signature goes stale
- [x] `[SHARED]` Re-signing soft-deletes the old row rather than overwriting it, so what was consented to stays answerable

> **Carried forward, not done:** a brand-new draft still has no *submit* button. M6's plan says "the
> submit button stays hidden while `CONFIG` cannot produce a signature (M7)", but M7a's tasks never
> picked that button up — the only UI submit is the returned-file **Fix and resend** path, and the
> seed submits by calling the server directly. So a therapist can fill and sign a new application but
> not send it from the screen: the last button (`form.finish`) just opens the overview. Wired in M7b,
> or the smallest follow-up: make the final button on a fresh draft show *"Send to the Therapy Head?"*
> and call `applications.submit`, reusing the confirmation sheet and the flush-then-submit body of
> `resend()` in `pages/application.js`.

#### M7b: Photos, PDFs and the Director's signature · ✅ **done (342 tests; checked in a browser)** · spec: `docs/superpowers/specs/2026-09-16-m7b-photos-pdfs-director-signature-design.md` · plan: `docs/superpowers/plans/2026-09-16-m7b-photos-pdfs-director-signature.md`
- [x] `[SHARED]` `image-compress.js` (canvas, ≤1600 px, ~300 KB), file pickers (camera and gallery)
- [x] `[POC]` `Attachments.gs` widened: `PHOTO`, `DIAGNOSIS`, `UDID`; view, soft delete; the 10-file cap and the 5 MB PDF limit
- [x] `[SHARED]` `s2_udid_file` (`kind: UDID`, showIf status = `HAVE`) — `attachments.kind` promises a UDID file that no question creates (M7a spec §9)
- [x] `[POC]` Director signature upload: `Signatures` tab, `signature.upload`
- [x] `[SHARED]` Director signature Settings UI (`signature-image.js` shared `strokesToPng`; Director-only pad) and the fresh-draft *submit* button (M7a carry-forward)

### M8: Reports, Excel, print · spec: `docs/superpowers/specs/2026-09-16-m8-reports-excel-print-design.md` · plan: `docs/superpowers/plans/2026-09-16-m8-reports-excel-print.md` · ✅ done & merged — PR #12 (360 tests; checked in a browser)
- [x] `[SHARED]` `shared/reports.js`: queue counts, register rows, by-centre totals, waitlist, turnaround, demographics (moved from M2)
- [x] `[SHARED]` Reports screens (R1–R7) with filters and CSS bar charts
- [x] `[SHARED]` `xlsx.js`: Excel built in the browser (UTF-8, Tamil-safe)
- [x] `[SHARED]` A4 Individual Assessment Report (`print.html` + `print.css`)
- [x] `[SHARED]` Pending & Turnaround (R5): take a rejection's date from its `Approvals` row, not from `decided_at`, which no rejection writes (M6 plan, carry-forward 2)
- [x] `[POC]` `Reports.gs`: reads rows, filters, pages of 50

### M9: Backups, alerts, admin · spec: `docs/superpowers/specs/2026-09-16-m9-backups-alerts-admin-design.md` · plan: `docs/superpowers/plans/2026-09-16-m9-backups-alerts-admin.md` · ✅ done (365 tests; checked in a browser)
- [x] `[POC]` `Backup.gs`: monthly trigger → Sheet copy + `.xlsx` to Drive, keep 24 months, `BackupLog`, email result
- [x] `[SHARED]` Admin screens: staff list, add staff (temporary password shown once), backups list + Backup now, audit log
- [x] `[POC]` Restore steps in `docs/runbook.md` + one practice restore

### M10: Installable app, hosting, end-to-end · spec: `docs/superpowers/specs/2026-09-16-m10-installable-app-hosting-e2e-design.md` · plan: `docs/superpowers/plans/2026-09-16-m10-installable-app-hosting-e2e.md` · ✅ done (377 tests) — **prepare-only**: the deploy is prepared, not run
- [x] `[SHARED]` Deploy check: copy `shared/*.js` to `public/shared/` for Cloudflare Pages (moved here from M4 — `application.html` loads `shared/form-rules.js`, and the dev server serves `/shared/` from the repo, but Cloudflare Pages will not)
- [x] `[SHARED]` PWA: `manifest.webmanifest`, `sw.js` (app shell only, network-first), offline page
- [x] `[POC]` `public/_headers` for Cloudflare Pages (CSP with Apps Script `connect-src`, HSTS, etc.)
- [x] `[POC]` Deploy prep: `scripts/prepare-deploy.mjs` + runbook steps for Cloudflare Pages (static) + Apps Script web app with `API_BASE` set — the deploy itself is deferred (M10 decision: prepare, don't deploy)
- [x] `[SHARED]` Playwright E2E (dev-only, `npm run test:e2e`): main path per role, send-back loop, Tamil, dark mode, two-browser save test
- [x] `[SHARED]` Security review before handing to staff (`docs/security-review.md`)

### POC close-out
- [ ] `[POC]` Staffing: make sure every reviewing stage has someone who has not already approved the same round — main spec §4 forbids one person approving two stages, so a school with a single holder of a later role can leave a file stuck at that stage (see the M6 plan's carry-forwards)
- [ ] `[POC]` Staff testing with one test account per role (POC spec §16 exit criteria)
- [ ] `[POC]` Collect feedback on form wording, Tamil text, reports
- [ ] `[POC]` Decide: stay on Sheets for a small pilot, or move to Phase 1
- [ ] `[POC]` If real data will be entered: move Sheet, script and Drive to the NGO account (POC spec §12 checklist)

---

## Phase 1: Production on Supabase · spec: `docs/superpowers/specs/2026-09-16-phase1-supabase-migration-design.md` · 🟡 designing (branch `feat/phase1-supabase-migration`)

**Direction changed (2026-09-16):** Supabase (Postgres + Storage + one Edge Function "api", Mumbai, free plan) replaces the Cloudflare Worker + D1 plan. The website stays on Cloudflare Pages. Start fresh (no Sheet import), keep the current login, weekly backup of data + files to Admin-only Google Drive, daily Apps Script ping so the free project doesn't pause. The task list is written from the spec once it is approved; **no implementation before approval.**

- [x] Decisions S1–S8 + section 1 (parts and connections)
- [ ] Section 2: data model (tables, row `version`, counters, fingerprint must hash the same normalized serialization as the POC — M6 plan, carry-forward 3 — Storage bucket, no direct browser access to the database)
- [ ] Section 3: backup + keep-alive (`backup.export`, `health.ping`, retention, restore script + practice restore)
- [ ] Section 4: errors, testing, rollout (remove `poc/`, `public/js/backends/poc.js` and `IS_DEMO` UI; set `BACKEND = "prod"`)
- [ ] Spec approved → implementation plan in `docs/superpowers/plans/`

Superseded by this change: `prod/worker/` router, D1 migration, R2 uploads + usage guard, D1 per-IP counter, chunked D1 backup cron, `prod/import/` (start fresh). Carried forward into the spec: `backends/prod.js`, login rate limiting, removing the POC.

---

## Decisions still open

- [ ] Reopening a signed application: does it go through all approvals again? (Currently built as **yes**: `ADMITTED → REOPEN → RETURNED`.)
- [ ] Rejections: therapist tells the family in person, with no automatic message in the POC. Is that OK?
- [ ] Main spec §16 Q1–Q12 and POC spec §18 PQ1–PQ4
- [ ] Tamil wording review by school staff (mockups, prompt, error messages)
- [ ] An applicant aged 18+ still gets a **parent's** consent. DPDP's verifiable parental consent is a children's provision, and the schema's only age branch is `s8_work_experience`. One consent path assumed until staff say otherwise (M7a spec §8 CQ1)
