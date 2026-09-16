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

---

## Deploy to Cloudflare Pages + Apps Script

The POC runs as two pieces: the **web app** (this repo's `public/`, served by Cloudflare Pages) and
the **server** (the Apps Script web app in `poc/apps-script/`). `poc/README.md` covers the Apps Script
build/push steps; this section adds the Pages side and the `API_BASE` wiring that M10 introduced.

### 1. Deploy the server (Apps Script)

1. Build the bundle: `node poc/scripts/build.mjs` → `build/apps-script/Code.js`.
2. Push: `npx @google/clasp push` (login + create are one-time — see `poc/README.md`).
3. In the Apps Script editor: **Deploy → Manage deployments → Edit → New version** (or **New
   deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*). Note the **`/exec` URL** —
   that is `API_BASE` for the deployed web app.

### 2. Prepare `public/` for Pages

The dev server serves `/shared/` straight from the repo root, but Pages serves only `public/`. So:

1. `node scripts/deploy-check.mjs` — copies every `shared/*.js` into `public/shared/` (gitignored)
   and fails loudly if any `<script src="shared/…">` no longer resolves.
2. `SC_API_BASE=<the /exec URL> node scripts/prepare-deploy.mjs` — re-runs the check, then writes
   `public/js/config.deploy.js` with `DEPLOY = { API_BASE: "<url>" }`. `config.js` spreads that over
   its defaults, so the deployed app points at Apps Script **without editing `config.js`**.
   (`config.deploy.js` is committed empty; the written value is an uncommitted change — never commit it.)

### 3. Deploy the web app (Pages)

1. **First time only:** `npx wrangler pages project create swabodhinicare --production-branch main --force`.
   The `--force` matters: without it, wrangler 4.13x turns the project into a Cloudflare *Worker*
   (a `*.workers.dev` address, plus an unasked-for `wrangler.jsonc` and `package.json` edits). We keep
   classic Pages (`swabodhinicare.pages.dev`). Once the project exists, don't pass `--force` again.
2. `npx wrangler pages deploy public --project-name swabodhinicare --branch main` (from the repo root). `public/_headers` ships the CSP and the
   security headers; `manifest.webmanifest`, `sw.js`, `offline.html` and `icon.svg` make it installable.
3. Sanity-check: open the Pages URL, sign in, and load one application. The browser calls the Apps
   Script `/exec` URL directly (cross-origin), which the CSP's `connect-src` already allows.

### 4. Install as a PWA

On the deployed Pages URL — not `127.0.0.1`/`localhost`, where the service worker is deliberately off:

1. Open the site; the manifest and `sw.js` register automatically.
2. **Install:** Chrome/Edge → browser menu → **Install SwabodhiniCare** (or the install icon in the
   address bar); Safari → Share → **Add to Home Screen**. It opens standalone with the teal icon.
3. **Offline:** turn the network off and reload — you get the bilingual "You're offline" page. `/api`
   (and all data) is never cached, so staff records stay network-only.
