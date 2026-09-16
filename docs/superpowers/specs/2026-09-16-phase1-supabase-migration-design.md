# Phase 1: Supabase migration — design (DRAFT)

Status: **draft, in brainstorming.** Section 1 (parts and connections) is presented; sections 2–4 (data model, backup + keep-alive, errors/testing/rollout) are still to come. No implementation starts until this spec is approved.

Replaces the original Phase 1 plan (Cloudflare Worker + D1, main spec decision D3). The website stays on Cloudflare Pages.

---

## 1. Why

The POC server (Google Apps Script) is slow: every request takes 1.2–1.7 s, about 1 s of which is Google's redirect before the script runs. Most pages make two requests in a row, and an idle script adds 1–2 s to wake up, so pages take 3–5 s or more. The website files on Cloudflare Pages load in 0.05–0.1 s and are not the problem (measured 2026-09-16).

Goal: pages that load in under about 1 s, without changing the screens, the rules or the login.

## 2. Decisions so far

| # | Decision | Choice | Why |
|---|---|---|---|
| S1 | Supabase plan | **Free** | $0 for the pilot. Accepts two limits: the project pauses after ~7 days with no activity (see S6), and there are no Supabase-managed backups, so the weekly Google backup is the only backup. |
| S2 | Existing POC data | **Start fresh** | The POC holds test data only. No import tool; the first Admin is created with a setup code again. |
| S3 | Backup | **Weekly: data to a dated Google Sheet + files to Drive**, Admin-only | Admins can open and download the Sheet. Files (documents, signatures) are included because the free plan has no backups. |
| S4 | Login | **Keep the current login** | Admin creates accounts and sets temporary passwords; emails don't need to be real. Already built and tested; only the storage behind it changes. |
| S5 | Approach | **A: one Supabase Edge Function "api"** | Same requests from the website, same `shared/` rules and tests; only the storage layer is rewritten for Postgres. Rejected: B (browser talks to the database, rules rewritten as database policies — big rewrite, higher risk to children's data) and C (Cloudflare Worker + Supabase database — two platforms, 10 ms CPU limit, no speed gain). |
| S6 | Avoid free-plan pausing | **Daily ping from a Google Apps Script timer** (same project as the backup) | No new platform. Rejected: Cloudflare cron (a Worker, which we avoid), GitHub Actions schedule (switched off after 60 days without repository activity), `pg_cron` inside Supabase (may not count as activity; can't run while paused). A failed ping emails the Admin. **To verify during implementation:** that a request through the api function counts as activity. Only the Pro plan removes pausing for certain. |
| S7 | Region | **Mumbai (ap-south-1)** | Closest to the school; most of the speed gain depends on it. |
| S8 | Website hosting | **Stay on Cloudflare Pages** (classic Pages, `swabodhinicare.pages.dev`) | Static files are already fast; Vercel would not help and its free plan is for non-commercial use. |

## 3. Parts and how they connect (section 1 — presented, awaiting approval)

```
Staff browser
  │  same { action, token, data } POST, sent as text/plain
  │  (text/plain avoids an extra CORS "preflight" round trip)
  ▼
Cloudflare Pages ── website, unchanged screens
  │
  ▼
Supabase Edge Function "api"  (Mumbai project, free plan)
  │  router + the same 29 actions + shared/ rules
  ├──► Postgres ── 10 tables, same columns as today's Sheet tabs
  └──► Storage ─── private bucket for documents and signatures

Daily:  Google Apps Script timer ──► api "health.ping" (tiny query; keeps the project awake)
Weekly: Google Apps Script timer ──► api "backup.export" (own secret)
          └──► dated Google Sheet + file copies in an Admin-only Drive folder,
               delete old backups, email the Admin
```

### What changes in the repo

1. **`server/`** (new): the action code moved out of the `.gs` files. The Google-specific calls sit behind five small adapters — **store, files, crypto, settings, mail** — so the same actions run on Supabase.
2. **`prod/supabase/`** (new): `migrations/0001_init.sql` (the tables); a build that bundles `shared/` + `server/` into the Edge Function (like the Apps Script build today); the Postgres, Storage and Deno versions of the adapters.
3. **`public/js/backends/prod.js`** (new): the website's connector for the new server. `config.js` sets `BACKEND = "prod"`; the CSP `connect-src` gets the Supabase address.
4. **`backup/apps-script/`** (new, small): the weekly backup and the daily ping only.
5. **Removed at the end, once everything works:** `poc/`, `public/js/backends/poc.js` and the demo banner.

**Unchanged:** every HTML page, the screens' code, `shared/`, the login design, Cloudflare Pages hosting.

### Main porting cost

The Apps Script storage calls are synchronous; Postgres calls are not. Every action that touches data must `await` its result. This is mechanical but touches all 29 actions. The `shared/` modules are pure and unaffected.

Google services used by the POC server today, and their replacements:

| POC (Apps Script) | Supabase version |
|---|---|
| `SpreadsheetApp` (tables) | Postgres |
| `LockService` (one save at a time) | Postgres transaction + row `version` check |
| `DriveApp` (files) | Supabase Storage (private bucket) |
| `Utilities` (hashes, HMAC, UUIDs, base64) | Web Crypto (built into Deno) |
| `PropertiesService` (secrets, setup code) | Edge Function secrets + a `Config` table |
| `MailApp` (backup emails) | Sent by the Apps Script backup job |
| `ScriptApp` triggers (monthly backup) | Apps Script weekly and daily timers |

## 4. Still to design

- **Section 2 — data model:** Postgres tables and types, indexes, row `version`, number counters, the approval fingerprint (it must hash the same normalized serialization as today), Storage bucket layout, keeping the database closed to direct browser access.
- **Section 3 — backup and keep-alive:** the `backup.export` and `health.ping` actions, secrets, Sheet layout, file copies, retention, restore script and one practice restore.
- **Section 4 — errors, testing, rollout:** test strategy (the existing 377 tests, adapter fakes, a Postgres test run), E2E against Supabase, deploy steps in the runbook, removing the POC.
