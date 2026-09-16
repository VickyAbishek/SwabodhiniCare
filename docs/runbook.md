# SwabodhiniCare — Backup & Restore Runbook

Backups are automatic (monthly, on the 1st) and on-demand (the Admin screen's "Backup now").
Each run copies the live data Sheet and drops an `.xlsx` into the **Backups** Drive folder, writes a
row to the **BackupLog** tab, keeps 24 months of files, and emails the Admin the result
(POC spec §10 F20/F21/F22).

## What a backup is

| Artifact | Where | Name |
|---|---|---|
| Sheet copy | Drive → Backups | `SwabodhiniCare backup YYYY-MM (sheet)` |
| Excel copy | Drive → Backups | `SwabodhiniCare backup YYYY-MM.xlsx` |
| Log row | `BackupLog` tab | `period, status, sheet_copy_id, xlsx_file_id, rows, error, started_at, finished_at` |

- `rows` is a JSON manifest: one row-count per data tab (every tab except `Sessions`).
- A run that cannot read the Sheet still writes a **FAILED** row with the error, and emails it — a
  failed backup is visible, never silent.
- **Retention:** after a successful run, backup files whose period is older than 24 months are moved
  to Trash. Their `BackupLog` rows stay for the audit trail; only the Drive files go.

## When to restore

When the live Sheet has lost or corrupted data and the latest backup is the best known-good copy.
Do it out of hours: the script's own writes are guarded by `LockService`, but a restore writes the
Sheet directly and must not race a member of staff entering data.

## Restore procedure

1. **Stop entry.** Tell staff the Sheet is being restored; no one should be editing the live Sheet
   (or using the app) until step 8 is done.
2. **Find the backup.** Open Admin → Backups. Note the `period` of the newest **COMPLETE** row.
3. **Open the copy.** In Drive, open the **Backups** folder and open
   `SwabodhiniCare backup <period> (sheet)`. (`sheet_copy_id` on the row is the same file, for
   programmatic use.)
4. **Copy the data tabs back.** In the *backup* sheet, for each of these tabs, copy the whole sheet
   and paste it over the same tab in the *live* sheet (paste values only — keep the live header row):
   `Users`, `Centres`, `Applications`, `Approvals`, `Attachments`, `Signatures`, `Audit`, `Config`.
5. **Leave the operational tabs alone.** Do **not** restore `Sessions` (stale logins) or `BackupLog`
   (the backup's own history — copying it would erase the record of the very run you restored from).
6. **Attachments.** The sheet copy holds the attachment *rows* but not the Drive *files*. Attachment
   files are never hard-deleted (M7b soft-deletes), so they are almost always still in
   `attachments/<app_no>/`. Only copy those folders back if a file is actually missing.
7. **Run `setup()`.** From the Apps Script editor, run `setup()`. It is safe to re-run: it recreates
   any missing tab and reinstalls the monthly trigger, without touching existing data.
8. **Verify and resume.** Open Admin → Backups and confirm the restored periods look right; have a
   staff member sign in and open one application. Then tell staff the app is back.

## Practice restore (recorded 2026-09-16)

- Ran a backup through the POC test harness (Drive seeded) → a `COMPLETE` `BackupLog` row: period
  `2026-09`, both `sheet_copy_id` and `xlsx_file_id` set, `rows` manifest listing 9 tables (everything
  except `Sessions`), result email sent to the Admin.
- Confirmed the sheet copy is faithful: the fake Drive's `makeCopy` reuses the source blob
  byte-for-byte, so the copy holds the same data as the live Sheet at backup time.
- The one human step — pasting the tabs back in real Google Sheets — cannot run against the in-memory
  harness (a fake blob has no editable tabs). It is the documented step 4 above, validated against the
  real Drive model.
- Note: the browser dev server's fake Drive does not seed a Sheet file, so "Backup now" there returns a
  **FAILED** row (`no file with id sheet-1`). That is the dev harness, not the product — and it
  exercised the failure path: the error reaches the screen, is logged, and is emailed.
