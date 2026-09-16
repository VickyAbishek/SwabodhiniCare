# M9 — Backups, Alerts and Admin — Design

> Written 2026-09-16, on `feat/m9-backups-alerts-admin`, branched from `main` after PR #12 merged.
> Implements main spec §11.2 and §11.4's POC slice, plus POC spec §10's F20/F21/F22. Scope tags follow `docs/architecture/scope-map.md`.

**Goal:** Automatic monthly backups (a Sheet copy *and* an `.xlsx` in Drive, 24 months kept, each run logged, the result emailed), the Admin screen (staff list, add staff, backups list + Backup-now, audit log), and a written restore procedure with one practice drill.

## Scope tags (scope-map F20/F21/F22)

| Feature | POC (this milestone) | PROD (later) |
|---|---|---|
| F20 Monthly backup | Apps Script time trigger → Sheet copy + `.xlsx` to Drive | chunked cron → R2 |
| F21 Backup-now button, backup list | Admin screen calls `admin.backups.runNow` / `list` | same action, Worker job |
| F22 Alert emails | `MailApp.sendEmail` directly | Worker → Apps Script mail relay |

## What already exists

- `shared/actions.js` already declares `admin.backups.list` (`backups.view`), `admin.backups.runNow` (`backups.run`) and `admin.audit.list` (`audit.view`).
- `shared/permissions.js` already has the capabilities: `backups.view` (DIRECTOR, ADMIN), `backups.run` (ADMIN), `audit.view` (DIRECTOR, ADMIN), `users.manage` (ADMIN).
- `Store.gs` `BASE` already defines the **`BackupLog`** tab (`period, status, sheet_copy_id, xlsx_file_id, rows:json, error, started_at, finished_at`).
- `Users.gs` already has `users.list` and `users.create` (temporary password) — the staff backend; `Audit.gs` already has `admin.audit.list` (paged).
- `xlsx.js` (M8) builds Excel in the browser; the POC backup instead drops a ready-made `.xlsx` in Drive, so the browser does not need it here.

## Design decisions

**D1 — One pure backup core.** `runBackup(period, now)` reads every tab, produces the two Drive files, writes the `BackupLog` row, prunes files older than 24 months, and emails the result. The time trigger (`backupMonthly`) and the `admin.backups.runNow` action are thin wrappers over it. This keeps the whole job testable against the fake services, and keeps the trigger free of logic.

**D2 — Every table except `Sessions`.** Matches §11.2. Attachments' bytes live in Drive (already copied by the sheet copy's bound files are *not*; see open question). The `rows` column stores per-table row counts as JSON — the POC manifest.

**D3 — Backup = one Sheet copy + one `.xlsx`.** `DriveApp.getFileById(sheetId).makeCopy("…")` is the sheet copy; `getBlob().getAs(<xlsx MIME>)` into the backup folder is the Excel copy. Both file ids are logged so the Admin can open either from Drive. The "open backup as Excel" of §11.2 reduces, in the POC, to "the `.xlsx` is already in Drive".

**D4 — Retention is code, not a setting.** After a successful run, every Drive file in the backup folder whose name encodes a period older than 24 months is trashed, and its `BackupLog` row left for the audit trail (the row records the period; the file is gone). The R2 lifecycle rule of §11.2 is the PROD equivalent.

**D5 — The alert is the backup's result email.** `MailApp.sendEmail` to the Admin, once per run, on success and on failure. The full §11.4 alert set (usage counters, lockout detection, `alert_log` once-per-day) is PROD; the POC shows only the backup result email, which is F22's `[POC]` slice.

**D6 — One Admin screen, four gated sections.** `admin.html` holds Staff (add/list, temp password shown once), Backups (list + Backup-now), and Audit (paged). Sections render behind their capability; the nav link to Admin appears only for roles with any of `users.manage`, `backups.view`, or `audit.view`.

## Admin screen

- **Staff** (`users.manage`, ADMIN only): the staff list (`users.list` — name, email, roles, centre, active) and an add form. On create, the server returns the temporary password; the screen shows it once with a copy button and a "not saved anywhere — write it down" note. Editing roles/centre and reset-password stay out of M9 (the backend exists; the screen grows in a follow-up).
- **Backups** (`backups.view`): the `BackupLog` list (period, status, rows, error, times, links to the two Drive files) and, for `backups.run` (ADMIN), a **Backup now** button behind a confirmation.
- **Audit** (`audit.view`): the paged audit log (`admin.audit.list`).

## Data flow

1. Admin opens `admin.html`; each section calls its action (`users.list`, `admin.backups.list`, `admin.audit.list`) and renders.
2. **Backup now** → `admin.backups.runNow` → `runBackup(currentPeriod, now)` → Drive files + `BackupLog` row + email → returns the new row → the list refreshes.
3. Monthly trigger → `backupMonthly()` → `runBackup(currentPeriod, now)` (same path, no session).

## Testing

- **Integration** (`tests/poc/backup.test.js`, fake services): `runBackup` writes a COMPLETE `BackupLog` row with both file ids and per-table row counts; a Drive read failure marks the row FAILED and still emails; retention trashes files older than 24 months and leaves newer ones; the result email is sent to the Admin; `runNow`/`list` enforce `backups.run`/`backups.view`.
- **Unit**: the period math (current `YYYY-MM`, "is this period older than 24 months") in a small `shared/backups.js` so it is testable without the Sheet.
- **Browser**: the Admin screen renders all three sections, add-staff shows the temporary password once, Backup-now creates a row, and the audit list pages.

## Open questions (carried, not blocking)

- The sheet copy does not copy Drive attachment *files*; a real attachment restore needs the attachments folder copied too. Left to the runbook note; attachments are never hard-deleted (M7b), so this is low-risk.
- Tamil wording for the admin screen needs staff review (tracked in TODO "Decisions still open").
