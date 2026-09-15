# SwabodhiniCare — TODO

Every item has a scope tag (see `docs/architecture/scope-map.md`):
**`[SHARED]`** used in both phases · **`[POC]`** Phase 0 only (Google Sheets) · **`[PROD]`** Phase 1 only (Cloudflare).

Status: `[x]` done · `[~]` in progress · `[ ]` not started. Each milestone gets its own plan in `docs/superpowers/plans/` when it starts.

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

### M5: Applications · plan: `docs/superpowers/plans/2026-09-15-m5-applications.md` · 🚧 7 of 8 (the conflict wording is parked)
- [x] `[SHARED]` Autosave every 20 s + on step change; "Saving…" / "Saved ✓" / "Not saved" states; version-conflict message (`js/autosave.js` + tests)
- [x] `[POC]` `Applications.gs`: create, get, save (optimistic lock), list (role-scoped) (+ `tests/poc/applications.test.js`, `tests/poc/people.js`)
- [x] `[SHARED]` Form wizard rendered from the schema (one step per screen, progress, big tap choices, 3-dropdown DOB) — `js/form-view.js`, `js/form-render.js`, `application.html`, `js/pages/application.js`
- [x] `[SHARED]` Home: "Start a new application" + the list of applications this person may see (`home.html`, `js/pages/home.js`)
- [x] `[SHARED]` All-steps overview. The consent step's finger signature pad needs uploads, so it waits for M7
- [ ] `[SHARED]` Version conflict: the "Not saved" line says "check Wi-Fi" when the real cause is someone else's save. Needs new EN + TA wording (`form.reload` and `form.continue` are defined but unused, and look meant for this)
- [x] `[POC]` Sample answers for demos: `public/js/seed/sample-applications.js` — invented, and must pass the submit check except the signature (test accounts are made by the Admin in the app)
- [x] `[POC]` "Fill with sample data" button behind `IS_DEMO` — `SAMPLE_DATA` in `config.js`, named like `BACKEND` so no shared screen names POC code

### M6: Workflow screens · plan: `docs/superpowers/plans/2026-09-16-m6-workflow-screens.md` · 🚧 in progress
- [ ] `[POC]` Demo seed: the dev server starts with an application at every stage, so the queues can be shown before uploads exist (M7). Added by decision, not in the spec
- [ ] `[SHARED]` My Queue (auto-refresh every 60 s while visible, Refresh button), review screen, routing slip
- [ ] `[SHARED]` Approve / Send back / Reject with confirmations; sent-back view with "Fix and resend"
- [ ] `[SHARED]` Director decision: Admit / Waitlist / Reject, password step-up, stored signature, registration number, lock
- [~] `[POC]` `Applications.gs`: submit, review, decide, reopen, withdraw (using `shared/workflow.js`), form fingerprint — fingerprint, submit and withdraw done and reviewed; review in flight; decide and reopen to come (plan tasks 1–6)
- [ ] `[SHARED]` Reopen and withdraw screens

### M7: Files
- [ ] `[SHARED]` `image-compress.js` (canvas, ≤1600 px, ~300 KB), file pickers (camera and gallery)
- [ ] `[POC]` `Attachments.gs`: base64 upload to Drive, file-type check by first bytes, view, soft delete; Director signature upload

### M8: Reports, Excel, print
- [ ] `[SHARED]` `shared/reports.js`: queue counts, register rows, by-centre totals, waitlist, turnaround, demographics (moved from M2)
- [ ] `[SHARED]` Reports screens (R1–R7) with filters and CSS bar charts
- [ ] `[SHARED]` `xlsx.js`: Excel built in the browser (UTF-8, Tamil-safe)
- [ ] `[SHARED]` A4 Individual Assessment Report (`print.html` + `print.css`)
- [ ] `[POC]` `Reports.gs`: reads rows, filters, pages of 50

### M9: Backups, alerts, admin
- [ ] `[POC]` `Backup.gs`: monthly trigger → Sheet copy + `.xlsx` to Drive, keep 24 months, `BackupLog`, email result
- [ ] `[SHARED]` Admin screens: staff list, add staff (temporary password shown once), backups list + Backup now, audit log
- [ ] `[POC]` Restore steps in `docs/runbook.md` + one practice restore

### M10: Installable app, hosting, end-to-end
- [ ] `[SHARED]` Deploy check: copy `shared/*.js` to `public/shared/` for Cloudflare Pages (moved here from M4 — `application.html` loads `shared/form-rules.js`, and the dev server serves `/shared/` from the repo, but Cloudflare Pages will not)
- [ ] `[SHARED]` PWA: `manifest.webmanifest`, `sw.js` (app shell only, network-first), offline page
- [ ] `[POC]` `public/_headers` for Cloudflare Pages (CSP with Apps Script `connect-src`, HSTS, etc.)
- [ ] `[POC]` Deploy: Cloudflare Pages (static) + Apps Script web app; `API_BASE` set
- [ ] `[SHARED]` Playwright E2E (dev-only): main path per role, send-back loop, Tamil, dark mode, two-browser save test
- [ ] `[SHARED]` Security review before handing to staff

### POC close-out
- [ ] `[POC]` Staff testing with one test account per role (POC spec §16 exit criteria)
- [ ] `[POC]` Collect feedback on form wording, Tamil text, reports
- [ ] `[POC]` Decide: stay on Sheets for a small pilot, or move to Phase 1
- [ ] `[POC]` If real data will be entered: move Sheet, script and Drive to the NGO account (POC spec §12 checklist)

---

## Phase 1: Production on Cloudflare (only if the POC review decides to move)

- [ ] `[PROD]` `prod/worker/`: Worker router with REST `/api/*`, same `shared/` modules
- [ ] `[PROD]` D1 migration `0001_init.sql` (same columns as the Sheet tabs)
- [ ] `[PROD]` `public/js/backends/prod.js`: REST calls, `HttpOnly` cookie session
- [ ] `[PROD]` Per-IP login rate limit
- [ ] `[PROD]` R2 uploads (streamed) + usage guard + Usage page
- [ ] `[PROD]` Chunked monthly backup cron + daily usage check
- [ ] `[PROD]` Apps Script mail relay for alerts
- [ ] `[PROD]` `prod/import/`: one-time Sheet → D1 and Drive → R2 import
- [ ] `[PROD]` Remove `poc/`, `public/js/backends/poc.js` and `IS_DEMO` UI; set `BACKEND = "prod"`

---

## Decisions still open

- [ ] Reopening a signed application: does it go through all approvals again? (Currently built as **yes**: `ADMITTED → REOPEN → RETURNED`.)
- [ ] Rejections: therapist tells the family in person, with no automatic message in the POC. Is that OK?
- [ ] Main spec §16 Q1–Q12 and POC spec §18 PQ1–PQ4
- [ ] Tamil wording review by school staff (mockups, prompt, error messages)
