# SwabodhiniCare — Scope Map: POC vs Production vs Shared

| | |
|---|---|
| **Purpose** | One place that says, for every feature and file, whether it is **POC-only**, **production-only** or **shared by both** |
| **Specs** | Production + shared: `docs/superpowers/specs/2026-09-15-swabodhinicare-design.md` · POC: `docs/superpowers/specs/2026-09-15-swabodhinicare-poc-sheets-design.md` |
| **Date** | 2026-09-15 |

## Scope tags

| Tag | Meaning | What happens when we move to production |
|---|---|---|
| **`[SHARED]`** | Used in both phases, unchanged | Stays |
| **`[POC]`** | Only for Phase 0 (the Google Sheets POC) and demos | **Deleted** or replaced |
| **`[PROD]`** | Only for Phase 1 (production on Cloudflare) | Built in Phase 1; not in the POC |

**The test for good separation:** moving to production means deleting `poc/` and `public/js/backends/poc.js` and changing one line in `public/js/config.js`. If anything in `shared/` or the screens breaks, the separation has leaked, and that's a bug.

---

## 1. How the separation is enforced in code

### 1.1 Folders

```
public/                      [SHARED] Screens, CSS, i18n, PWA. Talk to the server only through js/api.js
  js/api.js                  [SHARED] One function per action; hands calls to the selected back end
  js/config.js               [SHARED] BACKEND = "poc" | "prod", API_BASE, IS_DEMO flag
  js/backends/poc.js         [POC]    Sends { action, token, data } to the Apps Script URL
  js/backends/prod.js        [PROD]   Sends to the Worker's /api/* routes with a cookie
shared/                      [SHARED] Pure logic only: no network, no DOM, no Google or Cloudflare APIs
  actions.js                 [SHARED] The API contract: action names, required roles, error codes
  form-schema.js             [SHARED] The 11-step form (fields, EN/TA labels, rules)
  validate.js  workflow.js  permissions.js  numbers.js  dates.js
poc/                         [POC]    Everything only the POC needs
  apps-script/               [POC]    Apps Script server (Sheets, Drive, MailApp, triggers)
  seed/                      [POC]    Fictional test applicants and one test account per role
prod/                        [PROD]   Everything only production needs (Phase 1)
  worker/                    [PROD]   Cloudflare Worker, D1 migrations, wrangler config
  import/                    [PROD]   One-time import: Sheet → D1, Drive → R2
tests/
  shared/  poc/  prod/       Tests follow the same split
scripts/check-scope.mjs      [SHARED] Dev-only check that enforces the rules below
```

### 1.2 Dependency rules (checked by `scripts/check-scope.mjs`)

| From | May use | Must NOT use |
|---|---|---|
| `shared/` | nothing outside `shared/` | `poc/`, `prod/`, `public/`, any network or platform API |
| `public/` (except `js/backends/`) | `shared/`, `public/js/api.js` | `poc/`, `prod/`, any backend-specific URL or API |
| `public/js/backends/poc.js` | `shared/` | `prod/` |
| `public/js/backends/prod.js` | `shared/` | `poc/` |
| `poc/` | `shared/` (copied into Apps Script when deploying) | `prod/` |
| `prod/` | `shared/` | `poc/` |

### 1.3 File header

Every source file starts with a one-line scope comment, which the check script also verifies:

```js
// scope: shared
```
`// scope: poc` · `// scope: prod`. In `.gs` files it's the same comment. In HTML it's `<!-- scope: shared -->`.

### 1.4 Demo-only UI is switched by one flag

`config.js` → `IS_DEMO: true` in the POC. It controls only these **`[POC]`** screen elements:
- a **"Test version: sample data only"** banner in the header (bilingual)
- the **"Fill with sample data"** button on the form (speeds up demos)
- the **"Backup now"** button (in production it is Admin-only and hidden behind a confirmation)

Nothing else may check `IS_DEMO`.

---

## 2. Feature matrix

| # | Feature | Scope | POC implementation | Production implementation |
|---|---|---|---|---|
| F1 | Screens, CSS tokens, light/dark, Tamil/English, PWA | `[SHARED]` | `public/` on Cloudflare Pages | `public/` served by the Worker |
| F2 | 11-step form schema + validation | `[SHARED]` | `shared/form-schema.js`, `shared/validate.js` (server copy in Apps Script) | same files, imported by the Worker |
| F3 | Workflow state machine (statuses, send back, reject, waitlist, reopen) | `[SHARED]` | `shared/workflow.js` | same |
| F4 | Roles and permissions, separation of duties | `[SHARED]` | `shared/permissions.js` | same |
| F5 | API contract (action names, envelope `{ok,data,error}`, error codes) | `[SHARED]` | `shared/actions.js` | same |
| F6 | Transport to the server | split | `[POC]` POST `{action, token, data}` as `text/plain` to Apps Script | `[PROD]` REST `/api/*`, JSON |
| F7 | Phone-side password hashing (PBKDF2 600k) + fake salts | `[SHARED]` | `public/js/kdf.js`; server SHA-256 in Apps Script | same `kdf.js`; server SHA-256 in the Worker |
| F8 | Session | split | `[POC]` token in `localStorage`, sent in the body | `[PROD]` `__Host-sid` `HttpOnly` cookie |
| F9 | Account lockout (5 tries / 15 min) | `[SHARED]` rule | per account | per account |
| F10 | Per-IP login rate limit | `[PROD]` | — (Apps Script can't see IP addresses) | D1 counter |
| F11 | Data store | split | `[POC]` Google Sheet tabs | `[PROD]` D1 tables (same columns) |
| F12 | Optimistic locking (`version`) | `[SHARED]` rule | row `version` + `LockService` `[POC]` | row `version` + D1 `batch()` `[PROD]` |
| F13 | Application and registration numbers | `[SHARED]` format (`shared/numbers.js`) | counters in `Config` tab | counters in D1 |
| F14 | Photos, PDFs, signatures | split | `[POC]` Drive, base64 upload | `[PROD]` R2, streamed upload |
| F15 | Photo shrinking, signature pad | `[SHARED]` | `public/js/image-compress.js`, `signature-pad.js` | same |
| F16 | Reports (queue, register, by-centre, waitlist, turnaround, demographics) | `[SHARED]` screens + maths (`shared/reports.js`) | rows read from the Sheet | SQL in D1 |
| F17 | Excel download | `[SHARED]` | `public/js/xlsx.js` in the browser | same |
| F18 | A4 Individual Assessment Report | `[SHARED]` | `print.html` + `print.css` | same |
| F19 | Audit log | `[SHARED]` rule | `Audit` tab | `audit_log` table |
| F20 | Monthly backup | split | `[POC]` Apps Script trigger: Sheet copy + `.xlsx` to Drive | `[PROD]` chunked cron to R2 |
| F21 | Backup-now button, backup list | `[SHARED]` screen | calls `admin.backups.runNow` | same action, Worker job |
| F22 | Alert emails | split | `[POC]` `MailApp` directly | `[PROD]` Worker → Apps Script mail relay |
| F23 | Spend guard + usage meters (R2 limits) | `[PROD]` | — (nothing billable) | `usage-guard.js`, Usage page |
| F24 | CPU budget rules (10 ms) | `[PROD]` | — | §11.1 of the main spec |
| F25 | Security headers + CSP | `[SHARED]` | `public/_headers` (Cloudflare Pages); `connect-src` = Apps Script | Worker sets headers; `connect-src 'self'` |
| F26 | Hosting | split | `[POC]` Cloudflare Pages (static) | `[PROD]` Worker static assets |
| F27 | "Test version" banner, sample-data button | `[POC]` | `IS_DEMO` flag | removed |
| F28 | Fictional seed data + one test account per role | `[POC]` | `poc/seed/` | removed; real accounts made by Admin |
| F29 | Move-to-NGO-account checklist | `[POC]` | POC spec §12 | — |
| F30 | One-time import Sheet → D1, Drive → R2 | `[PROD]` | — | `prod/import/` |
| F31 | Mockups (`docs/mockups/`) | design reference | not shipped | not shipped |

## 3. Documents and their scope

| Document | Scope |
|---|---|
| Main spec (`…-design.md`) | `[PROD]` + `[SHARED]` rules (screens, form, workflow, security) |
| POC spec (`…-poc-sheets-design.md`) | `[POC]` only: the differences |
| This scope map | Index of what goes where |
| `docs/design/ui-ux-prompt.md`, `docs/mockups/` | `[SHARED]` design |
| `docs/superpowers/plans/…` | Implementation plans; every task is tagged with a scope |
| `TODO.md` | Task list; every item is tagged with a scope |

## 4. Rules for contributors (and for Claude)

1. Every new file gets a scope header. Every new task in `TODO.md` gets a scope tag.
2. If a change touches `[SHARED]` code, it must work for **both** back ends. Where the back ends differ, add it to both adapters (or mark the production side `TODO [PROD]`).
3. POC shortcuts (token in `localStorage`, base64 uploads, `IS_DEMO` UI) live **only** in `poc/` or `public/js/backends/poc.js`, or behind `IS_DEMO`. Never anywhere else.
4. Run `node scripts/check-scope.mjs` before every commit (it's part of `npm test`).
