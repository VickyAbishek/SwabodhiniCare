# M9 — Backups, Alerts and Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-09-16-m9-backups-alerts-admin-design.md`. Branch `feat/m9-backups-alerts-admin`, branched from `main` after PR #12.

## Global Constraints

- Scope tags (`[POC]`/`[SHARED]`) follow `docs/architecture/scope-map.md` and are checked by `scripts/check-scope.mjs` (run by `npm test`). `Backup.gs` and the fakes are `[POC]`; `admin.html`/`admin.js`, i18n keys and `shared/*` are `[SHARED]`.
- TDD: write the failing test first, watch it fail, then implement (see `rules/common/testing.md`, 80 % coverage).
- Immutability: build new objects; never mutate rows returned by `SC_Store` in place.
- No hardcoded secrets or recipients: the alert email address and the 24-month retention count are named constants at the top of `Backup.gs`.

## File Structure (new or changed)

| File | Task | Scope |
|---|---|---|
| `poc/apps-script/Backup.gs` | 1 | `[POC]` |
| `tests/poc/backup.test.js` | 1 | `[POC]` |
| `tests/poc/fakes.js` (extend Drive, add MailApp + ScriptApp) | 1 | `[POC]` |
| `tests/poc/harness.js` (wire MailApp + ScriptApp) | 1 | `[POC]` |
| `public/admin.html`, `public/js/pages/admin.js` | 2 | `[SHARED]` |
| `public/css/app.css` (admin section styles) | 2 | `[SHARED]` |
| `public/i18n/en.json`, `public/i18n/ta.json` | 2 | `[SHARED]` |
| `public/js/pages/home.js` (gated Admin nav link) | 2 | `[SHARED]` |
| `docs/runbook.md` | 3 | docs |

---

### Task 1: `Backup.gs` — the backup core, its handlers, and the service fakes

`SC_Store.tables()` already lists every tab and `BASE` already defines `BackupLog`, so no store change is needed. The trigger and the `runNow` action share one core (`runBackup`).

- **Consumes:** `SC_Actions.ok/fail`; `SC_Store.tables/all/insert/todayIso/nowIso`; `PropertiesService.getScriptProperties().getProperty("SHEET_ID")`; `DriveApp.getFileById(id)` (extended: `.makeCopy`, `.getBlob().getAs().setName()`), the backup folder's `getFoldersByName`/`createFolder`/`createFile`/`getFiles`; `MailApp.sendEmail`; `ScriptApp.newTrigger` (new fakes).
- **Produces (used by Tasks 2–3):**
  - `SC_Backup.runBackup(period, now)` → the new `BackupLog` row (status `COMPLETE`/`FAILED`, `sheet_copy_id`, `xlsx_file_id`, `rows` = per-table counts, timestamps).
  - `SC_Api` registers `admin.backups.list` (newest-first `BackupLog` rows) and `admin.backups.runNow` (Admin-gated by the contract's `backups.run`), plus `backupMonthly()` (the trigger entry) and `installBackupTrigger()`.

- [ ] **Step 1: Write the failing test (`tests/poc/backup.test.js`)**
  - `runNow` as an Admin returns `ok` with a `BackupLog` row whose `period` is the Chennai month (`YYYY-MM`), `status === "COMPLETE"`, both file ids non-empty, and `rows` counting every tab except `Sessions`.
  - `runNow` as a Director fails `NOT_ALLOWED`; `list` as a Director succeeds; `list` as a Therapist fails.
  - `runBackup` with a forced `now` older than 24 months leaves the row COMPLETE but the file names of that run are **not** trashed by a later run (retention only touches files older than the 24-month cutoff).
  - The result email is recorded in the MailApp fake with the Admin recipient.
- [ ] **Step 2: Run to verify the test fails** (no `Backup.gs`, no `MailApp`/`ScriptApp` fakes).
- [ ] **Step 3: Extend the fakes and wire the harness**
  - `makeDriveApp`: file `.makeCopy(name, folder)`, blob `.getAs(mime)` + `.setName(name)`, folder `.getFiles()` (iterator, like `getFoldersByName`).
  - New `makeMailApp()` (records `sendEmail` calls) and `makeScriptApp()` (records `newTrigger(...).timeBased().onMonthDay(n).create()`).
  - `harness.js` `createContext`: add `MailApp` and `ScriptApp`.
- [ ] **Step 4: Write the implementation (`poc/apps-script/Backup.gs`)**
  - Constants: `ADMIN_EMAIL`, `RETENTION_MONTHS = 24`, the xlsx MIME, the backup folder name and file-name prefix.
  - `currentPeriod(now)` = `YYYY-MM`; `cutoffPeriod(now)` = the period 24 months back.
  - `runBackup(period, now)`: read every tab except `Sessions`; copy the sheet and export the xlsx into `Backups` (create the folder if missing); insert the `BackupLog` row; prune backup files whose encoded period is older than `cutoffPeriod`; email the result. A thrown error → FAILED row + error email (never a bare `SERVER_ERROR`).
  - `backupMonthly()` (trigger entry) → `runBackup(currentPeriod(now), now)`; `installBackupTrigger()` → `ScriptApp.newTrigger("backupMonthly").timeBased().onMonthDay(1).create()`.
  - Register `admin.backups.list` and `admin.backups.runNow` (the router already enforces the contract capabilities).
- [ ] **Step 5: Run the tests to verify they pass** (`node --test tests/poc/backup.test.js`).
- [ ] **Step 6: Run the full suite and commit** (`feat: Backup.gs — monthly sheet+xlsx backup, retention, result email`).

---

### Task 2: The Admin screen (`admin.html` + `admin.js`) and the gated nav link

One screen, three sections (Staff / Backups / Audit) each gated by its capability; the nav link shows only when at least one section is visible.

- **Consumes:** `startPage`/`showMessage`/`setBusy` from `../page.js`; `window.SC_Permissions.can(me.roles, cap)`; `users.list`/`users.create`, `admin.backups.list`/`admin.backups.runNow`, `admin.audit.list`; the `{ ok, data, error }` envelope and `page.errorMessage`.
- **Produces:** the Staff list + add form (temp password shown once with a copy button and a "not saved anywhere" note), the Backups list + Backup-now button behind a confirmation, and the paged Audit log.

- [ ] **Step 1: Add the i18n keys** to `en.json`/`ta.json` (`admin.*`: nav, section titles, staff table, add-staff form and its one-time-password note, backups table + Backup-now + confirmation, audit columns, and paging).
- [ ] **Step 2: Append the admin styles to `public/css/app.css`** (section cards, the one-time-password callout, table styles shared with reports).
- [ ] **Step 3: Create `public/admin.html`** (the three `<section>`s with `hidden` toggles).
- [ ] **Step 4: Create `public/js/pages/admin.js`** — render each section from its action; `users.create` captures and shows the returned temporary password once; `admin.backups.runNow` refreshes the list on success; audit pages forward/back.
- [ ] **Step 5: Add the gated Admin link to the home screen** (`home.js`), visible for any of `users.manage`, `backups.view`, `audit.view`.
- [ ] **Step 6: Run the scope check and the suite.**
- [ ] **Step 7: Verify in a browser** (Admin sees all three; Director sees Backups + Audit but not Staff and no Backup-now; Therapist sees no Admin link).
- [ ] **Step 8: Commit** (`feat: admin screen — staff, backups and audit`).

---

### Task 3: Runbook, TODO and close-out

- **Consumes:** the `BackupLog`/Drive layout from Task 1; the admin screen from Task 2.

- [ ] **Step 1: Write `docs/runbook.md`** — the restore procedure: open the latest `BackupLog` row, open the sheet copy from Drive, copy the `Applications`/`Users`/… tabs back over the live sheet (with the lock and the "run `setup()` after" note), the 24-month retention note, and the recorded practice-restore result.
- [ ] **Step 2: Practice restore** — run a backup, then follow the runbook against the dev server's fake Drive, and record the outcome in the runbook.
- [ ] **Step 3: Update `TODO.md`** — tick the three M9 lines, point "Start here" at M10, and mark M9 done.
- [ ] **Step 4: Run the full suite** (`npm test`) and confirm 360 + new tests pass, 0 fail.
- [ ] **Step 5: Commit** (`docs: runbook + tick off M9`).

---

## Self-review notes

- **Spec coverage:** F20 (monthly backup → sheet copy + xlsx + retention + log + email) is Task 1; F21 (backup list + Backup-now) is Task 1's handlers + Task 2's Backups section; F22's `[POC]` slice (the result email) is Task 1's `MailApp` call. Staff and audit are Task 2, backed by the M3 `Users.gs`/`Audit.gs` already present. The restore procedure is Task 3.
- **Type consistency:** the `BackupLog` columns in `Store.gs` (`period, status, sheet_copy_id, xlsx_file_id, rows, error, started_at, finished_at`) must match exactly what `runBackup` inserts; `rows` is a JSON-encoded `{tab: count}` object read back by the admin screen as `JSON.parse`.
- **Access control:** the contract (`shared/actions.js`) already maps `admin.backups.list`→`backups.view`, `admin.backups.runNow`→`backups.run`, `admin.audit.list`→`audit.view`, and the router enforces them, so `Backup.gs` and the admin screen never re-implement role checks — they render behind `SC_Permissions.can`.
