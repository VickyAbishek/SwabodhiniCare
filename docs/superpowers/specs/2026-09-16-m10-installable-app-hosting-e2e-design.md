# M10 — Installable app, hosting and end-to-end — Design

> Written 2026-09-16, on `feat/m10-installable-app-hosting-e2e`, branched from `feat/m9-backups-alerts-admin`.
> Prepares the POC to be installed (PWA) and deployed (Cloudflare Pages + Apps Script), and adds a committed Playwright E2E suite plus a pre-handoff security review. Scope tags follow `docs/architecture/scope-map.md` — F1 (PWA), F25 (headers + CSP), F26 (hosting).

**Goal:** Make the app installable as a PWA (manifest, service worker, offline page) and deployable to Cloudflare Pages in front of Apps Script — closing the `shared/`-copying gap with a deploy check, adding a CSP/headers file, and a prepare-deploy script that sets `API_BASE` without editing `config.js` — then add a committed Playwright E2E suite and a written security review. **Prepare-only:** this milestone produces everything needed to deploy; the actual Cloudflare Pages + `clasp` deploy is run by hand, and the scripts + runbook say how.

## Scope tags (scope-map F1 / F25 / F26)

| Feature | POC (this milestone) | PROD (later) |
|---|---|---|
| F1 PWA | manifest + app-shell SW (network-first) + offline page | same SW, real branded icons |
| F25 Headers + CSP | `public/_headers` (Cloudflare Pages); `connect-src` = Apps Script | Worker sets headers; `connect-src 'self'` |
| F26 Hosting | Cloudflare Pages (static) + Apps Script web app | Worker static assets |
| Deploy check | `scripts/deploy-check.mjs` copies `shared/*.js` → `public/shared/` | same step in the Worker build |
| E2E | `tests/e2e/` Playwright against the dev server | same suite against prod |

## What already exists

- Every HTML page loads `shared/*.js` with relative `<script src="shared/…">`; the dev server serves `/shared/` from the repo root (`poc/scripts/dev-server.mjs` `route()`), but Cloudflare Pages serves only `public/`, so the files must be copied into `public/shared/` for Pages.
- `config.js` (`public/js/config.js`) holds `BACKEND: "poc"`, `API_BASE: "/api"` (local dev), `IS_DEMO: true`, and is the one place deployment-specific settings live.
- The dev server already serves `.webmanifest` with the right MIME type (`TYPES` map), anticipating the PWA.
- No inline `<script>` blocks, no `style=`, no `onclick=`, no external fonts or CDNs — so a strict CSP is possible.
- `scripts/check-scope.mjs` scans `public/` recursively (not `tests/`); `public/js/backends/poc.js` and `public/js/seed/` are the only POC-scoped files under `public/`.
- `shared/permissions.js` already defines the five roles (`ADMIN`, `THERAPIST`, `THERAPY_HEAD`, `CENTRE_HEAD`, `DIRECTOR`); the dev server seeds one demo person per role (password `demo-pass-2026`, domain `example.com`).

## Design decisions

**D1 — Deploy check copies and verifies.** `scripts/deploy-check.mjs` copies `shared/*.js` → `public/shared/` (gitignored), then walks `public/*.html` to confirm every `<script src="shared/…">` maps to a file that exists in `shared/`. The copy makes `/shared/actions.js` resolve identically on the dev server and on Pages, so no HTML changes. The verification catches drift between the two copies at deploy time, not on a broken page.

**D2 — The service worker caches the app shell only, network-first.** `sw.js` precaches the offline page and caches same-origin static `GET` requests on first use (stale-while-revalidate). Navigations go network-first with a fallback to `offline.html`; `/api` (and any non-`GET`) is never served from cache. A versioned cache name makes each deploy bust the shell.

**D3 — SW registration is gated off localhost.** `public/js/sw-register.js` registers `/sw.js` only when the hostname is not `127.0.0.1`/`localhost`, so it auto-enables on the deployed Pages site and stays off in local dev (where a stale shell would confuse development).

**D4 — Strict CSP, `'unsafe-inline'` on styles only.** `default-src 'self'`; `script-src 'self'` (there are no inline scripts); `style-src 'self' 'unsafe-inline'` (the form code sets styles through the DOM); `img-src 'self' data: blob:` (signature canvas and photos); `connect-src 'self' https://script.google.com https://script.googleusercontent.com` (Apps Script); `worker-src 'self'`; `manifest-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`. Plus HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and a `Permissions-Policy`.

**D5 — `API_BASE` is an override file, not an edit.** `config.js` imports `./config.deploy.js` (committed as `export const DEPLOY = {}`) and spreads it over its defaults, so a deployed site's `API_BASE` is set by writing that one file — never by mutating `config.js`. `scripts/prepare-deploy.mjs` runs the deploy check and writes `config.deploy.js` from `SC_API_BASE` (or prompts).

**D6 — E2E is a committed Playwright suite, not in `npm test`.** `@playwright/test` (a devDependency) with a `webServer` that boots the dev server; scenarios cover the main path per role, the send-back loop, Tamil, dark mode, and the two-browser version-conflict. Run with `npx playwright test`; `tests/` is not scanned by `check-scope`.

**D7 — Icons are an SVG placeholder until there is a logo.** The manifest references a hand-authored SVG (satisfies Chrome install); branded 192/512 PNGs and an `apple-touch-icon` are a follow-up when the school supplies a logo.

**D8 — Security review is a written report, run inline.** A pass against the security checklist, CRITICAL/HIGH fixed in this milestone, the rest recorded in `docs/security-review.md`.

## Component details

- **Deploy check** — `scripts/deploy-check.mjs` (`// scope: shared`): read `shared/*.js`, write each into `public/shared/`; read `public/*.html`, extract `shared/…` `src`s, fail loudly if any is missing from `shared/`.
- **PWA** — `public/manifest.webmanifest` (name, short_name, `start_url: "/"`, `display: standalone`, theme/background colours, `icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]`); `public/sw.js` (cache `swabodhinicare-shell-v1`; `install` → precache `/offline.html`, `/manifest.webmanifest`, `/index.html`; `activate` → delete old caches + `clients.claim()`; `fetch` → non-`GET` or `/api` network-only, `navigate` network-first→`/offline.html`, else stale-while-revalidate); `public/offline.html` (EN + TA "you're offline" + retry, self-contained, no shared JS so it works with an empty cache); `public/js/sw-register.js`; `public/icon.svg` (a simple two-colour mark).
- **Headers** — `public/_headers` (Cloudflare Pages syntax): the CSP above plus `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Prepare-deploy + runbook** — `scripts/prepare-deploy.mjs` (runs deploy-check, writes `config.deploy.js`); `public/js/config.deploy.js` (committed `export const DEPLOY = {}`); a `docs/runbook.md` section with the manual Pages + `clasp` steps.
- **E2E** — `tests/e2e/playwright.config.mjs` + `tests/e2e/*.spec.mjs` (per-role path, send-back loop, Tamil, dark mode, two-browser conflict).
- **Security review** — `docs/security-review.md`.

## Data flow

1. `node scripts/deploy-check.mjs` copies `shared/` → `public/shared/` and verifies the HTML references.
2. `SC_API_BASE=<…/exec> node scripts/prepare-deploy.mjs` writes `config.deploy.js`; the runbook's Pages + `clasp` steps publish `public/`.
3. On the deployed site, `sw-register.js` installs `sw.js`; the shell is cached; `/api` calls still go straight to Apps Script.
4. `npx playwright test` boots the dev server and runs the role / loop / language / theme / conflict scenarios.

## Testing

- **Unit**: the deploy-check reference walk and the SW's routing decision (factored into a pure function) are tested without a browser.
- **Integration**: `prepare-deploy` writes `config.deploy.js` and `config.js` merges it; the scope check stays green — including with a generated `public/shared/` present.
- **E2E**: Playwright scenarios — per-role main path, send-back loop, Tamil, dark mode, two-browser version-conflict.
- **Security**: checklist-driven review recorded in `docs/security-review.md`.

## Open questions (carried, not blocking)

- Real branded icons and an `apple-touch-icon` need a logo from the school (D7).
- The Apps Script `/exec` URL is supplied at deploy time by whoever runs `prepare-deploy` — there is no committed secret.
- E2E needs `npx playwright install` once; the browser binaries are not committed.
